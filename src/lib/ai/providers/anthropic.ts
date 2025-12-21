import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  Tool,
  ContentBlockDeltaEvent,
  TextDelta,
} from '@anthropic-ai/sdk/resources/messages/messages';
import type { BaseModel, ModelCallInput, ModelCallMode, ModelStreamChunk, ModelStreamResult } from '@/lib/ai/core';

import {
  CostTier,
  ModelKeyName,
  type ModelDefinition,
  type ModelFactory,
  type ModelFactoryOptions,
  ProviderId,
} from './types';
import { modelRegistry, type ModelRegistry } from './registry';
import { getAnthropicDefaults } from './config';

const DEFAULT_ANTHROPIC_MODES: readonly ModelCallMode[] = ['text', 'json'];
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const JSON_RESPONSE_TOOL_NAME = 'structured_json_response';
const JSON_RESPONSE_SYSTEM_PROMPT =
  'You are a service that returns structured data. Always call the provided JSON response tool exactly once with your final answer and do not emit plain text outside of the tool response.';
export interface AnthropicModelOverrides {
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: CostTier;
  readonly tags?: readonly string[];
  readonly modes?: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly name?: string;
}

export interface AnthropicModelFactoryOptions extends ModelFactoryOptions {
  readonly apiKey?: string;
  readonly client?: Anthropic;
  readonly clientOptions?: ClientOptions;
}

export interface AnthropicModelDefinitionConfig extends AnthropicModelOverrides {
  readonly key: `${ProviderId.Anthropic}.${string}`;
  readonly modelId: string;
  readonly label: string;
  readonly description?: string;
  readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}

type AnthropicMessageRequest = MessageCreateParamsNonStreaming;

const ensureAnthropicClient = (
  options?: AnthropicModelFactoryOptions,
): Anthropic => {
  const defaults = getAnthropicDefaults();

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
      'Anthropic API key is not configured. Provide credentials when creating the model or call setAnthropicDefaults() before registering models.',
    );
  }

  clientOptions.apiKey = apiKey;

  return new Anthropic(clientOptions);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const serialiseJson = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const readContentBlockText = (block: ContentBlock | unknown): string | undefined => {
  if (!isObject(block)) {
    return undefined;
  }

  const type = typeof block.type === 'string' ? block.type : undefined;

  if (type === 'text') {
    const textValue = block.text;
    return typeof textValue === 'string' ? textValue : undefined;
  }

  if (type === 'json') {
    if ('json' in block) {
      return serialiseJson((block as { json?: unknown }).json);
    }

    if ('data' in block) {
      return serialiseJson((block as { data?: unknown }).data);
    }
  }

  if (type === 'tool_use' && 'input' in block) {
    return serialiseJson((block as { input?: unknown }).input);
  }

  if (type === 'tool_result' && 'content' in block) {
    const content = (block as { content?: unknown }).content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const textChunks = content
        .map((entry) => readContentBlockText(entry as ContentBlock | unknown))
        .filter((value): value is string => typeof value === 'string');

      if (textChunks.length > 0) {
        return textChunks.join('');
      }
    }
  }

  if ('text' in block && typeof block.text === 'string') {
    return block.text;
  }

  return undefined;
};

const normaliseToolInputSchema = (schema: unknown): Tool.InputSchema => {
  if (isObject(schema)) {
    const rest = { ...(schema as Record<string, unknown>) };
    delete rest.type;

    return {
      type: 'object',
      ...rest,
    } as Tool.InputSchema;
  }

  return { type: 'object' } as Tool.InputSchema;
};

const extractResponseText = (message: Message): string => {
  const textChunks: string[] = [];

  for (const block of message.content ?? []) {
    const text = readContentBlockText(block);

    if (typeof text === 'string' && text.length > 0) {
      textChunks.push(text);
    }
  }

  if (textChunks.length === 0) {
    throw new Error('Anthropic response did not include text content.');
  }

  return textChunks.join('');
};

export const createAnthropicModel = (
  model: string,
  overrides: AnthropicModelOverrides = {},
  options?: AnthropicModelFactoryOptions,
): BaseModel => {
  const client = ensureAnthropicClient(options);
  const resolvedModes = (overrides.modes ?? DEFAULT_ANTHROPIC_MODES) as readonly ModelCallMode[];
  const supportsJson = overrides.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = overrides.supportsStreaming ?? true; // Anthropic supports streaming by default
  const resolvedTags = overrides.tags ? [...overrides.tags] : undefined;
  const maxOutputTokens = overrides.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

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
          `Mode "${mode}" is not supported by Anthropic model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
        );
      }

      if (mode === 'json' && !supportsJson) {
        throw new Error(`Anthropic model "${model}" is not configured to support JSON responses.`);
      }

      let request: AnthropicMessageRequest = {
        model,
        messages: [
          {
            role: 'user',
            content: input.prompt,
          },
        ],
        max_tokens: maxOutputTokens,
      };

      if (mode === 'json') {
        const jsonRequest: AnthropicMessageRequest = {
          ...request,
          system: JSON_RESPONSE_SYSTEM_PROMPT,
          tools: [
            {
              name: JSON_RESPONSE_TOOL_NAME,
              description:
                'Return the final structured response for the caller. The tool input must strictly conform to the declared JSON schema.',
              input_schema: normaliseToolInputSchema(input.jsonSchema),
            },
          ],
          tool_choice: {
            type: 'tool',
            name: JSON_RESPONSE_TOOL_NAME,
          },
        };

        request = jsonRequest;
      }

      const response = await client.messages.create(
        request,
        input.signal ? { signal: input.signal } : undefined,
      );

      const text = extractResponseText(response);

      return { text };
    },

    ...(supportsStreaming
      ? {
          async *streamCall(
            input: ModelCallInput,
          ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
            const mode: ModelCallMode = input.mode ?? 'text';

            if (!resolvedModes.includes(mode)) {
              throw new Error(
                `Mode "${mode}" is not supported by Anthropic model "${model}". Supported modes: ${resolvedModes.join(', ')}.`,
              );
            }

            // Streaming is only supported for text mode
            if (mode === 'json') {
              throw new Error(`Streaming is not supported for JSON mode. Use call() instead.`);
            }

            const request: MessageCreateParamsStreaming = {
              model,
              messages: [
                {
                  role: 'user',
                  content: input.prompt,
                },
              ],
              max_tokens: maxOutputTokens,
              stream: true,
            };

            const stream = client.messages.stream(
              request,
              input.signal ? { signal: input.signal } : undefined,
            );

            let accumulatedText = '';

            for await (const event of stream) {
              if (event.type === 'content_block_delta') {
                const deltaEvent = event as ContentBlockDeltaEvent;
                if (deltaEvent.delta.type === 'text_delta') {
                  const textDelta = deltaEvent.delta as TextDelta;
                  const delta = textDelta.text ?? '';
                  if (delta) {
                    accumulatedText += delta;
                    yield { text: delta, done: false };
                  }
                }
              } else if (event.type === 'message_stop') {
                // Stream completed
                yield { text: '', done: true };
              }
            }

            return { text: accumulatedText };
          },
        }
      : {}),
  };
};

const createAnthropicModelDefinition = (
  config: AnthropicModelDefinitionConfig,
): ModelDefinition => {
  const resolvedModes = (config.modes ?? DEFAULT_ANTHROPIC_MODES) as readonly ModelCallMode[];
  const supportsJson = config.supportsJson ?? resolvedModes.includes('json');
  const supportsStreaming = config.supportsStreaming ?? true;
  const resolvedTags = config.tags ? [...config.tags] : undefined;
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  return {
    metadata: {
      key: config.key,
      providerId: ProviderId.Anthropic,
      label: config.label,
      description: config.description,
      modelId: config.modelId,
      releaseStage: config.releaseStage,
      modes: resolvedModes,
      supportsJson,
      supportsStreaming,
      maxOutputTokens,
      contextWindow: config.contextWindow,
      costTier: config.costTier,
      tags: resolvedTags,
    },
    create: ((options?: AnthropicModelFactoryOptions) =>
      createAnthropicModel(
        config.modelId,
        {
          maxOutputTokens,
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

const DEFAULT_ANTHROPIC_MODEL_CONFIGS: readonly AnthropicModelDefinitionConfig[] = [
  {
    key: ModelKeyName.AnthropicClaudeHaiku45,
    modelId: 'claude-haiku-4-5',
    label: 'Anthropic Claude Haiku 4.5',
    description:
      'Latest cost-efficient Claude Haiku 4.5 model delivering near-frontier performance at one-third the cost and more than twice the speed of Sonnet 4.',
    releaseStage: 'ga',
    maxOutputTokens: 8192,
    contextWindow: 200000,
    costTier: CostTier.Economy,
    tags: ['claude', 'haiku', '4.5', 'responses', 'economy'],
  },
  {
    key: ModelKeyName.AnthropicClaudeSonnet45,
    modelId: 'claude-sonnet-4-5',
    label: 'Anthropic Claude Sonnet 4.5',
    description:
      'Latest Claude Sonnet 4.5 release balancing quality reasoning, coding assistance, and long-context orchestration. Supports 1M token context window when using the context-1m-2025-08-07 beta header.',
    releaseStage: 'ga',
    maxOutputTokens: 8192,
    contextWindow: 200000,
    costTier: CostTier.Standard,
    tags: ['claude', 'sonnet', '4.5', 'responses', 'standard'],
  },
  {
    key: ModelKeyName.AnthropicClaudeOpus45,
    modelId: 'claude-opus-4-5',
    label: 'Anthropic Claude Opus 4.5',
    description:
      'Flagship Claude Opus 4.5 tier delivering premium reasoning depth, reliability, and tool-use orchestration. Excels in complex reasoning, programming, and agentic tasks.',
    releaseStage: 'ga',
    maxOutputTokens: 8192,
    contextWindow: 200000,
    costTier: CostTier.Premium,
    tags: ['claude', 'opus', '4.5', 'responses', 'premium'],
  },
];

export const anthropicDefaultModelDefinitions: readonly ModelDefinition[] =
  DEFAULT_ANTHROPIC_MODEL_CONFIGS.map(createAnthropicModelDefinition);

export const registerDefaultAnthropicModels = (
  registry: ModelRegistry = modelRegistry,
): void => {
  for (const definition of anthropicDefaultModelDefinitions) {
    if (registry.has(definition.metadata.key)) {
      continue;
    }

    registry.register(definition);
  }
};
