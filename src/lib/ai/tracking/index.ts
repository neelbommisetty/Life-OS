/**
 * AI Call Tracking Module
 *
 * Provides middleware and utilities for tracking AI calls, including:
 * - Token usage and cost calculation
 * - Request timing and streaming metrics
 * - Async database recording (fire-and-forget)
 *
 * @example
 * ```ts
 * import { withTracking, createChatTrackingContext } from '@/lib/ai/tracking';
 * import { applyMiddleware } from '@/lib/ai/core';
 *
 * const context = createChatTrackingContext({
 *   userId,
 *   threadId,
 *   isStreaming: true,
 * });
 *
 * const trackedModel = applyMiddleware(model, withTracking(context));
 * ```
 */

// Types
export type {
  TrackingContext,
  TrackingResult,
  TrackingOptions,
  AiCallType,
  AiCallStatus,
} from './types';

// Middleware
export {
  wrapWithTracking,
  withTracking,
  createChatTrackingContext,
  createSummaryTrackingContext,
  createTitleGenTrackingContext,
} from './middleware';

// Cost utilities
export { calculateCallCost, estimateTokens, type CallCostResult } from './cost';

// Recorder (for advanced use cases)
export { recordAiCall, updateAiCall } from './recorder';

// Analytics queries
export {
  getUsageSummary,
  getDailyUsage,
  getRecentAiCalls,
  type UsageSummary,
  type DailyUsage,
  type RecentAiCall,
} from './analytics';
