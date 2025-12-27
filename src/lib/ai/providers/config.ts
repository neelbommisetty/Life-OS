import Anthropic, { type ClientOptions as AnthropicClientOptions } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI, { type ClientOptions as OpenAIClientOptions, type ClientOptions as XAIClientOptions } from 'openai';
import { createLogger } from '@/lib/logger';

export type OpenAIDefaults = Readonly<{
  apiKey?: string;
  client?: OpenAI;
  clientOptions?: OpenAIClientOptions;
}>;

export type AnthropicDefaults = Readonly<{
  apiKey?: string;
  client?: Anthropic;
  clientOptions?: AnthropicClientOptions;
}>;

export type GeminiDefaults = Readonly<{
  apiKey?: string;
  client?: GoogleGenerativeAI;
}>;

export type XAIDefaults = Readonly<{
  apiKey?: string;
  client?: OpenAI;
  clientOptions?: XAIClientOptions;
}>;

let openAIDefaults: OpenAIDefaults | undefined;
let anthropicDefaults: AnthropicDefaults | undefined;
let geminiDefaults: GeminiDefaults | undefined;
let xaiDefaults: XAIDefaults | undefined;

const logger = createLogger('ai-providers:config');

const cloneOpenAIDefaults = (
  defaults: OpenAIDefaults | undefined,
): OpenAIDefaults | undefined => {
  if (!defaults) {
    return undefined;
  }

  const clientOptions = defaults.clientOptions
    ? { ...defaults.clientOptions }
    : undefined;

  return {
    ...defaults,
    clientOptions,
  };
};

const cloneAnthropicDefaults = (
  defaults: AnthropicDefaults | undefined,
): AnthropicDefaults | undefined => {
  if (!defaults) {
    return undefined;
  }

  const clientOptions = defaults.clientOptions
    ? { ...defaults.clientOptions }
    : undefined;

  return {
    ...defaults,
    clientOptions,
  };
};

const cloneGeminiDefaults = (
  defaults: GeminiDefaults | undefined,
): GeminiDefaults | undefined => {
  if (!defaults) {
    return undefined;
  }

  return {
    ...defaults,
  };
};

const cloneXAIDefaults = (
  defaults: XAIDefaults | undefined,
): XAIDefaults | undefined => {
  if (!defaults) {
    return undefined;
  }

  const clientOptions = defaults.clientOptions
    ? { ...defaults.clientOptions }
    : undefined;

  return {
    ...defaults,
    clientOptions,
  };
};

export const setOpenAIDefaults = (defaults: OpenAIDefaults | undefined): void => {
  openAIDefaults = cloneOpenAIDefaults(defaults);
  logger.info('Configured OpenAI defaults', {
    hasApiKey: Boolean(defaults?.apiKey ?? defaults?.clientOptions?.apiKey),
    hasClient: defaults?.client !== undefined,
    hasClientOptions: defaults?.clientOptions !== undefined,
  });
};

export const getOpenAIDefaults = (): OpenAIDefaults | undefined =>
  cloneOpenAIDefaults(openAIDefaults);

export const setAnthropicDefaults = (defaults: AnthropicDefaults | undefined): void => {
  anthropicDefaults = cloneAnthropicDefaults(defaults);
  logger.info('Configured Anthropic defaults', {
    hasApiKey: Boolean(defaults?.apiKey ?? defaults?.clientOptions?.apiKey),
    hasClient: defaults?.client !== undefined,
    hasClientOptions: defaults?.clientOptions !== undefined,
  });
};

export const getAnthropicDefaults = (): AnthropicDefaults | undefined =>
  cloneAnthropicDefaults(anthropicDefaults);

export const setGeminiDefaults = (defaults: GeminiDefaults | undefined): void => {
  geminiDefaults = cloneGeminiDefaults(defaults);
  logger.info('Configured Google Gemini defaults', {
    hasApiKey: Boolean(defaults?.apiKey),
    hasClient: defaults?.client !== undefined,
  });
};

export const getGeminiDefaults = (): GeminiDefaults | undefined => cloneGeminiDefaults(geminiDefaults);

export const setXAIDefaults = (defaults: XAIDefaults | undefined): void => {
  xaiDefaults = cloneXAIDefaults(defaults);
  logger.info('Configured xAI defaults', {
    hasApiKey: Boolean(defaults?.apiKey ?? defaults?.clientOptions?.apiKey),
    hasClient: defaults?.client !== undefined,
    hasClientOptions: defaults?.clientOptions !== undefined,
  });
};

export const getXAIDefaults = (): XAIDefaults | undefined => cloneXAIDefaults(xaiDefaults);

export const resetProviderDefaults = (): void => {
  openAIDefaults = undefined;
  anthropicDefaults = undefined;
  geminiDefaults = undefined;
  xaiDefaults = undefined;
  logger.warn('Reset provider defaults');
};
