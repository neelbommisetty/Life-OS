import "server-only";

import { initializeProviders } from "./config";
import { initializeChatServices } from "./chat-services";

/**
 * Server-side AI provider initialization.
 *
 * Import this module in server components, server actions, or API routes that
 * use AI functionality to ensure providers and service routes are registered.
 */

initializeProviders();
initializeChatServices();

