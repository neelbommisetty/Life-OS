import type { BaseModel } from "../core";
import { createLogger } from "../logger";

import type {
  ModelDefinition,
  ModelFactoryOptions,
  ModelKey,
  ModelMetadata,
  ProviderId,
} from './types';

export class ModelRegistry {
  private readonly models = new Map<ModelKey, ModelDefinition>();

  private readonly logger = createLogger('ai-providers:registry');

  register(definition: ModelDefinition): void {
    const { metadata } = definition;

    if (this.models.has(metadata.key)) {
      throw new Error(`Model "${metadata.key}" has already been registered.`);
    }

    this.logger.debug('Registering model', {
      key: metadata.key,
      providerId: metadata.providerId,
      modes: metadata.modes,
    });

    this.models.set(metadata.key, {
      ...definition,
      metadata: { ...metadata },
    });
  }

  registerMany(definitions: Iterable<ModelDefinition>): void {
    this.logger.debug('Registering batch of models');
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  get(key: ModelKey): ModelDefinition | undefined {
    return this.models.get(key);
  }

  getMetadata(key: ModelKey): ModelMetadata | undefined {
    const entry = this.models.get(key);
    return entry?.metadata;
  }

  getByProvider(providerId: ProviderId): ModelDefinition[] {
    return Array.from(this.models.values()).filter(
      (definition) => definition.metadata.providerId === providerId,
    );
  }

  list(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  listMetadata(): ModelMetadata[] {
    return Array.from(this.models.values(), (definition) => definition.metadata);
  }

  has(key: ModelKey): boolean {
    return this.models.has(key);
  }

  create(key: ModelKey, options?: ModelFactoryOptions): BaseModel {
    const definition = this.models.get(key);

    if (!definition) {
      throw new Error(`Model "${key}" has not been registered.`);
    }

    this.logger.debug('Creating model instance', {
      key,
      hasOptions: options !== undefined,
    });

    return definition.create(options);
  }
}

export const modelRegistry = new ModelRegistry();
