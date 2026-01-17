/**
 * AI Configuration
 *
 * This file manages environment variables for AI providers.
 * Add your API keys to .env.local or .env.development.local:
 *
 * OPENAI_API_KEY=sk-... (optional)
 * ANTHROPIC_API_KEY=sk-ant-... (optional)
 * GOOGLE_AI_API_KEY=AI... (optional)
 */

import {
  setOpenAIDefaults,
  setAnthropicDefaults,
  setGeminiDefaults,
  setXAIDefaults,
} from "./providers/config";

export const aiConfig = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  gemini: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
  },
  xai: {
    apiKey: process.env.XAI_API_KEY,
  },
} as const;

/**
 * Check if a provider is configured with an API key.
 */
export const isProviderConfigured = (
  provider: keyof typeof aiConfig
): boolean => {
  return Boolean(aiConfig[provider].apiKey);
};

/**
 * Get a list of all configured providers.
 */
export const getConfiguredProviders = (): (keyof typeof aiConfig)[] => {
  return (Object.keys(aiConfig) as (keyof typeof aiConfig)[]).filter(
    isProviderConfigured
  );
};

/**
 * Initialize AI providers with environment variables.
 *
 * This function reads API keys from environment variables and configures
 * the provider defaults. Only providers with API keys present will be configured.
 *
 * This function is idempotent and safe to call multiple times.
 *
 * @example
 * ```ts
 * import { initializeProviders } from '@/lib/ai/config';
 *
 * // Initialize providers at application startup
 * initializeProviders();
 * ```
 */
export function initializeProviders(): void {
  // Initialize OpenAI if API key is present
  if (aiConfig.openai.apiKey) {
    setOpenAIDefaults({ apiKey: aiConfig.openai.apiKey });
  }

  // Initialize Anthropic if API key is present
  if (aiConfig.anthropic.apiKey) {
    setAnthropicDefaults({ apiKey: aiConfig.anthropic.apiKey });
  }

  // Initialize Gemini if API key is present
  if (aiConfig.gemini.apiKey) {
    setGeminiDefaults({ apiKey: aiConfig.gemini.apiKey });
  }

  // Initialize xAI if API key is present
  if (aiConfig.xai.apiKey) {
    setXAIDefaults({ apiKey: aiConfig.xai.apiKey });
  }
}
