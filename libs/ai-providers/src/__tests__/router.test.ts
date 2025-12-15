import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@writers-block/ai-core', async () => {
  const actual = await vi.importActual<typeof import('@writers-block/ai-core')>(
    '@writers-block/ai-core',
  );
  return actual;
});

import type { BaseModel, ModelCallInput, ModelCallMode } from '@writers-block/ai-core';

import { getLogLevel, setLogLevel } from '@writers-block/logger';

import { ModelRouter, ServiceRouteStrategy, setModelRouterLogLevel } from '../router.js';
import { ModelRegistry } from '../registry.js';
import { CostTier, ProviderId, type ModelDefinition, type ModelKey } from '../types.js';

interface StubModelOptions {
  readonly name?: string;
  readonly providerId?: ProviderId;
  readonly label?: string;
  readonly costTier?: CostTier;
  readonly modes?: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly tags?: readonly string[];
  readonly call?: BaseModel['call'];
}

const registerStubModel = (
  registry: ModelRegistry,
  key: ModelKey,
  options: StubModelOptions = {},
) => {
  const call: BaseModel['call'] =
    options.call ??
    vi.fn(async (_input: ModelCallInput) => ({
      text: key,
    }));
  const modes = options.modes ?? (['text'] as const);
  const caps: BaseModel['caps'] = {
    modes,
    supportsJson: options.supportsJson,
    maxOutputTokens: options.maxOutputTokens,
    contextWindow: options.contextWindow,
    costTier: options.costTier,
    tags: options.tags,
  };
  const definition: ModelDefinition = {
    metadata: {
      key,
      providerId: options.providerId ?? ProviderId.OpenAI,
      label: options.label ?? key,
      modes,
      supportsJson: options.supportsJson,
      maxOutputTokens: options.maxOutputTokens,
      contextWindow: options.contextWindow,
      costTier: options.costTier,
      tags: options.tags,
    },
    create: vi.fn(() => ({
      name: options.name ?? key,
      caps,
      call,
    })),
  };

  registry.register(definition);

  return { call };
};

const callInput: ModelCallInput = { prompt: 'Test prompt' };

describe('ModelRouter', () => {
  let registry: ModelRegistry;
  let router: ModelRouter;

  beforeEach(() => {
    registry = new ModelRegistry();
    router = new ModelRouter(registry, new Map());
  });

  it('advances to the next candidate when failover models error', async () => {
    const failingCall = vi.fn(async () => {
      throw new Error('Primary failed');
    });
    const fallbackCall = vi.fn(async () => ({ text: 'fallback' }));

    registerStubModel(registry, 'openai.primary', { call: failingCall });
    registerStubModel(registry, 'openai.secondary', { call: fallbackCall });

    router.registerServiceRoute('story', {
      strategy: ServiceRouteStrategy.Failover,
      models: ['openai.primary', 'openai.secondary'],
      retry: { retries: 0 },
    });

    const model = router.getModelFor('story');
    const result = await model.call(callInput);

    expect(result.text).toBe('fallback');
    expect(failingCall).toHaveBeenCalledTimes(1);
    expect(fallbackCall).toHaveBeenCalledTimes(1);
  });

  it('rotates the starting candidate while preserving failover resilience', async () => {
    let remainingPrimaryFailures = 1;
    const primaryCall = vi.fn(async () => {
      if (remainingPrimaryFailures > 0) {
        remainingPrimaryFailures -= 1;
        throw new Error('Primary down');
      }

      return { text: 'primary' };
    });

    let secondaryShouldFail = false;
    const secondaryCall = vi.fn(async () => {
      if (secondaryShouldFail) {
        secondaryShouldFail = false;
        throw new Error('Secondary down');
      }

      return { text: 'secondary' };
    });

    registerStubModel(registry, 'openai.primary', { call: primaryCall });
    registerStubModel(registry, 'anthropic.secondary', { call: secondaryCall });

    router.registerServiceRoute('balanced', {
      strategy: ServiceRouteStrategy.RotatingFailover,
      models: ['openai.primary', 'anthropic.secondary'],
      retry: { retries: 0 },
    });

    const model = router.getModelFor('balanced');

    const firstResult = await model.call(callInput);
    expect(firstResult.text).toBe('secondary');

    secondaryShouldFail = true;
    const secondResult = await model.call(callInput);
    expect(secondResult.text).toBe('primary');

    const thirdResult = await model.call(callInput);
    expect(thirdResult.text).toBe('primary');

    expect(primaryCall).toHaveBeenCalledTimes(3);
    expect(secondaryCall).toHaveBeenCalledTimes(2);
  });

  it('rotates models in round-robin order', async () => {
    const firstCall = vi.fn(async () => ({ text: 'first' }));
    const secondCall = vi.fn(async () => ({ text: 'second' }));
    const thirdCall = vi.fn(async () => ({ text: 'third' }));

    registerStubModel(registry, 'openai.first', { call: firstCall });
    registerStubModel(registry, 'openai.second', { call: secondCall });
    registerStubModel(registry, 'openai.third', { call: thirdCall });

    router.registerServiceRoute('round', {
      strategy: ServiceRouteStrategy.RoundRobin,
      models: ['openai.first', 'openai.second', 'openai.third'],
      retry: { retries: 0 },
    });

    const model = router.getModelFor('round');

    await model.call(callInput);
    await model.call(callInput);
    await model.call(callInput);
    await model.call(callInput);

    expect(firstCall).toHaveBeenCalledTimes(2);
    expect(secondCall).toHaveBeenCalledTimes(1);
    expect(thirdCall).toHaveBeenCalledTimes(1);
  });

  it('selects capability matches using filters and cost heuristics', async () => {
    const premiumCall = vi.fn(async () => ({ text: 'premium' }));
    const economyCall = vi.fn(async () => ({ text: 'economy' }));

    registerStubModel(registry, 'openai.text-only', {
      modes: ['text'],
      supportsJson: false,
      costTier: CostTier.Standard,
    });
    registerStubModel(registry, 'openai.premium-json', {
      modes: ['text', 'json'],
      supportsJson: true,
      costTier: CostTier.Premium,
      call: premiumCall,
    });
    registerStubModel(registry, 'openai.economy-json', {
      modes: ['text', 'json'],
      supportsJson: true,
      costTier: CostTier.Economy,
      call: economyCall,
    });

    router.registerServiceRoute('capability', {
      strategy: ServiceRouteStrategy.Capability,
      candidates: ['openai.text-only', 'openai.premium-json', 'openai.economy-json'],
      filter: (metadata) => metadata.supportsJson === true,
      retry: { retries: 0 },
    });

    const model = router.getModelFor('capability');
    const result = await model.call(callInput);

    expect(result.text).toBe('economy');
    expect(economyCall).toHaveBeenCalledTimes(1);
    expect(premiumCall).not.toHaveBeenCalled();
  });

  it('applies retry and logging middleware to routed models', async () => {
    const originalLevel = getLogLevel();
    setModelRouterLogLevel('TRACE');
    let attempt = 0;
    const call = vi.fn(async (_input: ModelCallInput) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('Transient failure');
      }

      return { text: 'success' };
    });
    const info = vi.fn();
    const error = vi.fn();

    registerStubModel(registry, 'openai.resilient', {
      name: 'resilient-model',
      call: async (input: ModelCallInput) => call(input),
    });

    router.registerServiceRoute('static', {
      strategy: ServiceRouteStrategy.Static,
      model: 'openai.resilient',
      retry: { retries: 1 },
      logging: { logger: { info, error } },
    });

    try {
      const model = router.getModelFor('static');
      const result = await model.call(callInput);

      expect(call).toHaveBeenCalledTimes(2);
      expect(info).toHaveBeenCalledTimes(2);
      expect(info).toHaveBeenNthCalledWith(1, 'Calling model: resilient-model', {
        mode: 'text',
      });
      expect(info).toHaveBeenNthCalledWith(
        2,
        'Model resilient-model succeeded',
        expect.objectContaining({
          mode: 'text',
          durationMs: expect.any(Number),
        }),
      );
      expect(error).not.toHaveBeenCalled();
      expect(result.text).toBe('success');
    } finally {
      setLogLevel(originalLevel);
    }
  });
});
