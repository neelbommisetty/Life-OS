import type { BaseModel, ModelCapabilities } from '@/lib/ai/core';

/**
 * Enumeration of third-party providers that can supply large language models.
 */
export enum ProviderId {
  Anthropic = 'anthropic',
  Google = 'google',
  OpenAI = 'openai',
}

/**
 * Normalised tiers describing the relative operating cost for a model.
 */
export enum CostTier {
  Economy = 'economy',
  Standard = 'standard',
  Premium = 'premium',
  Enterprise = 'enterprise',
}

/**
 * Canonical identifiers for the default model definitions in the registry.
 */
export enum ModelKeyName {
  // OpenAI models
  OpenAIGpt52 = 'openai.gpt-5.2',
  OpenAIGpt52Pro = 'openai.gpt-5.2-pro',
  OpenAIGpt5Mini = 'openai.gpt-5-mini',
  OpenAIGpt5Nano = 'openai.gpt-5-nano',
  OpenAIGpt5 = 'openai.gpt-5',
  OpenAIGpt41 = 'openai.gpt-4.1',
  OpenAIGpt4o = 'openai.gpt-4o',
  OpenAIGpt4oMini = 'openai.gpt-4o-mini',
  // Anthropic Claude models
  AnthropicClaudeHaiku45 = 'anthropic.claude-haiku-4-5',
  AnthropicClaudeSonnet45 = 'anthropic.claude-sonnet-4-5',
  AnthropicClaudeOpus45 = 'anthropic.claude-opus-4-5',
  // Google Gemini models
  GoogleGemini3ProPreview = 'google.gemini-3-pro-preview',
  GoogleGemini3FlashPreview = 'google.gemini-3-flash-preview',
  GoogleGemini25Pro = 'google.gemini-2.5-pro',
  GoogleGemini25Flash = 'google.gemini-2.5-flash',
  GoogleGemini25FlashLite = 'google.gemini-2.5-flash-lite',
  GoogleGemini20Flash = 'google.gemini-2.0-flash',
}

/**
 * Canonical identifier for a model definition in the registry.
 */
export type ModelKey = `${ProviderId}.${string}`;

/**
 * Capabilities for a model with a normalised cost tier.
 */
export type ModelCapabilityMetadata = Omit<ModelCapabilities, 'costTier'> & {
  readonly costTier?: CostTier;
};

/**
 * Metadata describing an individual model entry.
 */
export interface ModelMetadata extends ModelCapabilityMetadata {
  readonly key: ModelKey;
  readonly providerId: ProviderId;
  readonly label: string;
  readonly description?: string;
  readonly modelId?: string;
  readonly releaseStage?: 'experimental' | 'beta' | 'ga';
}

export interface ModelFactoryOptions {
  /**
   * Optional AbortSignal forwarded to SDK calls so upstream packages can enforce cancellation.
   */
  readonly signal?: AbortSignal;
}

export type ModelFactory = (options?: ModelFactoryOptions) => BaseModel;

export interface ModelDefinition {
  readonly create: ModelFactory;
  readonly metadata: ModelMetadata;
}

