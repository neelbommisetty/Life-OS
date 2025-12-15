import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLogLevel, setLogLevel } from '@writers-block/logger';

import type { BaseModel, ModelCallInput, ModelCallOutput } from '../core.js';
import { applyMiddleware, withLogging } from '../middleware.js';

type CallImplementation = (
  input: ModelCallInput,
) => Promise<ModelCallOutput> | ModelCallOutput;

const createModel = (callImpl: CallImplementation): BaseModel => ({
  name: 'test-model',
  caps: { modes: ['text'] },
  call: vi.fn(async (input: ModelCallInput) => callImpl(input)),
});

describe('withLogging (default logger)', () => {
  const originalLevel = getLogLevel();

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel(originalLevel);
  });

  it('suppresses debug output while retaining info at the INFO level', async () => {
    setLogLevel('INFO');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const model = applyMiddleware(
      createModel(async () => ({ text: 'ok' })),
      withLogging(),
    );

    await model.call({ prompt: 'hello' });

    expect(debug).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Model test-model succeeded'),
      expect.objectContaining({ mode: 'text', durationMs: expect.any(Number) }),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('emits timing details when verbose logging is enabled', async () => {
    setLogLevel('TRACE');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const model = applyMiddleware(
      createModel(async () => ({ text: 'ok' })),
      withLogging(),
    );

    await model.call({ prompt: 'hello', mode: 'json' });

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Calling model: test-model'),
      { mode: 'json' },
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Model test-model succeeded'),
      expect.objectContaining({ mode: 'json', durationMs: expect.any(Number) }),
    );
  });

  it('logs failures through the default logger when verbose logging is enabled', async () => {
    setLogLevel('DEBUG');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const model = applyMiddleware(
      createModel(async () => {
        throw new Error('nope');
      }),
      withLogging(),
    );

    await expect(model.call({ prompt: 'boom' })).rejects.toThrow('nope');

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Model test-model failed'),
      expect.objectContaining({
        mode: 'text',
        error: 'nope',
        durationMs: expect.any(Number),
      }),
    );
  });
});
