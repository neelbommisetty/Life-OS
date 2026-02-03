import type { ModelUsage } from '@/lib/ai/core';
import type { ModelPriceSnapshot } from '@/lib/ai/pricing';

/**
 * Result of calculating the cost for an AI call.
 */
export interface CallCostResult {
  /** Total cost in USD */
  readonly costUsd: number;
  /** Cost for cache creation tokens (if applicable) */
  readonly cacheCreationCostUsd?: number;
  /** Cost for cache read tokens (if applicable) */
  readonly cacheReadCostUsd?: number;
}

/**
 * Calculate the cost of an AI call based on token usage and pricing.
 *
 * @param usage - Token usage from the model response
 * @param priceSnapshot - Pricing snapshot at the time of the call
 * @returns Calculated costs in USD
 */
export function calculateCallCost(
  usage: ModelUsage | undefined,
  priceSnapshot: ModelPriceSnapshot
): CallCostResult {
  // No usage data or missing pricing
  if (!usage || priceSnapshot.source === 'missing') {
    return { costUsd: 0 };
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheCreationTokens = usage.cacheCreationInputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadInputTokens ?? 0;

  const inputUsdPer1m = priceSnapshot.inputUsdPer1m ?? 0;
  const outputUsdPer1m = priceSnapshot.outputUsdPer1m ?? 0;
  const cacheCreationUsdPer1m = priceSnapshot.cacheCreationInputUsdPer1m ?? 0;
  const cacheReadUsdPer1m = priceSnapshot.cacheReadInputUsdPer1m ?? 0;

  // Calculate individual costs
  const inputCost = (inputTokens * inputUsdPer1m) / 1_000_000;
  const outputCost = (outputTokens * outputUsdPer1m) / 1_000_000;
  const cacheCreationCost = (cacheCreationTokens * cacheCreationUsdPer1m) / 1_000_000;
  const cacheReadCost = (cacheReadTokens * cacheReadUsdPer1m) / 1_000_000;

  // Total cost includes all components
  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;

  return {
    costUsd: totalCost,
    cacheCreationCostUsd: cacheCreationCost > 0 ? cacheCreationCost : undefined,
    cacheReadCostUsd: cacheReadCost > 0 ? cacheReadCost : undefined,
  };
}

/**
 * Simple token estimation for streaming text.
 * Uses a rough approximation of ~4 characters per token for English text.
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  // Rough approximation: ~4 characters per token for English
  // This is intentionally simple; for accuracy, use a proper tokenizer
  return Math.ceil(text.length / 4);
}
