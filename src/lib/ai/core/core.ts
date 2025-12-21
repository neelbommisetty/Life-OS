import type { JsonSchema7Type } from 'zod-to-json-schema';

export type ModelCallMode = 'text' | 'json';

export interface ModelCapabilities {
  readonly modes: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: string;
  readonly tags?: readonly string[];
}

export interface ModelCallInput {
  readonly prompt: string;
  readonly mode?: ModelCallMode;
  readonly jsonSchema?: JsonSchema7Type;
  readonly signal?: AbortSignal;
}

export interface ModelCallOutput {
  readonly text: string;
}

/**
 * Represents a single chunk of streamed content from an AI model.
 */
export interface ModelStreamChunk {
  /** The incremental text content of this chunk */
  readonly text: string;
  /** Whether this is the final chunk in the stream */
  readonly done: boolean;
}

/**
 * Represents the complete result after streaming finishes.
 */
export interface ModelStreamResult {
  /** The complete accumulated text */
  readonly text: string;
}

export interface BaseModel {
  readonly name: string;
  readonly caps: ModelCapabilities;
  /** Blocking call that returns the complete response */
  call(input: ModelCallInput): Promise<ModelCallOutput>;
  /** Streaming call that yields chunks as they arrive */
  streamCall?(input: ModelCallInput): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined>;
}

