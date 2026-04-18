import OpenAI, { type ClientOptions } from 'openai';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
} from 'openai/resources/responses/responses';
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
import { getXAIDefaults } from './config';

const XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_XAI_MODES: readonly ModelCallMode[] = ['text', 'json'];
const DEFAULT_JSON_SCHEMA_NAME = 'response';

export interface XAIModelOverrides {
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: CostTier;
  readonly tags?: readonly string[];
  readonly modes?: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly name?: string;
}

export interface XAIModelFactoryOptions extends ModelFactoryOptions {
  readonly apiKey?: string;
  readonly client?: OpenAI;
  readonly clientOptions?: ClientOptions;
}

export interface XAIModelDefinitionConfig extends XAIModelOverrides {
  readonly key: `${ProviderId.XAI}.${string}`;
  readonly modelId: string;
  readonly label: string;
  readonly description?: string;
  readonly releaseStage?: 'experimental' | 'beta' | 'ga';
  readonly pricing?: ModelPricing;
}

const ensureXAIClient = (
  options?: XAIModelFactoryOptions,
): OpenAI => {
  const defaults = getXAIDefaults();

  if (options?.client) {
    return options.client;
  }

  if (defaults?.client) {
    return defaults.client;
  }

  const clientOptions: ClientOptions = {
    ...(defaults?.clientOptions ?? {}),
    ...(options?.clientOptions ?? {}),
  };

  const apiKey =
    options?.apiKey ?? clientOptions.apiKey ?? defaults?.apiKey ?? defaults?.clientOptions?.apiKey;

  if (!apiKey) {
    throw new Error(
      'xAI API key is not configured. Provide credentials when creating the model or call setXAIDefaults() before registering models.',
    );
  }

  clientOptions.apiKey = apiKey;
  clientOptions.baseURL = XAI_BASE_URL;

  return new OpenAI(clientOptions);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readOutputText = (value: unknown): string | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const type = typeof value.type === 'string' ? value.type : undefined;
  if (type !== 'output_text') {
    return undefined;
  }

  const textValue = value.text;
  return typeof textValue === 'string' ? textValue : undefined;
};

const extractResponseText = (response: Response): string => {
  const directText = response.output_text;

  if (typeof directText === 'string' && directText.length > 0) {
    return directText;
  }

  const textChunks: string[] = [];

  for (const item of response.output ?? []) {
    if (!isObject(item)) {
      continue;
    }

    if (item.type === 'message') {
      const contentEntries = Array.isArray(item.content) ? item.content : [];
      for (const content of contentEntries) {
        const text = readOutputText(content);
        if (typeof text === 'string') {
          textChunks.push(text);
        }
      }
    } else {
      const text = readOutputText(item);
      if (typeof text === 'string') {
        textChunks.push(text);
      }
    }
  }

  if (textChunks.length === 0) {
    throw new Error('xAI response did not include text content.');
  }

  return textChunks.join('');
};

const readResponseUsage = (response: Response): ModelUsage | undefined => {
  const usage = response.usage;
  if (!usage) {
    return undefined;
  }

  const inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined;
  const cachedTokens =
    typeof usage.input_tokens_details?.cached_tokens === 'number'
      ? usage.input_tokens_details.cached_tokens
      : undefined;
  const totalTokens = typeof usage.total_tokens === 'number'
    ? usage.total_tokens
    : inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadInputTokens: cachedTokens,
  };
};

const readUsageFromStreamEvent = (event: unknown): ModelUsage | undefined => {
  if (!isObject(event)) {
    return undefined;
  }

  const response = event.response;
  if (!response || !isObject(response)) {
    return undefined;
  }

  return readResponseUsage(response as unknown as Response);
};

export const createXAIModel = (
  model: string,
  overrides: XAIModelOverrides = {},
  options?: XAIModelFactoryOptions,
): BaseModel => {
  const client = ensureXAIClient(options);
  const resolvedModes = (overrides.modes ?? DEFAULT_XAI_MODES) as readonly ModelCallMode[];
  const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = overrides.supportsStreaming ?? true;
  const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
  const maxOutputTokens = overrides.maxOutputTokens;

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
          `Mode "${mode}" is not supported by xAI model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
        );
      }

      if (mode === 'json' && !supportsJson) {
        throw new Error(`xAI model "${model}" is not configured to support JSON responses.`);
      }

      const request: ResponseCreateParamsNonStreaming = {
        model,
        input: input.prompt,
      };

      if (maxOutputTokens !== undefined) {
        request.max_output_tokens = maxOutputTokens;
      }

      if (mode === 'json') {
        const schema = (input.jsonSchema ?? { type: 'object' }) as Record<string, unknown>;
        request.text = {
          format: {
            type: 'json_schema',
            name: DEFAULT_JSON_SCHEMA_NAME,
            schema,
          },
        };
      }

      const response = await client.responses.create(
        request,
        input.signal ? { signal: input.signal } : undefined,
      );

      const text = extractResponseText(response);
      const usage = readResponseUsage(response);

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
                `Mode "${mode}" is not supported by xAI model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
              );
            }

            if (mode === 'json') {
              throw new Error(`Streaming is not supported for JSON mode. Use call() instead.`);
            }

            const request: ResponseCreateParamsStreaming = {
              model,
              input: input.prompt,
              stream: true,
            };

            if (maxOutputTokens !== undefined) {
              request.max_output_tokens = maxOutputTokens;
            }

            const stream = await client.responses.create(
              request,
              input.signal ? { signal: input.signal } : undefined,
            );

            let accumulatedText = '';
            let usage: ModelUsage | undefined;

            for await (const event of stream) {
              if (event.type === 'response.output_text.delta') {
                const delta = (event as { delta?: string }).delta ?? '';
                if (delta) {
                  accumulatedText += delta;
                  yield { text: delta, done: false };
                }
              } else if (event.type === 'response.completed') {
                usage = readUsageFromStreamEvent(event);
                yield { text: '', done: true };
              }
            }

            return { text: accumulatedText, usage };
          },
        }
      : {}),
  };
};

const createXAIModelDefinition = (
  config: XAIModelDefinitionConfig,
): ModelDefinition => {
  const resolvedModes = (config.modes ?? DEFAULT_XAI_MODES) as readonly ModelCallMode[];
  const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = config.supportsStreaming ?? true;
  const resolvedTags = config.tags ? [...config.tags] : undefined;

  return {
    metadata: {
      key: config.key,
      providerId: ProviderId.XAI,
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
    create: ((options?: XAIModelFactoryOptions) =>
      createXAIModel(
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

const DEFAULT_XAI_MODEL_CONFIGS: readonly XAIModelDefinitionConfig[] = [
  {
    key: ModelKeyName.XAIGrok41Fast,
    modelId: 'grok-4-1-fast',
    label: 'xAI Grok 4.1 Fast',
    description: 'Advanced reasoning model with 2M token context window for cost-efficient reasoning and tool use.',
    releaseStage: 'ga',
    maxOutputTokens: 65536,
    contextWindow: 2000000,
    costTier: CostTier.Economy,
    pricing: {
      inputUsdPer1m: 0.2,
      outputUsdPer1m: 0.5,
      cacheReadInputUsdPer1m: 0.05,
    },
    tags: ['grok', 'grok-4.1', 'fast'],
  },
  {
    key: ModelKeyName.XAIGrok420Reasoning,
    modelId: 'grok-4.20-reasoning',
    label: 'xAI Grok 4.20 Reasoning',
    description: 'Current flagship Grok reasoning model for advanced analysis, coding, and deeper multi-step problem solving.',
    releaseStage: 'ga',
    maxOutputTokens: 65536,
    contextWindow: 256000,
    costTier: CostTier.Premium,
    tags: ['grok', 'grok-4.20', 'reasoning', 'flagship'],
  },
];

export const xaiDefaultModelDefinitions: readonly ModelDefinition[] =
  DEFAULT_XAI_MODEL_CONFIGS.map(createXAIModelDefinition);

export const registerDefaultXAIModels = (
  registry: ModelRegistry = modelRegistry,
): void => {
  for (const definition of xaiDefaultModelDefinitions) {
    if (registry.has(definition.metadata.key)) {
      continue;
    }

    registry.register(definition);
  }
};
