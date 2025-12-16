import type {
  BaseModel,
  LoggingOptions,
  Middleware,
  ModelCallInput,
  ModelCallMode,
} from '@/lib/ai/core';
import { applyMiddleware, withLogging, withRetry, type RetryOptions } from '@/lib/ai/core';
import { createLogger, setLogLevel, type LogLevel } from '@/lib/ai/logger';

import { modelRegistry, type ModelRegistry } from './registry';
import { CostTier, type ModelKey, type ModelMetadata } from './types';

const sharedServiceRoutes = new Map<string, NormalizedServiceRouteConfig>();
const logger = createLogger('ai-providers:router');

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
      return this.instantiateModel(serviceName, overrideKey, route);
    }

    switch (route.strategy) {
      case ServiceRouteStrategy.Static:
        logger.debug('Resolved static service route', {
          serviceName,
          model: route.model,
        });
        return this.instantiateModel(serviceName, route.model, route);
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
    return this.applyRouteMiddleware(serviceName, base, route);
  }

  private applyRouteMiddleware(
    serviceName: string,
    model: BaseModel,
    route: NormalizedRouteOptions,
  ): BaseModel {
    const loggingOptions = route.logging ?? {};
    const retryOptions = route.retry ?? {};
    const middlewares: Middleware[] = [];

    middlewares.push(withLogging(loggingOptions));
    middlewares.push(withRetry(retryOptions));

    logger.debug('Applied middleware to model', {
      serviceName,
      modelName: model.name,
      hasCustomLogger: loggingOptions.logger !== undefined,
      retries: retryOptions.retries ?? 0,
    });

    return applyMiddleware(model, ...middlewares);
  }

  private createFailoverModel(
    serviceName: string,
    route: NormalizedFailoverRouteConfig,
  ): BaseModel {
    const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
    const caps = deriveSharedCapabilities(metadatas);

    const base: BaseModel = {
      name: `service:${serviceName}:failover`,
      caps,
      call: async (input: ModelCallInput) => {
        let lastError: unknown;
        for (const key of route.models) {
          try {
            logger.debug('Attempting failover candidate', {
              serviceName,
              modelKey: key,
            });
            const model = this.instantiateModel(serviceName, key, route);
            return await model.call(input);
          } catch (error) {
            logger.warn('Failover candidate failed', {
              serviceName,
              modelKey: key,
              error: error instanceof Error ? error.message : String(error),
            });
            lastError = error;
            continue;
          }
        }

        throw lastError ?? new Error(`All models failed for service "${serviceName}".`);
      },
    };
    return base;
  }

  private createRotatingFailoverModel(
    serviceName: string,
    route: NormalizedRotatingFailoverRouteConfig,
  ): BaseModel {
    const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
    const caps = deriveSharedCapabilities(metadatas);

    const base: BaseModel = {
      name: `service:${serviceName}:rotating_failover`,
      caps,
      call: async (input: ModelCallInput) => {
        const startingIndex = this.rotationState.get(serviceName) ?? 0;
        const nextIndex = (startingIndex + 1) % route.models.length;
        this.rotationState.set(serviceName, nextIndex);

        let lastError: unknown;

        for (let offset = 0; offset < route.models.length; offset += 1) {
          const candidateIndex = (startingIndex + offset) % route.models.length;
          const key = route.models[candidateIndex];

          try {
            logger.debug('Attempting rotating failover candidate', {
              serviceName,
              modelKey: key,
              startingIndex,
              candidateIndex,
            });
            const model = this.instantiateModel(serviceName, key, route);
            return await model.call(input);
          } catch (error) {
            logger.warn('Rotating failover candidate failed', {
              serviceName,
              modelKey: key,
              error: error instanceof Error ? error.message : String(error),
            });
            lastError = error;
            continue;
          }
        }

        throw lastError ?? new Error(`All models failed for service "${serviceName}".`);
      },
    };

    return base;
  }

  private createRoundRobinModel(
    serviceName: string,
    route: NormalizedRoundRobinRouteConfig,
  ): BaseModel {
    const metadatas = route.models.map((key) => this.getMetadataOrThrow(key));
    const caps = deriveSharedCapabilities(metadatas);

    const base: BaseModel = {
      name: `service:${serviceName}:round_robin`,
      caps,
      call: async (input: ModelCallInput) => {
        const currentIndex = this.rotationState.get(serviceName) ?? 0;
        const nextIndex = (currentIndex + 1) % route.models.length;
        this.rotationState.set(serviceName, nextIndex);
        const key = route.models[currentIndex];
        logger.debug('Selected round robin candidate', {
          serviceName,
          modelKey: key,
          nextIndex,
        });
        const model = this.instantiateModel(serviceName, key, route);
        return model.call(input);
      },
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
    const base = this.registry.create(winner.key);
    logger.info('Selected capability route winner', {
      serviceName,
      modelKey: winner.key,
      label: winner.label,
    });
    return this.applyRouteMiddleware(serviceName, base, route);
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

