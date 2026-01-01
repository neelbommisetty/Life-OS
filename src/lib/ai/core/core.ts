import type { JsonSchema7Type } from 'zod-to-json-schema';

export type ModelCallMode = 'text' | 'json';

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly reasoningTokens?: number;
}

export interface ModelCallAttempt {
  readonly modelKey?: string;
  readonly modelName?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly status: 'success' | 'error';
  readonly error?: string;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly retryCount?: number;
}

export interface ModelCallTelemetry {
  readonly serviceName?: string;
  readonly routeStrategy?: string;
  readonly modelKey?: string;
  readonly modelName?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly attempts?: readonly ModelCallAttempt[];
}

export interface ModelCapabilities {
  readonly modes: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
  readonly supportsStreaming?: boolean;
  readonly supportsReasoning?: boolean;
  readonly maxOutputTokens?: number;
  readonly contextWindow?: number;
  readonly costTier?: string;
  readonly tags?: readonly string[];
}

export interface ModelCallInput {
  readonly prompt: string;
  readonly mode?: ModelCallMode;
  readonly jsonSchema?: JsonSchema7Type;
  readonly reasoning?: {
    readonly effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  };
  readonly signal?: AbortSignal;
}

export interface ModelCallOutput {
  readonly text: string;
  readonly usage?: ModelUsage;
  readonly telemetry?: ModelCallTelemetry;
  readonly reasoningText?: string;
}

/**
 * Represents a single chunk of streamed content from an AI model.
 */
export interface ModelStreamChunk {
  /** The incremental text content of this chunk */
  readonly text: string;
  /** The incremental reasoning content of this chunk */
  readonly reasoningText?: string;
  /** Whether this is the final chunk in the stream */
  readonly done: boolean;
}

/**
 * Represents the complete result after streaming finishes.
 */
export interface ModelStreamResult {
  /** The complete accumulated text */
  readonly text: string;
  readonly usage?: ModelUsage;
  readonly telemetry?: ModelCallTelemetry;
  readonly reasoningText?: string;
}

export interface BaseModel {
  readonly name: string;
  readonly caps: ModelCapabilities;
  /** Blocking call that returns the complete response */
  call(input: ModelCallInput): Promise<ModelCallOutput>;
  /** Streaming call that yields chunks as they arrive */
  streamCall?(input: ModelCallInput): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined>;
}
