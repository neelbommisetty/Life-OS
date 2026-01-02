import { describe, expect, test } from "bun:test";
import { ModelRegistry } from "@/lib/ai/providers/registry";
import { registerDefaultOpenAIModels } from "@/lib/ai/providers/openai";
import { registerDefaultXAIModels } from "@/lib/ai/providers/xai";
import { ModelKeyName } from "@/lib/ai/providers/types";

describe("model registry reasoning capability", () => {
  test("tags reasoning-capable models", () => {
    const registry = new ModelRegistry();
    registerDefaultOpenAIModels(registry);
    registerDefaultXAIModels(registry);

    const gpt5 = registry.getMetadata(ModelKeyName.OpenAIGpt5);
    expect(gpt5?.supportsReasoning).toBe(true);

    const grokReasoning = registry.getMetadata(ModelKeyName.XAIGrok4FastReasoning);
    expect(grokReasoning?.supportsReasoning).toBe(true);

    const grokNonReasoning = registry.getMetadata(ModelKeyName.XAIGrok4FastNonReasoning);
    expect(grokNonReasoning?.supportsReasoning ?? false).toBe(false);
  });
});
