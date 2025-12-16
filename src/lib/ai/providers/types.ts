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
  OpenAIGpt5Mini = 'openai.gpt-5-mini',
  OpenAIGpt5 = 'openai.gpt-5',
  OpenAIGpt5Pro = 'openai.gpt-5-pro',
  OpenAIGpt41Mini = 'openai.gpt-4.1-mini',
  OpenAIGpt4oMini = 'openai.gpt-4o-mini',
  OpenAIGpt4o = 'openai.gpt-4o',
  AnthropicClaude35HaikuLatest = 'anthropic.claude-3.5-haiku-latest',
  AnthropicClaude37SonnetLatest = 'anthropic.claude-3.7-sonnet-latest',
  AnthropicClaude4SonnetLatest = 'anthropic.claude-4-sonnet-latest',
  GoogleGemini20Flash = 'google.gemini-2.0-flash',
  GoogleGemini20FlashLite = 'google.gemini-2.0-flash-lite',
  GoogleGemini25Flash = 'google.gemini-2.5-flash',
  GoogleGemini25FlashLite = 'google.gemini-2.5-flash-lite',
  GoogleGemini25Pro = 'google.gemini-2.5-pro',
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

