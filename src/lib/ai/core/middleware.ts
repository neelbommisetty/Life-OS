import { createLogger, type Logger } from '@/lib/logger';

import type { BaseModel } from './core';

type BaseModelCallResult = Awaited<ReturnType<BaseModel['call']>>;

export type Middleware = (
  next: BaseModel['call'],
  model: BaseModel,
) => BaseModel['call'];

export const applyMiddleware = (
  model: BaseModel,
  ...middlewares: Middleware[]
): BaseModel => {
  const boundCall: BaseModel['call'] = model.call.bind(model);
  const call = middlewares.reduceRight<BaseModel['call']>(
    (next, middleware) => middleware(next, model),
    boundCall
  );

  const streamCall = model.streamCall ? model.streamCall.bind(model) : undefined;

  return {
    name: model.name,
    caps: model.caps,
    call,
    ...(streamCall ? { streamCall } : {}),
  };
};

export interface RetryOptions {
  readonly retries?: number;
  readonly delayMs?: number | ((attempt: number, error: unknown) => number);
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export const withRetry = (options: RetryOptions = {}): Middleware => {
  const {
    retries = 2,
    delayMs = 0,
    shouldRetry = () => true,
  } = options;

  return (next) => async (input) => {
    let attempt = 0;

    while (true) {
      try {
        return await next(input);
      } catch (error) {
        if (attempt >= retries || !shouldRetry(error, attempt + 1)) {
          throw error;
        }

        const delay =
          typeof delayMs === 'function' ? delayMs(attempt + 1, error) : delayMs;

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        attempt += 1;
      }
    }
  };
};

export class TimeoutError extends Error {
  constructor(message = 'Model call timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export const withTimeout = (ms: number): Middleware => {
  if (ms <= 0) {
    throw new Error('Timeout duration must be greater than zero.');
  }

  return (next) => async (input) =>
    new Promise<BaseModelCallResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError());
      }, ms);

      next(input)
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
};

export interface LoggingOptions {
  readonly logger?: Partial<Logger>;
}

export const withLogging = (options: LoggingOptions = {}): Middleware => {
  const { logger } = options;
  const defaultLogger = createLogger('ai-core:middleware');
  const debug = logger?.debug ?? logger?.info ?? defaultLogger.debug;
  const info = logger?.info ?? defaultLogger.info;
  const error = logger?.error ?? logger?.fatal ?? defaultLogger.error;

  return (next, model) => async (input) => {
    const start = Date.now();
    debug(`Calling model: ${model.name}`, {
      mode: input.mode ?? 'text',
    });

    try {
      const result = await next(input);
      info(`Model ${model.name} succeeded`, {
        mode: input.mode ?? 'text',
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      error(`Model ${model.name} failed`, {
        mode: input.mode ?? 'text',
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
};
