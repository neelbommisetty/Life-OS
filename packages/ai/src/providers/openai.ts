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
import { getOpenAIDefaults } from './config';

const DEFAULT_OPENAI_MODES: readonly ModelCallMode[] = ['text', 'json'];
const DEFAULT_JSON_SCHEMA_NAME = 'response';

export interface OpenAIModelOverrides {
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: CostTier;
  readonly tags?: readonly string[];
  readonly modes?: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly name?: string;
}

export interface OpenAIModelFactoryOptions extends ModelFactoryOptions {
  readonly apiKey?: string;
  readonly client?: OpenAI;
  readonly clientOptions?: ClientOptions;
}

export interface OpenAIModelDefinitionConfig extends OpenAIModelOverrides {
  readonly key: `${ProviderId.OpenAI}.${string}`;
  readonly modelId: string;
  readonly label: string;
  readonly description?: string;
  readonly releaseStage?: 'experimental' | 'beta' | 'ga';
  readonly pricing?: ModelPricing;
}

const ensureOpenAIClient = (
  options?: OpenAIModelFactoryOptions,
): OpenAI => {
  const defaults = getOpenAIDefaults();

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
      'OpenAI API key is not configured. Provide credentials when creating the model or call setOpenAIDefaults() before registering models.',
    );
  }

  clientOptions.apiKey = apiKey;

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
    throw new Error('OpenAI response did not include text content.');
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

export const createOpenAIModel = (
  model: string,
  overrides: OpenAIModelOverrides = {},
  options?: OpenAIModelFactoryOptions,
): BaseModel => {
  const client = ensureOpenAIClient(options);
  const resolvedModes = (overrides.modes ?? DEFAULT_OPENAI_MODES) as readonly ModelCallMode[];
  const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = overrides.supportsStreaming ?? true; // OpenAI supports streaming by default
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
          `Mode "${mode}" is not supported by OpenAI model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
        );
      }

      if (mode === 'json' && !supportsJson) {
        throw new Error(`OpenAI model "${model}" is not configured to support JSON responses.`);
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
                `Mode "${mode}" is not supported by OpenAI model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
              );
            }

            // Streaming is only supported for text mode
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
              // Handle different event types from OpenAI streaming
              if (event.type === 'response.output_text.delta') {
                const delta = (event as { delta?: string }).delta ?? '';
                if (delta) {
                  accumulatedText += delta;
                  yield { text: delta, done: false };
                }
              } else if (event.type === 'response.completed') {
                usage = readUsageFromStreamEvent(event);
                // Stream completed
                yield { text: '', done: true };
              }
            }

            return { text: accumulatedText, usage };
          },
        }
      : {}),
  };
};

const createOpenAIModelDefinition = (
  config: OpenAIModelDefinitionConfig,
): ModelDefinition => {
  const resolvedModes = (config.modes ?? DEFAULT_OPENAI_MODES) as readonly ModelCallMode[];
  const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = config.supportsStreaming ?? true;
  const resolvedTags = config.tags ? [...config.tags] : undefined;

  return {
    metadata: {
      key: config.key,
      providerId: ProviderId.OpenAI,
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
    create: ((options?: OpenAIModelFactoryOptions) =>
      createOpenAIModel(
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

const DEFAULT_OPENAI_MODEL_CONFIGS: readonly OpenAIModelDefinitionConfig[] = [
  {
    key: ModelKeyName.OpenAIGpt52Pro,
    modelId: 'gpt-5.2-pro',
    label: 'OpenAI GPT-5.2 Pro',
    description: 'Enhanced GPT-5.2 Pro variant producing smarter and more precise responses.',
    releaseStage: 'ga',
    costTier: CostTier.Enterprise,
    pricing: {
      inputUsdPer1m: 21,
      outputUsdPer1m: 168,
    },
    tags: ['gpt-5.2', 'pro', 'responses'],
  },
  {
    key: ModelKeyName.OpenAIGpt52,
    modelId: 'gpt-5.2',
    label: 'OpenAI GPT-5.2',
    description: 'Latest flagship GPT-5.2 model offering instant and thinking modes for coding and agentic tasks.',
    releaseStage: 'ga',
    costTier: CostTier.Premium,
    pricing: {
      inputUsdPer1m: 1.75,
      outputUsdPer1m: 14,
      cacheReadInputUsdPer1m: 0.175,
    },
    tags: ['gpt-5.2', 'flagship', 'responses'],
  },
  {
    key: ModelKeyName.OpenAIGpt5,
    modelId: 'gpt-5',
    label: 'OpenAI GPT-5',
    description: 'Intelligent reasoning model for coding and agentic tasks with configurable reasoning effort.',
    releaseStage: 'ga',
    costTier: CostTier.Standard,
    pricing: {
      inputUsdPer1m: 1.25,
      outputUsdPer1m: 10,
      cacheReadInputUsdPer1m: 0.125,
    },
    tags: ['gpt-5', 'responses'],
  },
  {
    key: ModelKeyName.OpenAIGpt5Mini,
    modelId: 'gpt-5-mini',
    label: 'OpenAI GPT-5 Mini',
    description: 'A faster, cost-efficient version of GPT-5 for well-defined tasks.',
    releaseStage: 'ga',
    costTier: CostTier.Economy,
    pricing: {
      inputUsdPer1m: 0.25,
      outputUsdPer1m: 2,
      cacheReadInputUsdPer1m: 0.025,
    },
    tags: ['gpt-5', 'mini', 'responses'],
  },
  {
    key: ModelKeyName.OpenAIGpt5Nano,
    modelId: 'gpt-5-nano',
    label: 'OpenAI GPT-5 Nano',
    description: 'Fastest, most cost-efficient version of GPT-5.',
    releaseStage: 'ga',
    costTier: CostTier.Economy,
    pricing: {
      inputUsdPer1m: 0.05,
      outputUsdPer1m: 0.4,
      cacheReadInputUsdPer1m: 0.005,
    },
    tags: ['gpt-5', 'nano', 'responses'],
  },
];

export const openAIDefaultModelDefinitions: readonly ModelDefinition[] =
  DEFAULT_OPENAI_MODEL_CONFIGS.map(createOpenAIModelDefinition);

export const registerDefaultOpenAIModels = (
  registry: ModelRegistry = modelRegistry,
): void => {
  for (const definition of openAIDefaultModelDefinitions) {
    if (registry.has(definition.metadata.key)) {
      continue;
    }

    registry.register(definition);
  }
};
