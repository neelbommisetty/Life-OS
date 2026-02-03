import { GoogleGenerativeAI, type GenerateContentRequest, type GenerationConfig, type ResponseSchema, SchemaType } from '@google/generative-ai';
import type { JsonSchema7Type } from 'zod-to-json-schema';
import type {
  BaseModel,
  ModelCallInput,
  ModelCallMode,
  ModelStreamChunk,
  ModelStreamResult,
  ModelUsage,
} from "../core";

import {
  CostTier,
  ModelKeyName,
  type ModelDefinition,
  type ModelFactory,
  type ModelFactoryOptions,
  type ModelPricing,
  ProviderId,
} from './types';
import { modelRegistry, type ModelRegistry } from './registry';
import { getGeminiDefaults } from './config';

const DEFAULT_GEMINI_MODES: readonly ModelCallMode[] = ['text', 'json'];
const JSON_RESPONSE_MIME_TYPE = 'application/json';

export interface GeminiModelOverrides {
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: CostTier;
  readonly tags?: readonly string[];
  readonly modes?: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly name?: string;
}

export interface GeminiModelFactoryOptions extends ModelFactoryOptions {
  readonly apiKey?: string;
  readonly client?: GoogleGenerativeAI;
}

export interface GeminiModelDefinitionConfig extends GeminiModelOverrides {
  readonly key: `${ProviderId.Google}.${string}`;
  readonly modelId: string;
  readonly label: string;
  readonly description?: string;
  readonly releaseStage?: 'experimental' | 'beta' | 'ga';
  readonly pricing?: ModelPricing;
}

type GeminiSchemaInput = JsonSchema7Type | ResponseSchema | undefined;

const ensureGeminiClient = (options?: GeminiModelFactoryOptions): GoogleGenerativeAI => {
  const defaults = getGeminiDefaults();

  if (options?.client) {
    return options.client;
  }

  if (defaults?.client) {
    return defaults.client;
  }

  const apiKey = options?.apiKey ?? defaults?.apiKey;

  if (!apiKey) {
    throw new Error(
      'Google Gemini API key is not configured. Provide credentials when creating the model or call setGeminiDefaults() before registering models.',
    );
  }

  return new GoogleGenerativeAI(apiKey);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readUsageFromResponse = (value: unknown): ModelUsage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage = value.usageMetadata;
  if (!usage || !isRecord(usage)) {
    return undefined;
  }

  const inputTokens =
    typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : undefined;
  const outputTokens =
    typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined;
  const cacheReadInputTokens =
    typeof usage.cachedContentTokenCount === 'number'
      ? usage.cachedContentTokenCount
      : undefined;
  const totalTokens =
    typeof usage.totalTokenCount === 'number'
      ? usage.totalTokenCount
      : inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadInputTokens,
  };
};

const toSchemaType = (value: unknown): SchemaType | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const entries = Object.values(SchemaType) as readonly string[];
  const normalised = value.toUpperCase();

  const match = entries.find((entry) => entry === value || entry === normalised);

  return match as SchemaType | undefined;
};

// Internal type for building schema objects before casting to ResponseSchema
interface GeminiSchemaBuilder {
  type?: SchemaType;
  description?: string;
  nullable?: boolean;
  format?: string;
  enum?: string[];
  example?: unknown;
  properties?: Record<string, GeminiSchemaBuilder>;
  required?: string[];
  items?: GeminiSchemaBuilder;
}

const toGeminiResponseSchema = (schema: GeminiSchemaInput): ResponseSchema | undefined => {
  if (!schema) {
    return undefined;
  }

  if (!isRecord(schema)) {
    return undefined;
  }

  const base: GeminiSchemaBuilder = {};
  const schemaRecord = schema as Record<string, unknown>;

  const type = toSchemaType(schemaRecord.type);
  if (type) {
    base.type = type;
  }

  if (typeof schemaRecord.description === 'string') {
    base.description = schemaRecord.description;
  }

  if (schemaRecord.nullable === true) {
    base.nullable = true;
  }

  if (typeof schemaRecord.format === 'string') {
    base.format = schemaRecord.format;
  }

  const enumValues = schemaRecord.enum;
  if (Array.isArray(enumValues) && enumValues.every((value): value is string => typeof value === 'string')) {
    base.enum = [...enumValues];
  }

  if ('example' in schemaRecord) {
    base.example = schemaRecord.example;
  }

  const propertiesValue = schemaRecord.properties;
  if (isRecord(propertiesValue)) {
    const properties: Record<string, GeminiSchemaBuilder> = {};

    for (const [key, value] of Object.entries(propertiesValue)) {
      const propertySchema = toGeminiResponseSchema(value as GeminiSchemaInput);
      if (propertySchema) {
        properties[key] = propertySchema as GeminiSchemaBuilder;
      }
    }

    if (Object.keys(properties).length > 0) {
      base.properties = properties;
    }
  }

  const requiredValues = schemaRecord.required;
  if (Array.isArray(requiredValues)) {
    const required = requiredValues.filter((value): value is string => typeof value === 'string');
    if (required.length > 0) {
      base.required = required;
    }
  }

  if ('items' in schemaRecord) {
    const items = schemaRecord.items;
    if (Array.isArray(items)) {
      const first = items[0];
      const itemSchema = toGeminiResponseSchema(first as GeminiSchemaInput);
      if (itemSchema) {
        base.items = itemSchema as GeminiSchemaBuilder;
      }
    } else if (items) {
      const itemSchema = toGeminiResponseSchema(items as GeminiSchemaInput);
      if (itemSchema) {
        base.items = itemSchema as GeminiSchemaBuilder;
      }
    }
  }

  // Cast to ResponseSchema - the Gemini SDK accepts this structure at runtime
  return base as ResponseSchema;
};

const buildGeminiRequest = (
  prompt: string,
  mode: ModelCallMode,
  maxOutputTokens: number | undefined,
  jsonSchema: JsonSchema7Type | undefined,
): GenerateContentRequest => {
  const request: GenerateContentRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  };

  const generationConfig: GenerationConfig = {};

  if (maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = maxOutputTokens;
  }

  if (mode === 'json') {
    generationConfig.responseMimeType = JSON_RESPONSE_MIME_TYPE;
    const schema = toGeminiResponseSchema(jsonSchema as GeminiSchemaInput);
    if (schema) {
      generationConfig.responseSchema = schema;
    }
  }

  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig;
  }

  return request;
};

export const createGeminiModel = (
  model: string,
  overrides: GeminiModelOverrides = {},
  options?: GeminiModelFactoryOptions,
): BaseModel => {
  const client = ensureGeminiClient(options);
  const resolvedModes = (overrides.modes ?? DEFAULT_GEMINI_MODES) as readonly ModelCallMode[];
  const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = overrides.supportsStreaming ?? true; // Gemini supports streaming by default
  const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
  const maxOutputTokens = overrides.maxOutputTokens;
  const generativeModel = client.getGenerativeModel({ model });

  return {
    name: overrides.name ?? model,
    caps: {
      modes: resolvedModes,
      supportsJson,
      supportsStreaming,
      maxOutputTokens,
      contextWindow: overrides.contextWindow,
      costTier: overrides.costTier,
      tags: resolvedTags,
    },
    async call(input: ModelCallInput) {
      const mode: ModelCallMode = input.mode ?? 'text';

      if (!resolvedModes.includes(mode)) {
        throw new Error(
          `Mode "${mode}" is not supported by Google Gemini model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
        );
      }

      if (mode === 'json' && !supportsJson) {
        throw new Error(`Google Gemini model "${model}" is not configured to support JSON responses.`);
      }

      const request = buildGeminiRequest(input.prompt, mode, maxOutputTokens, input.jsonSchema);

      const result = await generativeModel.generateContent(
        request,
        input.signal ? { signal: input.signal } : undefined,
      );

      const text = result.response.text();
      const usage = readUsageFromResponse(result.response);

      if (typeof text !== 'string' || text.length === 0) {
        throw new Error('Google Gemini response did not include text content.');
      }

      return { text, usage };
    },

    ...(supportsStreaming
      ? {
          async *streamCall(
            input: ModelCallInput,
          ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
            const mode: ModelCallMode = input.mode ?? 'text';

            if (!resolvedModes.includes(mode)) {
              throw new Error(
                `Mode "${mode}" is not supported by Google Gemini model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
              );
            }

            // Streaming is only supported for text mode
            if (mode === 'json') {
              throw new Error(`Streaming is not supported for JSON mode. Use call() instead.`);
            }

            const request = buildGeminiRequest(input.prompt, mode, maxOutputTokens, input.jsonSchema);

            const result = await generativeModel.generateContentStream(
              request,
              input.signal ? { signal: input.signal } : undefined,
            );

            let accumulatedText = '';
            let usage: ModelUsage | undefined;

            for await (const chunk of result.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                accumulatedText += chunkText;
                yield { text: chunkText, done: false };
              }

              const chunkUsage = readUsageFromResponse(chunk);
              if (chunkUsage) {
                usage = chunkUsage;
              }
            }

            // Signal completion
            yield { text: '', done: true };

            return { text: accumulatedText, usage };
          },
        }
      : {}),
  };
};

const createGeminiModelDefinition = (
  config: GeminiModelDefinitionConfig,
): ModelDefinition => {
  const resolvedModes = (config.modes ?? DEFAULT_GEMINI_MODES) as readonly ModelCallMode[];
  const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = config.supportsStreaming ?? true;
  const resolvedTags = config.tags ? [...config.tags] : undefined;

  return {
    metadata: {
      key: config.key,
      providerId: ProviderId.Google,
      label: config.label,
      description: config.description,
      modelId: config.modelId,
      releaseStage: config.releaseStage,
      pricing: config.pricing,
      modes: resolvedModes,
      supportsJson,
      supportsStreaming,
      maxOutputTokens: config.maxOutputTokens,
      contextWindow: config.contextWindow,
      costTier: config.costTier,
      tags: resolvedTags,
    },
    create: ((options?: GeminiModelFactoryOptions) =>
      createGeminiModel(
        config.modelId,
        {
          maxOutputTokens: config.maxOutputTokens,
          contextWindow: config.contextWindow,
          costTier: config.costTier,
          tags: resolvedTags,
          modes: resolvedModes,
          supportsJson,
          supportsStreaming,
          name: config.label,
        },
        options,
      )) as ModelFactory,
  };
};

const DEFAULT_GEMINI_MODEL_CONFIGS: readonly GeminiModelDefinitionConfig[] = [
  {
    key: ModelKeyName.GoogleGemini3ProPreview,
    modelId: 'gemini-3-pro-preview',
    label: 'Google Gemini 3 Pro (Preview)',
    description: 'Latest Gemini 3 Pro preview model capable of processing text, code, images, audio, and video with high-precision reasoning.',
    releaseStage: 'experimental',
    maxOutputTokens: 65536,
    contextWindow: 1048576,
    costTier: CostTier.Premium,
    pricing: {
      inputUsdPer1m: 2,
      outputUsdPer1m: 12,
      cacheCreationInputUsdPer1m: 4.5,
      cacheReadInputUsdPer1m: 0.2,
    },
    tags: ['gemini-3', 'pro', 'preview'],
  },
  {
    key: ModelKeyName.GoogleGemini3FlashPreview,
    modelId: 'gemini-3-flash-preview',
    label: 'Google Gemini 3 Flash (Preview)',
    description: 'Latest Gemini 3 Flash preview model emphasizing speed and efficiency while maintaining high reasoning quality.',
    releaseStage: 'experimental',
    maxOutputTokens: 65536,
    contextWindow: 1048576,
    costTier: CostTier.Economy,
    pricing: {
      inputUsdPer1m: 0.5,
      outputUsdPer1m: 3,
      cacheCreationInputUsdPer1m: 1,
      cacheReadInputUsdPer1m: 0.05,
    },
    tags: ['gemini-3', 'flash', 'preview'],
  },
  {
    key: ModelKeyName.GoogleGemini25Pro,
    modelId: 'gemini-2.5-pro',
    label: 'Google Gemini 2.5 Pro',
    description: 'Flagship Gemini 2.5 Pro model for advanced reasoning and multimodal workloads.',
    releaseStage: 'ga',
    maxOutputTokens: 65536,
    contextWindow: 1048576,
    costTier: CostTier.Standard,
    pricing: {
      inputUsdPer1m: 1.25,
      outputUsdPer1m: 10,
      cacheCreationInputUsdPer1m: 4.5,
      cacheReadInputUsdPer1m: 0.125,
    },
    tags: ['gemini-2.5', 'pro'],
  },
  {
    key: ModelKeyName.GoogleGemini25Flash,
    modelId: 'gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    description: 'Next-generation Gemini 2.5 Flash model for fast multimodal responses.',
    releaseStage: 'ga',
    maxOutputTokens: 65536,
    contextWindow: 1048576,
    costTier: CostTier.Economy,
    pricing: {
      inputUsdPer1m: 0.3,
      outputUsdPer1m: 2.5,
      cacheCreationInputUsdPer1m: 1,
      cacheReadInputUsdPer1m: 0.03,
    },
    tags: ['gemini-2.5', 'flash'],
  },
];

export const geminiDefaultModelDefinitions: readonly ModelDefinition[] =
  DEFAULT_GEMINI_MODEL_CONFIGS.map(createGeminiModelDefinition);

export const registerDefaultGeminiModels = (
  registry: ModelRegistry = modelRegistry,
): void => {
  for (const definition of geminiDefaultModelDefinitions) {
    if (registry.has(definition.metadata.key)) {
      continue;
    }

    registry.register(definition);
  }
};
