/**
 * Chat Service Routes Configuration
 *
 * Registers AI model routes for project chat functionality.
 */

import "server-only";
import {
  registerServiceRoute,
  ServiceRouteStrategy,
  ModelKeyName,
  registerDefaultOpenAIModels,
  registerDefaultAnthropicModels,
  registerDefaultGeminiModels,
  modelRegistry,
} from "@/lib/ai";
import { createLogger } from "@/lib/ai/logger";

const logger = createLogger("ai:chat-services");

let initialized = false;

/**
 * Initialize chat AI services.
 * Registers models and sets up service routes for project chat and summarization.
 */
export function initializeChatServices(): void {
  if (initialized) {
    logger.debug("Chat services already initialized");
    return;
  }

  try {
    // Register all available models
    registerDefaultOpenAIModels();
    registerDefaultAnthropicModels();
    registerDefaultGeminiModels();

    logger.info("Registered AI models", {
      count: modelRegistry.list().length,
    });

    // Register project_chat service route
    // Uses failover strategy: try GPT-5-mini first, then Claude Haiku 4.5, then Gemini Flash Lite, with GPT-4o-mini as final fallback
    registerServiceRoute("project_chat", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.OpenAIGpt5Mini,
        ModelKeyName.AnthropicClaudeHaiku45,
        ModelKeyName.GoogleGemini25FlashLite,
        ModelKeyName.OpenAIGpt4oMini,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered project_chat service route");

    // Register project_chat_summary service route
    // Uses economy models for summarization (cheaper, faster)
    registerServiceRoute("project_chat_summary", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.OpenAIGpt5Nano,
        ModelKeyName.GoogleGemini25FlashLite,
        ModelKeyName.AnthropicClaudeHaiku45,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered project_chat_summary service route");

    initialized = true;
    logger.info("Chat services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize chat services", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

