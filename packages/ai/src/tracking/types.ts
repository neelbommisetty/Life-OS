import type { AiCallType, AiCallStatus } from '@life-os/db';
import type { ModelUsage, ModelCallTelemetry } from "../core";

/**
 * Context required to track an AI call.
 * Provided by the caller when wrapping a model with tracking middleware.
 */
export interface TrackingContext {
  /** The user making the AI call */
  readonly userId: string;
  /** Classification of the call type */
  readonly callType: AiCallType;
  /** Optional thread ID for attribution */
  readonly threadId?: string;
  /** Optional message ID linking to the ChatMessage produced */
  readonly messageId?: string;
}

/**
 * Mutable tracking result populated during/after the AI call.
 */
export interface TrackingResult {
  /** When the request started */
  requestStartAt: Date;
  /** When the first token arrived (streaming only) */
  firstTokenAt?: Date;
  /** When streaming started (streaming only) */
  streamingStartAt?: Date;
  /** When streaming ended (streaming only) */
  streamingEndAt?: Date;
  /** When the full response was received */
  responseEndAt?: Date;
  /** Total tokens streamed (streaming only) */
  totalStreamedTokens?: number;
  /** Tokens per second during streaming */
  streamingTps?: number;
  /** Token usage from the model response */
  usage?: ModelUsage;
  /** Telemetry from the model/router */
  telemetry?: ModelCallTelemetry;
  /** Final status of the call */
  status: AiCallStatus;
  /** Error message if status is ERROR */
  error?: string;
}

/**
 * Options for the tracking middleware.
 */
export interface TrackingOptions {
  /**
   * Whether to enable token estimation for streaming.
   * If false, totalStreamedTokens and streamingTps will not be calculated.
   * @default true
   */
  readonly estimateStreamTokens?: boolean;
}

export type { AiCallType, AiCallStatus };
