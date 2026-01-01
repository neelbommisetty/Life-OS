import type {
  BaseModel,
  LoggingOptions,
  Middleware,
  ModelCallInput,
  ModelCallMode,
  ModelStreamChunk,
  ModelStreamResult,
  ModelCallAttempt,
  ModelCallTelemetry,
} from '@/lib/ai/core';
import { applyMiddleware, withLogging, type RetryOptions } from '@/lib/ai/core';
import { createLogger, setLogLevel, type LogLevel } from '@/lib/logger';

import { modelRegistry, type ModelRegistry } from './registry';
import { CostTier, type ModelKey, type ModelMetadata } from './types';

const sharedServiceRoutes = new Map<string, NormalizedServiceRouteConfig>();
const logger = createLogger('ai-providers:router');

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const attachTelemetryToError = (error: unknown, telemetry: ModelCallTelemetry): void => {
  if (!error || typeof error !== 'object') {
    return;
  }

  (error as { aiTelemetry?: ModelCallTelemetry }).aiTelemetry = telemetry;
};

const callWithRetry = async <T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<{ result: T; retriesUsed: number }> => {
  const {
    retries = 0,
    delayMs = 0,
    shouldRetry = () => true,
  } = options ?? {};

  let attempt = 0;
  let retriesUsed = 0;

  while (true) {
    try {
      const result = await fn();
      return { result, retriesUsed };
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error, attempt + 1)) {
        if (error && typeof error === 'object') {
          (error as { retriesUsed?: number }).retriesUsed = retriesUsed;
        }
        throw error;
      }

      const delay =
        typeof delayMs === 'function' ? delayMs(attempt + 1, error) : delayMs;

      if (delay > 0) {
        await sleep(delay);
      }

      attempt += 1;
      retriesUsed += 1;
    }
  }
};

const buildAttempt = (
  metadata: ModelMetadata | undefined,
  status: ModelCallAttempt['status'],
  startedAt: number | undefined,
  endedAt: number | undefined,
  error?: string,
  retryCount?: number,
): ModelCallAttempt => ({
  modelKey: metadata?.key,
  modelName: metadata?.label,
  providerId: metadata?.providerId,
  modelId: metadata?.modelId,
  status,
  error,
  startedAt,
  endedAt,
  durationMs:
    startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined,
  retryCount,
});

const buildTelemetry = (params: {
  serviceName: string;
  routeStrategy: string;
  modelMetadata?: ModelMetadata;
  attempts?: ModelCallAttempt[];
}): ModelCallTelemetry => ({
  serviceName: params.serviceName,
  routeStrategy: params.routeStrategy,
  modelKey: params.modelMetadata?.key,
  modelName: params.modelMetadata?.label,
  providerId: params.modelMetadata?.providerId,
  modelId: params.modelMetadata?.modelId,
  attempts: params.attempts && params.attempts.length > 0 ? params.attempts : undefined,
});

export enum ServiceRouteStrategy {
  Static = 'static',
  Failover = 'failover',
  RoundRobin = 'round_robin',
  RotatingFailover = 'rotating_failover',
  Capability = 'capability',
}

interface RouteOptions {
  readonly retry?: number | RetryOptions;
  readonly logging?: LoggingOptions;
}

interface NormalizedRouteOptions {
  readonly retry?: RetryOptions;
  readonly logging?: LoggingOptions;
}

export interface StaticRouteConfig extends RouteOptions {
  readonly strategy: ServiceRouteStrategy.Static;
  readonly model: ModelKey;
}

export interface FailoverRouteConfig extends RouteOptions {
  readonly strategy: ServiceRouteStrategy.Failover;
  readonly models: readonly ModelKey[];
}

export interface RoundRobinRouteConfig extends RouteOptions {
  readonly strategy: ServiceRouteStrategy.RoundRobin;
  readonly models: readonly ModelKey[];
}

export interface RotatingFailoverRouteConfig extends RouteOptions {
  readonly strategy: ServiceRouteStrategy.RotatingFailover;
  readonly models: readonly ModelKey[];
}

export interface CapabilityRouteConfig extends RouteOptions {
  readonly strategy: ServiceRouteStrategy.Capability;
  readonly filter: (metadata: ModelMetadata) => boolean;
  readonly candidates?: readonly ModelKey[];
  readonly sort?: (a: ModelMetadata, b: ModelMetadata) => number;
}

export type ServiceRouteConfig =
  | StaticRouteConfig
  | FailoverRouteConfig
  | RoundRobinRouteConfig
  | RotatingFailoverRouteConfig
  | CapabilityRouteConfig;

interface NormalizedStaticRouteConfig extends NormalizedRouteOptions {
  readonly strategy: ServiceRouteStrategy.Static;
  readonly model: ModelKey;
}

interface NormalizedFailoverRouteConfig extends NormalizedRouteOptions {
  readonly strategy: ServiceRouteStrategy.Failover;
  readonly models: readonly ModelKey[];
}

interface NormalizedRoundRobinRouteConfig extends NormalizedRouteOptions {
  readonly strategy: ServiceRouteStrategy.RoundRobin;
  readonly models: readonly ModelKey[];
}

interface NormalizedRotatingFailoverRouteConfig extends NormalizedRouteOptions {
  readonly strategy: ServiceRouteStrategy.RotatingFailover;
  readonly models: readonly ModelKey[];
}

interface NormalizedCapabilityRouteConfig extends NormalizedRouteOptions {
  readonly strategy: ServiceRouteStrategy.Capability;
  readonly filter: (metadata: ModelMetadata) => boolean;
  readonly candidates?: readonly ModelKey[];
  readonly sort?: (a: ModelMetadata, b: ModelMetadata) => number;
}

type NormalizedServiceRouteConfig =
  | NormalizedStaticRouteConfig
  | NormalizedFailoverRouteConfig
  | NormalizedRoundRobinRouteConfig
  | NormalizedRotatingFailoverRouteConfig
  | NormalizedCapabilityRouteConfig;

const COST_RANK: Record<CostTier, number> = {
  [CostTier.Economy]: 0,
  [CostTier.Standard]: 1,
  [CostTier.Premium]: 2,
  [CostTier.Enterprise]: 3,
};

const defaultCapabilitySort = (a: ModelMetadata, b: ModelMetadata): number => {
  const costRankA = getCostRank(a.costTier);
  const costRankB = getCostRank(b.costTier);

  if (costRankA !== costRankB) {
    return costRankA - costRankB;
  }

  return a.label.localeCompare(b.label);
};

const getCostRank = (tier?: CostTier): number =>
  tier === undefined ? Number.POSITIVE_INFINITY : (COST_RANK[tier] ?? Number.POSITIVE_INFINITY);

const normalizeRetryOptions = (retry?: number | RetryOptions): RetryOptions | undefined => {
  if (typeof retry === 'number') {
    return { retries: retry };
  }

  return retry ? { ...retry } : undefined;
};

const normalizeRouteConfig = (config: ServiceRouteConfig): NormalizedServiceRouteConfig => {
  const retry = normalizeRetryOptions(config.retry);
  const logging = config.logging ? { ...config.logging } : undefined;

  switch (config.strategy) {
    case ServiceRouteStrategy.Static: {
      if (!config.model) {
        throw new Error('Static service routes must provide a model key.');
      }

      return {
        strategy: ServiceRouteStrategy.Static,
        model: config.model,
        retry,
        logging,
      };
    }
    case ServiceRouteStrategy.Failover: {
      if (!config.models?.length) {
        throw new Error('Failover service routes must provide at least one model key.');
      }

      return {
        strategy: ServiceRouteStrategy.Failover,
        models: Array.from(config.models),
        retry,
        logging,
      };
    }
    case ServiceRouteStrategy.RoundRobin: {
      if (!config.models?.length) {
        throw new Error('Round robin service routes must provide at least one model key.');
      }

      return {
        strategy: ServiceRouteStrategy.RoundRobin,
        models: Array.from(config.models),
        retry,
        logging,
      };
    }
    case ServiceRouteStrategy.RotatingFailover: {
      if (!config.models?.length) {
        throw new Error('Rotating failover service routes must provide at least one model key.');
      }

      return {
        strategy: ServiceRouteStrategy.RotatingFailover,
        models: Array.from(config.models),
        retry,
        logging,
      };
    }
    case ServiceRouteStrategy.Capability: {
      return {
        strategy: ServiceRouteStrategy.Capability,
        filter: config.filter,
        candidates: config.candidates ? Array.from(config.candidates) : undefined,
        sort: config.sort,
        retry,
        logging,
      };
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported service route strategy: ${exhaustive}`);
    }
  }
};

const deriveSharedCapabilities = (metas: readonly ModelMetadata[]): BaseModel['caps'] => {
  if (metas.length === 0) {
    return { modes: [] };
  }

  const [first, ...rest] = metas;
  const sharedModes = rest.reduce<ModelCallMode[]>((acc, meta) => {
    const supported = new Set(meta.modes);
    return acc.filter((mode) => supported.has(mode));
  }, Array.from(first.modes));

  const resolvedModes: readonly ModelCallMode[] =
    sharedModes.length > 0 ? sharedModes : Array.from(first.modes);

  const supportsJson = metas.every((meta) => meta.supportsJson === true);
  const supportsStreaming = metas.some((meta) => meta.supportsStreaming === true);

  const maxOutputTokens = metas.reduce<number | undefined>((value, meta) => {
    if (meta.maxOutputTokens === undefined) {
      return value;
    }

    if (value === undefined) {
      return meta.maxOutputTokens;
    }

    return Math.min(value, meta.maxOutputTokens);
  }, undefined);

  const contextWindow = metas.reduce<number | undefined>((value, meta) => {
    if (meta.contextWindow === undefined) {
      return value;
    }

    if (value === undefined) {
      return meta.contextWindow;
    }

    return Math.min(value, meta.contextWindow);
  }, undefined);

  const highestCostTier = metas.reduce<CostTier | undefined>((value, meta) => {
    if (!meta.costTier) {
      return value;
    }

    if (!value) {
      return meta.costTier;
    }

    return getCostRank(meta.costTier) > getCostRank(value) ? meta.costTier : value;
  }, undefined);

  return {
    modes: resolvedModes,
    supportsJson: supportsJson,
    supportsStreaming,
    maxOutputTokens,
    contextWindow,
    costTier: highestCostTier,
  };
};

export class ModelRouter {
  private readonly rotationState = new Map<string, number>();

  constructor(
    private readonly registry: ModelRegistry = modelRegistry,
    private readonly routes: Map<string, NormalizedServiceRouteConfig> = sharedServiceRoutes,
  ) {}

  registerServiceRoute(serviceName: string, config: ServiceRouteConfig): void {
    if (!serviceName) {
      throw new Error('Service name must be provided when registering a route.');
    }

    const normalized = normalizeRouteConfig(config);
    this.routes.set(serviceName, normalized);
    this.rotationState.delete(serviceName);

    logger.info('Registered service route', {
      serviceName,
      strategy: normalized.strategy,
      hasLoggingOverride: normalized.logging !== undefined,
      hasRetryOverride: normalized.retry !== undefined,
    });
  }

  getModelFor(serviceName: string, overrideKey?: ModelKey): BaseModel {
    const route = this.routes.get(serviceName);

    if (!route) {
      logger.error('Attempted to resolve model for unregistered service', { serviceName });
      throw new Error(`No service route registered for "${serviceName}".`);
    }

    if (overrideKey) {
      logger.info('Resolving model override for service', {
        serviceName,
        overrideKey,
      });
      return this.createSingleModelRoute(serviceName, overrideKey, route, 'override');
    }

    switch (route.strategy) {
      case ServiceRouteStrategy.Static:
        logger.debug('Resolved static service route', {
          serviceName,
          model: route.model,
        });
        return this.createSingleModelRoute(
          serviceName,
          route.model,
          route,
          ServiceRouteStrategy.Static,
        );
      case ServiceRouteStrategy.Failover:
        return this.createFailoverModel(serviceName, route);
      case ServiceRouteStrategy.RoundRobin:
        return this.createRoundRobinModel(serviceName, route);
      case ServiceRouteStrategy.RotatingFailover:
        return this.createRotatingFailoverModel(serviceName, route);
      case ServiceRouteStrategy.Capability:
        return this.createCapabilityModel(serviceName, route);
      default: {
        const exhaustive: never = route;
        throw new Error(`Unsupported service route strategy: ${exhaustive}`);
      }
    }
  }

  private instantiateModel(
    serviceName: string,
    key: ModelKey,
    route: NormalizedServiceRouteConfig,
  ): BaseModel {
    const base = this.registry.create(key);
    logger.debug('Instantiated model from registry', {
      serviceName,
      modelKey: key,
      modelName: base.name,
    });
    return this.applyRouteMiddleware(serviceName, base, route, key);
  }

  private applyRouteMiddleware(
    serviceName: string,
    model: BaseModel,
    route: NormalizedRouteOptions,
    modelKey?: ModelKey,
  ): BaseModel {
    const loggingOptions = route.logging ?? {};
    const retryOptions = route.retry ?? {};
    const middlewares: Middleware[] = [];
    const defaultLogger = createLogger('ai-providers:model-call');
    const baseLogger = loggingOptions.logger ?? {};
    const context = {
      serviceName,
      ...(modelKey ? { modelKey } : {}),
    };

    const withContext =
      (fn: (message: string, logContext?: Record<string, unknown>) => void) =>
      (message: string, logContext?: Record<string, unknown>) =>
        fn(message, logContext ? { ...context, ...logContext } : context);

    const contextualLogger = {
      trace: withContext(baseLogger.trace ?? defaultLogger.trace),
      debug: withContext(baseLogger.debug ?? defaultLogger.debug),
      info: withContext(baseLogger.info ?? defaultLogger.info),
      warn: withContext(baseLogger.warn ?? defaultLogger.warn),
      error: withContext(baseLogger.error ?? defaultLogger.error),
      fatal: withContext(baseLogger.fatal ?? defaultLogger.fatal),
    };

    middlewares.push(withLogging({ ...loggingOptions, logger: contextualLogger }));

    logger.debug('Applied middleware to model', {
      serviceName,
      modelKey,
      modelName: model.name,
      hasCustomLogger: loggingOptions.logger !== undefined,
      retries: retryOptions.retries ?? 0,
    });

    return applyMiddleware(model, ...middlewares);
  }

  private createSingleModelRoute(
    serviceName: string,
    modelKey: ModelKey,
    route: NormalizedRouteOptions,
    routeStrategy: string,
  ): BaseModel {
    const model = this.instantiateModel(serviceName, modelKey, route);
    const metadata = this.getMetadataOrThrow(modelKey);

    return {
      name: model.name,
      caps: model.caps,
      call: async (input: ModelCallInput) => {
        const startedAt = Date.now();
        try {
          const { result, retriesUsed } = await callWithRetry(
            () => model.call(input),
            route.retry,
          );
          const endedAt = Date.now();
          const attempts = [
            buildAttempt(metadata, 'success', startedAt, endedAt, undefined, retriesUsed),
          ];
          const telemetry = buildTelemetry({
            serviceName,
            routeStrategy,
            modelMetadata: metadata,
            attempts,
          });
          return { ...result, telemetry };
        } catch (error) {
          const endedAt = Date.now();
          const retriesUsed =
            error && typeof error === 'object'
              ? (error as { retriesUsed?: number }).retriesUsed
              : undefined;
          const attempts = [
            buildAttempt(
              metadata,
              'error',
              startedAt,
              endedAt,
              toErrorMessage(error),
              retriesUsed,
            ),
          ];
          const telemetry = buildTelemetry({
            serviceName,
            routeStrategy,
            modelMetadata: metadata,
            attempts,
          });
          attachTelemetryToError(error, telemetry);
          throw error;
        }
      },
      ...(model.streamCall
        ? {
            async *streamCall(
              input: ModelCallInput,
            ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
              const startedAt = Date.now();
              let accumulatedText = '';
              let usage: ModelStreamResult['usage'];

              try {
                const generator = model.streamCall!(input);

                while (true) {
                  const { value, done } = await generator.next();
                  if (done) {
                    const finalText = value?.text?.length ? value.text : accumulatedText;
                    usage = value?.usage ?? usage;
                    const endedAt = Date.now();
                    const attempts = [
                      buildAttempt(metadata, 'success', startedAt, endedAt, undefined, 0),
                    ];
                    const telemetry = buildTelemetry({
                      serviceName,
                      routeStrategy,
                      modelMetadata: metadata,
                      attempts,
                    });
                    return { text: finalText, usage, telemetry };
                  }

                  if (value?.text) {
                    accumulatedText += value.text;
                  }

                  yield value;
                }
              } catch (error) {
                const endedAt = Date.now();
                const attempts = [
                  buildAttempt(metadata, 'error', startedAt, endedAt, toErrorMessage(error)),
                ];
                const telemetry = buildTelemetry({
                  serviceName,
                  routeStrategy,
                  modelMetadata: metadata,
                  attempts,
                });
                attachTelemetryToError(error, telemetry);
                throw error;
              }
            },
          }
        : {}),
    };
  }

  private createFailoverModel(
    serviceName: string,
    route: NormalizedFailoverRouteConfig,
  ): BaseModel {
    const resolveMetadata = (key: ModelKey) => this.getMetadataOrThrow(key);
    const metadatas = route.models.map(resolveMetadata);
    const caps = deriveSharedCapabilities(metadatas);
    const instantiateModel = this.instantiateModel.bind(this);

    const base: BaseModel = {
      name: `service:${serviceName}:failover`,
      caps,
      call: async (input: ModelCallInput) => {
        let lastError: unknown;
        const attempts: ModelCallAttempt[] = [];
        for (const key of route.models) {
          const metadata = resolveMetadata(key);
          const startedAt = Date.now();
          try {
            logger.debug('Attempting failover candidate', {
              serviceName,
              modelKey: key,
            });
            const model = instantiateModel(serviceName, key, route);
            const { result, retriesUsed } = await callWithRetry(
              () => model.call(input),
              route.retry,
            );
            const endedAt = Date.now();
            attempts.push(
              buildAttempt(metadata, 'success', startedAt, endedAt, undefined, retriesUsed),
            );
            const telemetry = buildTelemetry({
              serviceName,
              routeStrategy: ServiceRouteStrategy.Failover,
              modelMetadata: metadata,
              attempts,
            });
            return { ...result, telemetry };
          } catch (error) {
            logger.warn('Failover candidate failed', {
              serviceName,
              modelKey: key,
              error: error instanceof Error ? error.message : String(error),
            });
            const endedAt = Date.now();
            const retriesUsed =
              error && typeof error === 'object'
                ? (error as { retriesUsed?: number }).retriesUsed
                : undefined;
            attempts.push(
              buildAttempt(
                metadata,
                'error',
                startedAt,
                endedAt,
                toErrorMessage(error),
                retriesUsed,
              ),
            );
            lastError = error;
            continue;
          }
        }

        const telemetry = buildTelemetry({
          serviceName,
          routeStrategy: ServiceRouteStrategy.Failover,
          attempts,
        });
        const finalError =
          lastError ?? new Error(`All models failed for service "${serviceName}".`);
        attachTelemetryToError(finalError, telemetry);
        throw finalError;
      },
      ...(caps.supportsStreaming
        ? {
            async *streamCall(
              input: ModelCallInput,
            ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
              let lastError: unknown;
              const attempts: ModelCallAttempt[] = [];

              for (const key of route.models) {
                const candidate = instantiateModel(serviceName, key, route);
                const metadata = resolveMetadata(key);

                if (!candidate.streamCall) {
                  const skippedAt = Date.now();
                  attempts.push(
                    buildAttempt(
                      metadata,
                      'error',
                      skippedAt,
                      skippedAt,
                      'streaming_not_supported',
                    ),
                  );
                  continue;
                }

                let yieldedAny = false;
                let accumulatedText = '';
                let usage: ModelStreamResult['usage'];
                const startedAt = Date.now();

                try {
                  const generator = candidate.streamCall(input);
                  while (true) {
                    const { value, done } = await generator.next();
                    if (done) {
                      const finalText = value?.text?.length ? value.text : accumulatedText;
                      usage = value?.usage ?? usage;
                      const endedAt = Date.now();
                      attempts.push(
                        buildAttempt(metadata, 'success', startedAt, endedAt, undefined, 0),
                      );
                      const telemetry = buildTelemetry({
                        serviceName,
                        routeStrategy: ServiceRouteStrategy.Failover,
                        modelMetadata: metadata,
                        attempts,
                      });
                      return { text: finalText, usage, telemetry };
                    }

                    if (value?.text) {
                      yieldedAny = true;
                      accumulatedText += value.text;
                    }

                    yield value;
                  }
                } catch (error) {
                  const endedAt = Date.now();
                  attempts.push(
                    buildAttempt(metadata, 'error', startedAt, endedAt, toErrorMessage(error)),
                  );
                  // If we haven't yielded anything yet, we can try the next candidate.
                  if (!yieldedAny) {
                    lastError = error;
                    continue;
                  }
                  const telemetry = buildTelemetry({
                    serviceName,
                    routeStrategy: ServiceRouteStrategy.Failover,
                    modelMetadata: metadata,
                    attempts,
                  });
                  attachTelemetryToError(error, telemetry);
                  throw error;
                }
              }

              const telemetry = buildTelemetry({
                serviceName,
                routeStrategy: ServiceRouteStrategy.Failover,
                attempts,
              });
              const finalError =
                lastError ?? new Error(`No streaming-capable models available for "${serviceName}".`);
              attachTelemetryToError(finalError, telemetry);
              throw finalError;
            },
          }
        : {}),
    };
    return base;
  }

  private createRotatingFailoverModel(
    serviceName: string,
    route: NormalizedRotatingFailoverRouteConfig,
  ): BaseModel {
    const resolveMetadata = (key: ModelKey) => this.getMetadataOrThrow(key);
    const metadatas = route.models.map(resolveMetadata);
    const caps = deriveSharedCapabilities(metadatas);
    const instantiateModel = this.instantiateModel.bind(this);
    const rotationState = this.rotationState;

    const base: BaseModel = {
      name: `service:${serviceName}:rotating_failover`,
      caps,
      call: async (input: ModelCallInput) => {
        const startingIndex = rotationState.get(serviceName) ?? 0;
        const nextIndex = (startingIndex + 1) % route.models.length;
        rotationState.set(serviceName, nextIndex);

        let lastError: unknown;
        const attempts: ModelCallAttempt[] = [];

        for (let offset = 0; offset < route.models.length; offset += 1) {
          const candidateIndex = (startingIndex + offset) % route.models.length;
          const key = route.models[candidateIndex];
          const metadata = resolveMetadata(key);
          const startedAt = Date.now();

          try {
            logger.debug('Attempting rotating failover candidate', {
              serviceName,
              modelKey: key,
              startingIndex,
              candidateIndex,
            });
            const model = instantiateModel(serviceName, key, route);
            const { result, retriesUsed } = await callWithRetry(
              () => model.call(input),
              route.retry,
            );
            const endedAt = Date.now();
            attempts.push(
              buildAttempt(metadata, 'success', startedAt, endedAt, undefined, retriesUsed),
            );
            const telemetry = buildTelemetry({
              serviceName,
              routeStrategy: ServiceRouteStrategy.RotatingFailover,
              modelMetadata: metadata,
              attempts,
            });
            return { ...result, telemetry };
          } catch (error) {
            logger.warn('Rotating failover candidate failed', {
              serviceName,
              modelKey: key,
              error: error instanceof Error ? error.message : String(error),
            });
            const endedAt = Date.now();
            const retriesUsed =
              error && typeof error === 'object'
                ? (error as { retriesUsed?: number }).retriesUsed
                : undefined;
            attempts.push(
              buildAttempt(
                metadata,
                'error',
                startedAt,
                endedAt,
                toErrorMessage(error),
                retriesUsed,
              ),
            );
            lastError = error;
            continue;
          }
        }

        const telemetry = buildTelemetry({
          serviceName,
          routeStrategy: ServiceRouteStrategy.RotatingFailover,
          attempts,
        });
        const finalError =
          lastError ?? new Error(`All models failed for service "${serviceName}".`);
        attachTelemetryToError(finalError, telemetry);
        throw finalError;
      },
      ...(caps.supportsStreaming
        ? {
            async *streamCall(
              input: ModelCallInput,
            ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
              const startingIndex = rotationState.get(serviceName) ?? 0;
              const nextIndex = (startingIndex + 1) % route.models.length;
              rotationState.set(serviceName, nextIndex);
              const attempts: ModelCallAttempt[] = [];

              for (let offset = 0; offset < route.models.length; offset += 1) {
                const candidateIndex = (startingIndex + offset) % route.models.length;
                const key = route.models[candidateIndex];
                const candidate = instantiateModel(serviceName, key, route);
                const metadata = resolveMetadata(key);

                if (!candidate.streamCall) {
                  const skippedAt = Date.now();
                  attempts.push(
                    buildAttempt(
                      metadata,
                      'error',
                      skippedAt,
                      skippedAt,
                      'streaming_not_supported',
                    ),
                  );
                  continue;
                }

                let accumulatedText = '';
                let usage: ModelStreamResult['usage'];
                const startedAt = Date.now();
                try {
                  const generator = candidate.streamCall(input);
                  while (true) {
                    const { value, done } = await generator.next();
                    if (done) {
                      const finalText = value?.text?.length ? value.text : accumulatedText;
                      usage = value?.usage ?? usage;
                      const endedAt = Date.now();
                      attempts.push(
                        buildAttempt(metadata, 'success', startedAt, endedAt, undefined, 0),
                      );
                      const telemetry = buildTelemetry({
                        serviceName,
                        routeStrategy: ServiceRouteStrategy.RotatingFailover,
                        modelMetadata: metadata,
                        attempts,
                      });
                      return { text: finalText, usage, telemetry };
                    }

                    if (value?.text) {
                      accumulatedText += value.text;
                    }

                    yield value;
                  }
                } catch (error) {
                  const endedAt = Date.now();
                  attempts.push(
                    buildAttempt(metadata, 'error', startedAt, endedAt, toErrorMessage(error)),
                  );
                  continue;
                }
              }

              // Fallback: do a blocking call on the first model if streaming not available.
              const key = route.models[startingIndex];
              const model = instantiateModel(serviceName, key, route);
              const metadata = resolveMetadata(key);
              const startedAt = Date.now();
              try {
                const { result, retriesUsed } = await callWithRetry(
                  () => model.call(input),
                  route.retry,
                );
                const endedAt = Date.now();
                attempts.push(
                  buildAttempt(
                    metadata,
                    'success',
                    startedAt,
                    endedAt,
                    undefined,
                    retriesUsed,
                  ),
                );
                const telemetry = buildTelemetry({
                  serviceName,
                  routeStrategy: ServiceRouteStrategy.RotatingFailover,
                  modelMetadata: metadata,
                  attempts,
                });
                yield { text: result.text, done: true };
                return { text: result.text, usage: result.usage, telemetry };
              } catch (error) {
                const endedAt = Date.now();
                const retriesUsed =
                  error && typeof error === 'object'
                    ? (error as { retriesUsed?: number }).retriesUsed
                    : undefined;
                attempts.push(
                  buildAttempt(
                    metadata,
                    'error',
                    startedAt,
                    endedAt,
                    toErrorMessage(error),
                    retriesUsed,
                  ),
                );
                const telemetry = buildTelemetry({
                  serviceName,
                  routeStrategy: ServiceRouteStrategy.RotatingFailover,
                  modelMetadata: metadata,
                  attempts,
                });
                attachTelemetryToError(error, telemetry);
                throw error;
              }
            },
          }
        : {}),
    };

    return base;
  }

  private createRoundRobinModel(
    serviceName: string,
    route: NormalizedRoundRobinRouteConfig,
  ): BaseModel {
    const resolveMetadata = (key: ModelKey) => this.getMetadataOrThrow(key);
    const metadatas = route.models.map(resolveMetadata);
    const caps = deriveSharedCapabilities(metadatas);
    const instantiateModel = this.instantiateModel.bind(this);
    const rotationState = this.rotationState;

    const base: BaseModel = {
      name: `service:${serviceName}:round_robin`,
      caps,
      call: async (input: ModelCallInput) => {
        const currentIndex = rotationState.get(serviceName) ?? 0;
        const nextIndex = (currentIndex + 1) % route.models.length;
        rotationState.set(serviceName, nextIndex);
        const key = route.models[currentIndex];
        logger.debug('Selected round robin candidate', {
          serviceName,
          modelKey: key,
          nextIndex,
        });
        const model = instantiateModel(serviceName, key, route);
        const metadata = resolveMetadata(key);
        const startedAt = Date.now();
        try {
          const { result, retriesUsed } = await callWithRetry(
            () => model.call(input),
            route.retry,
          );
          const endedAt = Date.now();
          const attempts = [
            buildAttempt(metadata, 'success', startedAt, endedAt, undefined, retriesUsed),
          ];
          const telemetry = buildTelemetry({
            serviceName,
            routeStrategy: ServiceRouteStrategy.RoundRobin,
            modelMetadata: metadata,
            attempts,
          });
          return { ...result, telemetry };
        } catch (error) {
          const endedAt = Date.now();
          const retriesUsed =
            error && typeof error === 'object'
              ? (error as { retriesUsed?: number }).retriesUsed
              : undefined;
          const attempts = [
            buildAttempt(
              metadata,
              'error',
              startedAt,
              endedAt,
              toErrorMessage(error),
              retriesUsed,
            ),
          ];
          const telemetry = buildTelemetry({
            serviceName,
            routeStrategy: ServiceRouteStrategy.RoundRobin,
            modelMetadata: metadata,
            attempts,
          });
          attachTelemetryToError(error, telemetry);
          throw error;
        }
      },
      ...(caps.supportsStreaming
        ? {
            async *streamCall(
              input: ModelCallInput,
            ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
              const currentIndex = rotationState.get(serviceName) ?? 0;
              const nextIndex = (currentIndex + 1) % route.models.length;
              rotationState.set(serviceName, nextIndex);
              const key = route.models[currentIndex];

              const model = instantiateModel(serviceName, key, route);
              const metadata = resolveMetadata(key);
              const startedAt = Date.now();
              if (model.streamCall) {
                let accumulatedText = '';
                let usage: ModelStreamResult['usage'];
                try {
                  const generator = model.streamCall(input);
                  while (true) {
                    const { value, done } = await generator.next();
                    if (done) {
                      const finalText = value?.text?.length ? value.text : accumulatedText;
                      usage = value?.usage ?? usage;
                      const endedAt = Date.now();
                      const attempts = [
                        buildAttempt(metadata, 'success', startedAt, endedAt, undefined, 0),
                      ];
                      const telemetry = buildTelemetry({
                        serviceName,
                        routeStrategy: ServiceRouteStrategy.RoundRobin,
                        modelMetadata: metadata,
                        attempts,
                      });
                      return { text: finalText, usage, telemetry };
                    }

                    if (value?.text) {
                      accumulatedText += value.text;
                    }

                    yield value;
                  }
                } catch (error) {
                  const endedAt = Date.now();
                  const attempts = [
                    buildAttempt(metadata, 'error', startedAt, endedAt, toErrorMessage(error)),
                  ];
                  const telemetry = buildTelemetry({
                    serviceName,
                    routeStrategy: ServiceRouteStrategy.RoundRobin,
                    modelMetadata: metadata,
                    attempts,
                  });
                  attachTelemetryToError(error, telemetry);
                  throw error;
                }
              }

              // Fallback to blocking call if selected model isn't streaming-capable.
              const startedFallbackAt = Date.now();
              try {
                const { result, retriesUsed } = await callWithRetry(
                  () => model.call(input),
                  route.retry,
                );
                const endedAt = Date.now();
                const attempts = [
                  buildAttempt(
                    metadata,
                    'success',
                    startedFallbackAt,
                    endedAt,
                    undefined,
                    retriesUsed,
                  ),
                ];
                const telemetry = buildTelemetry({
                  serviceName,
                  routeStrategy: ServiceRouteStrategy.RoundRobin,
                  modelMetadata: metadata,
                  attempts,
                });
                yield { text: result.text, done: true };
                return { text: result.text, usage: result.usage, telemetry };
              } catch (error) {
                const endedAt = Date.now();
                const retriesUsed =
                  error && typeof error === 'object'
                    ? (error as { retriesUsed?: number }).retriesUsed
                    : undefined;
                const attempts = [
                  buildAttempt(
                    metadata,
                    'error',
                    startedFallbackAt,
                    endedAt,
                    toErrorMessage(error),
                    retriesUsed,
                  ),
                ];
                const telemetry = buildTelemetry({
                  serviceName,
                  routeStrategy: ServiceRouteStrategy.RoundRobin,
                  modelMetadata: metadata,
                  attempts,
                });
                attachTelemetryToError(error, telemetry);
                throw error;
              }
            },
          }
        : {}),
    };
    return base;
  }

  private createCapabilityModel(
    serviceName: string,
    route: NormalizedCapabilityRouteConfig,
  ): BaseModel {
    const candidateMetas = route.candidates
      ? route.candidates.map((key) => this.getMetadataOrThrow(key))
      : this.registry.listMetadata();

    const matches = candidateMetas.filter(route.filter);

    if (matches.length === 0) {
      throw new Error(
        `No models available for service "${serviceName}" that match the capability filter.`,
      );
    }

    const sorter = route.sort ?? defaultCapabilitySort;
    const [winner] = [...matches].sort(sorter);
    logger.info('Selected capability route winner', {
      serviceName,
      modelKey: winner.key,
      label: winner.label,
    });
    return this.createSingleModelRoute(
      serviceName,
      winner.key,
      route,
      ServiceRouteStrategy.Capability,
    );
  }

  private getMetadataOrThrow(key: ModelKey): ModelMetadata {
    const metadata = this.registry.getMetadata(key);

    if (!metadata) {
      throw new Error(`Model "${key}" has not been registered.`);
    }

    return metadata;
  }
}

export const setModelRouterLogLevel = (level: LogLevel): void => {
  setLogLevel(level);
};

const defaultRouter = new ModelRouter();

export const registerServiceRoute = (serviceName: string, config: ServiceRouteConfig): void => {
  defaultRouter.registerServiceRoute(serviceName, config);
};

export const getModelFor = (serviceName: string, overrideKey?: ModelKey): BaseModel =>
  defaultRouter.getModelFor(serviceName, overrideKey);
