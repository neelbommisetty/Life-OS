/**
 * AI Configuration
 *
 * This file manages environment variables for AI providers.
 * Add your API keys to .env.local or .env.development.local:
 *
 * OPENAI_API_KEY=sk-...
 * ANTHROPIC_API_KEY=sk-ant-...
 * GOOGLE_AI_API_KEY=AI...
 */

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
} as const;

/**
 * Check if a provider is configured with an API key.
 */
export const isProviderConfigured = (provider: keyof typeof aiConfig): boolean => {
  return Boolean(aiConfig[provider].apiKey);
};

/**
 * Get a list of all configured providers.
 */
export const getConfiguredProviders = (): (keyof typeof aiConfig)[] => {
  return (Object.keys(aiConfig) as (keyof typeof aiConfig)[]).filter(isProviderConfigured);
};

