import type { JsonSchema7Type } from 'zod-to-json-schema';

export type ModelCallMode = 'text' | 'json';

export interface ModelCapabilities {
  readonly modes: readonly ModelCallMode[];
  readonly supportsJson?: boolean;
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

export interface BaseModel {
  readonly name: string;
  readonly caps: ModelCapabilities;
  call(input: ModelCallInput): Promise<ModelCallOutput>;
}

