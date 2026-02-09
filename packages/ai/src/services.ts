import { initializeProviders } from "./config";
import { initializeChatServices } from "./chat-services";
import { modelRegistry } from "./providers/registry";
import type { ModelMetadata } from "./providers/types";

export type AIProviderStatus =
  | "ready"
  | "not_configured"
  | "not_initialized"
  | "disabled";

export type AIProviderStatuses = Readonly<{
  openai: AIProviderStatus;
  anthropic: AIProviderStatus;
  gemini: AIProviderStatus;
  xai: AIProviderStatus;
}>;

export type AIServicesStatus = Readonly<{
  status: "ready" | "not_ready";
  initialized: boolean;
  providers: AIProviderStatuses;
}>;

let initialized = false;

const hasOpenAIKey = (): boolean => Boolean(process.env.OPENAI_API_KEY);
const hasAnthropicKey = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);
const hasGeminiKey = (): boolean => Boolean(process.env.GOOGLE_AI_API_KEY);
const hasXAIKey = (): boolean => Boolean(process.env.XAI_API_KEY);

export function initializeAIServices(): void {
  if (initialized) {
    return;
  }

  initializeProviders();
  initializeChatServices();
  initialized = true;
}

export function areAIServicesInitialized(): boolean {
  return initialized;
}

export function getAIProviderStatuses(): AIProviderStatuses {
  const servicesInitialized = areAIServicesInitialized();

  const openai: AIProviderStatus = hasOpenAIKey()
    ? servicesInitialized
      ? "ready"
      : "not_initialized"
    : "not_configured";

  const anthropic: AIProviderStatus = hasAnthropicKey()
    ? servicesInitialized
      ? "ready"
      : "not_initialized"
    : "not_configured";

  const xai: AIProviderStatus = hasXAIKey()
    ? servicesInitialized
      ? "ready"
      : "not_initialized"
    : "not_configured";

  // Gemini is intentionally not initialized in initializeProviders().
  const gemini: AIProviderStatus = hasGeminiKey() ? "disabled" : "not_configured";

  return {
    openai,
    anthropic,
    gemini,
    xai,
  };
}

export function getAIServicesStatus(): AIServicesStatus {
  const providers = getAIProviderStatuses();
  const hasReadyProvider = Object.values(providers).some(
    (status) => status === "ready",
  );

  return {
    status: hasReadyProvider ? "ready" : "not_ready",
    initialized: areAIServicesInitialized(),
    providers,
  };
}

export function listRegisteredModelMetadata(): ModelMetadata[] {
  return modelRegistry.listMetadata();
}
