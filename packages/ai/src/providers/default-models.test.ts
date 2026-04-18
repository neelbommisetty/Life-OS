import { describe, expect, test } from "bun:test";

import {
  anthropicDefaultModelDefinitions,
  geminiDefaultModelDefinitions,
  openAIDefaultModelDefinitions,
  xaiDefaultModelDefinitions,
} from "./index";
import { ModelKeyName } from "./types";

describe("default AI model definitions", () => {
  test("keeps one model per cost tier in each provider registry", () => {
    const providers = [
      openAIDefaultModelDefinitions,
      anthropicDefaultModelDefinitions,
      geminiDefaultModelDefinitions,
      xaiDefaultModelDefinitions,
    ];

    for (const definitions of providers) {
      const countsByTier = new Map<string, number>();

      for (const definition of definitions) {
        const tier = definition.metadata.costTier;
        expect(tier).toBeDefined();

        if (!tier) {
          continue;
        }

        countsByTier.set(tier, (countsByTier.get(tier) ?? 0) + 1);
      }

      for (const count of countsByTier.values()) {
        expect(count).toBe(1);
      }
    }
  });

  test("includes current OpenAI flagship coding models with pricing metadata", () => {
    const model = openAIDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.OpenAIGpt54,
    );

    expect(model).toBeDefined();
    expect(model?.metadata).toMatchObject({
      key: ModelKeyName.OpenAIGpt54,
      modelId: "gpt-5.4",
      label: "OpenAI GPT-5.4",
      description:
        "Current flagship GPT-5.4 model for complex reasoning, coding, and agentic workflows.",
      pricing: {
        inputUsdPer1m: 2.5,
        outputUsdPer1m: 15,
      },
    });
  });

  test("includes current Claude flagship variants with pricing metadata", () => {
    const sonnet = anthropicDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.AnthropicClaudeSonnet46,
    );
    const opus = anthropicDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.AnthropicClaudeOpus47,
    );

    expect(sonnet).toBeDefined();
    expect(opus).toBeDefined();

    expect(sonnet?.metadata).toMatchObject({
      key: ModelKeyName.AnthropicClaudeSonnet46,
      modelId: "claude-sonnet-4-6",
      label: "Anthropic Claude Sonnet 4.6",
      description:
        "Latest Claude Sonnet 4.6 release balancing coding performance, reasoning quality, and long-context orchestration.",
      pricing: {
        inputUsdPer1m: 3,
        outputUsdPer1m: 15,
      },
    });

    expect(opus?.metadata).toMatchObject({
      key: ModelKeyName.AnthropicClaudeOpus47,
      modelId: "claude-opus-4-7",
      label: "Anthropic Claude Opus 4.7",
      description:
        "Current flagship Claude Opus 4.7 model for the deepest reasoning, strongest coding performance, and long-horizon agentic workflows.",
      pricing: {
        inputUsdPer1m: 5,
        outputUsdPer1m: 25,
      },
    });
  });
});
