import type {
  BaseModel,
  ModelCallInput,
  ModelStreamChunk,
  ModelStreamResult,
} from "../core";
import { recordAiCall } from './recorder';
import { estimateTokens } from './cost';
import type { TrackingContext, TrackingResult, TrackingOptions } from './types';

/**
 * Wraps a model with tracking to record AI call metrics.
 *
 * This function:
 * - Captures timing metrics (request start, first token, response end)
 * - Records token usage from the model response
 * - Calculates streaming metrics (TPS, total streamed tokens)
 * - Writes to the database asynchronously (fire-and-forget)
 *
 * @param model - The base model to wrap
 * @param context - The tracking context (userId, callType, etc.)
 * @param options - Optional tracking configuration
 * @returns A wrapped model with tracking enabled
 *
 * @example
 * ```ts
 * const trackedModel = wrapWithTracking(
 *   model,
 *   { userId, callType: 'CHAT_STREAM', threadId }
 * );
 * ```
 */
export function wrapWithTracking(
  model: BaseModel,
  context: TrackingContext,
  options: TrackingOptions = {}
): BaseModel {
  const { estimateStreamTokens = true } = options;

  // Create the tracked call function
  const trackedCall = async (input: ModelCallInput) => {
    const tracking: TrackingResult = {
      requestStartAt: new Date(),
      status: 'SUCCESS',
    };

    try {
      const result = await model.call(input);
      tracking.responseEndAt = new Date();
      tracking.usage = result.usage;
      tracking.telemetry = result.telemetry;

      // Fire-and-forget async recording
      void recordAiCall(context, tracking);

      return result;
    } catch (error) {
      tracking.status = 'ERROR';
      tracking.error = error instanceof Error ? error.message : String(error);
      tracking.responseEndAt = new Date();

      // Still record failed calls
      void recordAiCall(context, tracking);
      throw error;
    }
  };

  // Create the tracked stream function if the model supports it
  const trackedStreamCall = model.streamCall
    ? async function* (
        input: ModelCallInput
      ): AsyncGenerator<ModelStreamChunk, ModelStreamResult, undefined> {
        const tracking: TrackingResult = {
          requestStartAt: new Date(),
          status: 'SUCCESS',
        };
        let tokenCount = 0;

        try {
          const generator = model.streamCall!(input);

          while (true) {
            const { value, done } = await generator.next();

            if (done) {
              // Stream completed - finalize metrics
              tracking.streamingEndAt = new Date();
              tracking.totalStreamedTokens = tokenCount;
              tracking.responseEndAt = new Date();

              // Calculate tokens per second
              if (tracking.streamingStartAt && tracking.streamingEndAt) {
                const durationMs =
                  tracking.streamingEndAt.getTime() -
                  tracking.streamingStartAt.getTime();
                const durationSec = durationMs / 1000;
                tracking.streamingTps =
                  durationSec > 0 ? tokenCount / durationSec : 0;
              }

              // Get usage from stream result
              tracking.usage = value?.usage;
              tracking.telemetry = value?.telemetry;

              // Fire-and-forget async recording
              void recordAiCall(context, tracking);

              return value;
            }

            // First token - mark streaming start
            if (!tracking.firstTokenAt && value?.text) {
              tracking.firstTokenAt = new Date();
              tracking.streamingStartAt = new Date();
            }

            // Estimate tokens as they stream
            if (estimateStreamTokens && value?.text) {
              tokenCount += estimateTokens(value.text);
            }

            yield value;
          }
        } catch (error) {
          tracking.status = 'ERROR';
          tracking.error =
            error instanceof Error ? error.message : String(error);
          tracking.responseEndAt = new Date();

          // Finalize streaming metrics even on error
          if (tracking.streamingStartAt) {
            tracking.streamingEndAt = new Date();
            tracking.totalStreamedTokens = tokenCount;

            const durationMs =
              tracking.streamingEndAt.getTime() -
              tracking.streamingStartAt.getTime();
            const durationSec = durationMs / 1000;
            tracking.streamingTps =
              durationSec > 0 ? tokenCount / durationSec : 0;
          }

          // Still record failed calls
          void recordAiCall(context, tracking);
          throw error;
        }
      }
    : undefined;

  // Return the wrapped model
  return {
    name: model.name,
    caps: model.caps,
    call: trackedCall,
    ...(trackedStreamCall ? { streamCall: trackedStreamCall } : {}),
  };
}

/**
 * @deprecated Use wrapWithTracking instead for better type safety.
 * This middleware-style function is kept for backward compatibility.
 */
export const withTracking = (
  context: TrackingContext,
  options: TrackingOptions = {}
) => {
  return (model: BaseModel): BaseModel => wrapWithTracking(model, context, options);
};

/**
 * Creates a tracking context for chat interactions.
 * Helper function to construct the context with common patterns.
 *
 * @param params - Parameters for the chat tracking context
 * @returns A TrackingContext for use with withTracking
 */
export function createChatTrackingContext(params: {
  userId: string;
  threadId?: string;
  messageId?: string;
  isStreaming: boolean;
}): TrackingContext {
  return {
    userId: params.userId,
    callType: params.isStreaming ? 'CHAT_STREAM' : 'CHAT_BLOCKING',
    threadId: params.threadId,
    messageId: params.messageId,
  };
}

/**
 * Creates a tracking context for summary generation.
 *
 * @param params - Parameters for the summary tracking context
 * @returns A TrackingContext for use with withTracking
 */
export function createSummaryTrackingContext(params: {
  userId: string;
  threadId?: string;
}): TrackingContext {
  return {
    userId: params.userId,
    callType: 'SUMMARY_CALL',
    threadId: params.threadId,
  };
}

/**
 * Creates a tracking context for title generation.
 *
 * @param params - Parameters for the title generation tracking context
 * @returns A TrackingContext for use with withTracking
 */
export function createTitleGenTrackingContext(params: {
  userId: string;
  threadId?: string;
}): TrackingContext {
  return {
    userId: params.userId,
    callType: 'TITLE_GEN_CALL',
    threadId: params.threadId,
  };
}
