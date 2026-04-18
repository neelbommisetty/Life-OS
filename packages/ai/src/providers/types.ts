import type { BaseModel, ModelCapabilities } from "../core";

/**
 * Enumeration of third-party providers that can supply large language models.
 */
export enum ProviderId {
  Anthropic = 'anthropic',
  Google = 'google',
  OpenAI = 'openai',
  XAI = 'xai',
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
  OpenAIGpt54 = 'openai.gpt-5.4',
  OpenAIGpt54Mini = 'openai.gpt-5.4-mini',
  OpenAIGpt54Nano = 'openai.gpt-5.4-nano',
  // Anthropic Claude models
  AnthropicClaudeHaiku45 = 'anthropic.claude-haiku-4-5',
  AnthropicClaudeSonnet46 = 'anthropic.claude-sonnet-4-6',
  AnthropicClaudeOpus47 = 'anthropic.claude-opus-4-7',
  // Google Gemini models
  GoogleGemini31ProPreview = 'google.gemini-3.1-pro-preview',
  GoogleGemini3FlashPreview = 'google.gemini-3-flash-preview',
  GoogleGemini31FlashLitePreview = 'google.gemini-3.1-flash-lite-preview',
  // xAI Grok models
  XAIGrok41Fast = 'xai.grok-4-1-fast',
  XAIGrok420Reasoning = 'xai.grok-4.20-reasoning',
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

export type ModelPricing = Readonly<{
  readonly inputUsdPer1m: number;
  readonly outputUsdPer1m: number;
  readonly cacheCreationInputUsdPer1m?: number;
  readonly cacheReadInputUsdPer1m?: number;
  readonly effectiveAt?: string;
}>;

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
  readonly pricing?: ModelPricing;
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
