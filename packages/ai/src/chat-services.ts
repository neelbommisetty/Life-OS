/**
 * Chat Service Routes Configuration
 *
 * Registers AI model routes for project chat functionality.
 */

import { registerServiceRoute, ServiceRouteStrategy } from "./providers/router";
import { ModelKeyName } from "./providers/types";
import { registerDefaultOpenAIModels } from "./providers/openai";
import { registerDefaultAnthropicModels } from "./providers/anthropic";
import { registerDefaultXAIModels } from "./providers/xai";
import { modelRegistry } from "./providers/registry";
import { createLogger } from "./logger";

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
    registerDefaultOpenAIModels();
    registerDefaultAnthropicModels();
    // registerDefaultGeminiModels(); // Google models disabled
    registerDefaultXAIModels();

    logger.info("Registered AI models", {
      count: modelRegistry.list().length,
    });

    // Register project_chat service route
    // Uses failover strategy: try GPT-5-mini first, then Claude Haiku 4.5 (Gemini disabled)
    registerServiceRoute("project_chat", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.OpenAIGpt54Mini,
        ModelKeyName.AnthropicClaudeHaiku45,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered project_chat service route");

    // Register project_chat_summary service route
    // Uses the retained economy models for summarization.
    registerServiceRoute("project_chat_summary", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.OpenAIGpt54Nano,
        ModelKeyName.AnthropicClaudeHaiku45,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered project_chat_summary service route");

    // Register inbox_kb_note service route
    // Prefer the retained OpenAI economy model with Anthropic economy fallback.
    registerServiceRoute("inbox_kb_note", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.OpenAIGpt54Mini,
        ModelKeyName.AnthropicClaudeHaiku45,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered inbox_kb_note service route");

    // Register inbox_todo_list service route
    // Prefer economical extraction with one retained model per provider tier.
    registerServiceRoute("inbox_todo_list", {
      strategy: ServiceRouteStrategy.Failover,
      models: [
        ModelKeyName.AnthropicClaudeHaiku45,
        ModelKeyName.OpenAIGpt54Nano,
      ],
      retry: { retries: 2, delayMs: 500 },
      logging: {},
    });

    logger.info("Registered inbox_todo_list service route");

    initialized = true;
    logger.info("Chat services initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize chat services", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
