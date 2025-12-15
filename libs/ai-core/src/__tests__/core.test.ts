import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z, ZodError, type ZodType } from 'zod';

import type { BaseModel, ModelCallInput, ModelCallOutput } from '../core.js';
import { callJson } from '../json.js';
import {
  TimeoutError,
  applyMiddleware,
  withLogging,
  withRetry,
  withTimeout,
} from '../middleware.js';

type CallImplementation = (
  input: ModelCallInput
) => Promise<ModelCallOutput> | ModelCallOutput;

const createModel = (
  callImpl: CallImplementation,
  overrides?: Partial<BaseModel>
): BaseModel => {
  const call: BaseModel['call'] = vi.isMockFunction(callImpl)
    ? async (input) => callImpl(input)
    : vi.fn(async (input: ModelCallInput) => callImpl(input));

  return {
    name: overrides?.name ?? 'test-model',
    caps:
      overrides?.caps ?? {
        modes: ['text', 'json'],
        supportsJson: true,
        maxOutputTokens: 4_096,
        contextWindow: 8_192,
        costTier: 'standard',
        tags: ['general-purpose'],
      },
    call,
  };
};

describe('applyMiddleware', () => {
  it('composes middleware in declaration order', async () => {
    const baseCall = vi.fn<CallImplementation>(async () => ({ text: 'base' }));
    const model = createModel(baseCall);

    const order: string[] = [];
    const first = vi.fn((next) => async (input: ModelCallInput) => {
      order.push('first:before');
      const result = await next(input);
      order.push('first:after');
      return { text: `${result.text}->first` };
    });
    const second = vi.fn((next) => async (input: ModelCallInput) => {
      order.push('second:before');
      const result = await next(input);
      order.push('second:after');
      return { text: `${result.text}->second` };
    });

    const wrapped = applyMiddleware(model, first, second);
    const result = await wrapped.call({ prompt: 'hello' });

    expect(result.text).toBe('base->second->first');
    expect(order).toEqual([
      'first:before',
      'second:before',
      'second:after',
      'first:after',
    ]);
    expect(baseCall).toHaveBeenCalledTimes(1);
  });

  it('retains capability metadata on wrapped models', () => {
    const caps = {
      modes: ['text'] as const,
      supportsJson: false,
      maxOutputTokens: 2_048,
      contextWindow: 4_096,
      costTier: 'economy',
      tags: ['fallback', 'narration'] as const,
    } satisfies BaseModel['caps'];

    const baseCall = vi.fn<CallImplementation>(async () => ({ text: 'meta' }));
    const model = createModel(baseCall, { caps });
    const wrapped = applyMiddleware(model, withLogging());

    expect(wrapped.caps).toEqual(caps);
  });
});

describe('withRetry', () => {
  it('retries the configured number of times before succeeding', async () => {
    let attempts = 0;
    const baseCall = vi.fn<CallImplementation>(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(`attempt ${attempts}`);
      }

      return { text: 'success' };
    });
    const model = applyMiddleware(createModel(baseCall), withRetry({ retries: 2 }));

    await expect(model.call({ prompt: 'retry' })).resolves.toEqual({ text: 'success' });
    expect(baseCall).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when the predicate returns false', async () => {
    const baseCall = vi.fn<CallImplementation>(async () => {
      throw new Error('boom');
    });
    const shouldRetry = vi.fn(() => false);

    const model = applyMiddleware(
      createModel(baseCall),
      withRetry({ retries: 5, shouldRetry })
    );

    await expect(model.call({ prompt: 'retry' })).rejects.toThrow('boom');
    expect(baseCall).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the call finishes before the timeout', async () => {
    const baseCall = vi.fn<CallImplementation>(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ text: 'done' }), 10);
        })
    );
    const model = applyMiddleware(createModel(baseCall), withTimeout(20));

    const promise = model.call({ prompt: 'timeout' });
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual({ text: 'done' });
  });

  it('rejects with TimeoutError when the timeout elapses first', async () => {
    const baseCall = vi.fn<CallImplementation>(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ text: 'late' }), 20);
        })
    );
    const model = applyMiddleware(createModel(baseCall), withTimeout(10));

    const promise = model.call({ prompt: 'timeout' });
    const expectation = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10);

    await expectation;
  });
});

describe('withLogging', () => {
  it('logs start and success events', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const baseCall = vi.fn<CallImplementation>(async () => ({ text: 'ok' }));

    const model = applyMiddleware(
      createModel(baseCall),
      withLogging({ logger: { info, error } })
    );

    await model.call({ prompt: 'log me', mode: 'text' });

    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(1, 'Calling model: test-model', {
      mode: 'text',
    });
    expect(info.mock.calls[1][0]).toBe('Model test-model succeeded');
    expect(info.mock.calls[1][1]).toMatchObject({
      mode: 'text',
      durationMs: expect.any(Number),
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('logs failures via the error logger', async () => {
    const info = vi.fn();
    const error = vi.fn();
    const baseCall = vi.fn<CallImplementation>(async () => {
      throw new Error('kaput');
    });

    const model = applyMiddleware(
      createModel(baseCall),
      withLogging({ logger: { info, error } })
    );

    await expect(model.call({ prompt: 'fail' })).rejects.toThrow('kaput');

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('Calling model: test-model', {
      mode: 'text',
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toBe('Model test-model failed');
    expect(error.mock.calls[0][1]).toMatchObject({
      mode: 'text',
      durationMs: expect.any(Number),
      error: 'kaput',
    });
  });
});

describe('callJson', () => {
  it('invokes the model in json mode and validates the response', async () => {
    const schema = z.object({ message: z.string() });
    const baseCall = vi.fn<CallImplementation>(async (input) => {
      expect(input.mode).toBe('json');
      expect(input.jsonSchema).toBeDefined();

      const schemaType =
        typeof input.jsonSchema === 'object' &&
        input.jsonSchema !== null &&
        'type' in input.jsonSchema
          ? (input.jsonSchema as { type?: unknown }).type
          : undefined;

      expect(schemaType).toBe('object');
      expect(input.jsonSchema).not.toHaveProperty('$ref');
      return { text: JSON.stringify({ message: 'hello' }) };
    });
    const model = createModel(baseCall);

    const result = await callJson(model, { prompt: 'hi', schema });

    expect(result).toEqual({ message: 'hello' });
    expect(baseCall).toHaveBeenCalledTimes(1);
  });

  it('retains nested $ref entries for recursive schemas', async () => {
    type Tree = { label: string; children?: Tree[] };
    const schema: ZodType<Tree> = z.object({
      label: z.string(),
      children: z.array(z.lazy(() => schema)).optional(),
    });

    const baseCall = vi.fn<CallImplementation>(async (input) => {
      expect(input.mode).toBe('json');
      expect(input.jsonSchema).toBeDefined();
      const rootType =
        typeof input.jsonSchema === 'object' &&
        input.jsonSchema !== null &&
        'type' in input.jsonSchema
          ? (input.jsonSchema as { type?: unknown }).type
          : undefined;

      expect(rootType).toBe('object');
      expect(input.jsonSchema).not.toHaveProperty('$ref');
      expect(JSON.stringify(input.jsonSchema)).toContain('"$ref"');

      return { text: JSON.stringify({ label: 'root' }) };
    });

    const model = createModel(baseCall);

    const result = await callJson(model, { prompt: 'hi', schema });

    expect(result).toEqual({ label: 'root' });
    expect(baseCall).toHaveBeenCalledTimes(1);
  });

  it('throws when the model response is not valid JSON', async () => {
    const schema = z.object({ message: z.string() });
    const model = createModel(async () => ({ text: 'not-json' }));

    await expect(callJson(model, { prompt: 'hi', schema })).rejects.toThrow(
      'Failed to parse JSON response'
    );
  });

  it('propagates schema validation errors', async () => {
    const schema = z.object({ message: z.string() });
    const model = createModel(async () => ({ text: JSON.stringify({ message: 123 }) }));

    await expect(callJson(model, { prompt: 'hi', schema })).rejects.toBeInstanceOf(
      ZodError
    );
  });

  it('throws when the model does not support json mode', async () => {
    const schema = z.object({ message: z.string() });
    const model = createModel(async () => ({ text: '{}' }), {
      caps: { modes: ['text'] },
    });

    await expect(callJson(model, { prompt: 'hi', schema })).rejects.toThrow(
      'Model test-model does not support json mode.'
    );
  });
});
