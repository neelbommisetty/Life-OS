import { describe, expect, test } from "bun:test";

import {
  anthropicDefaultModelDefinitions,
  openAIDefaultModelDefinitions,
} from "./index";
import { ModelKeyName } from "./types";

describe("default AI model definitions", () => {
  test("includes GPT-5.4 with pricing metadata", () => {
    const model = openAIDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.OpenAIGpt54,
    );

    expect(model).toBeDefined();
    expect(model?.metadata).toMatchObject({
      key: ModelKeyName.OpenAIGpt54,
      modelId: "gpt-5.4",
      label: "OpenAI GPT-5.4",
      pricing: {
        inputUsdPer1m: 2.2,
        outputUsdPer1m: 17.6,
        cacheReadInputUsdPer1m: 0.22,
      },
    });
  });

  test("includes Claude 4.6 variants with pricing metadata", () => {
    const sonnet = anthropicDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.AnthropicClaudeSonnet46,
    );
    const opus = anthropicDefaultModelDefinitions.find(
      (definition) => definition.metadata.key === ModelKeyName.AnthropicClaudeOpus46,
    );

    expect(sonnet?.metadata).toMatchObject({
      key: ModelKeyName.AnthropicClaudeSonnet46,
      modelId: "claude-sonnet-4-6",
      label: "Anthropic Claude Sonnet 4.6",
      pricing: {
        inputUsdPer1m: 3,
        outputUsdPer1m: 15,
      },
    });

    expect(opus?.metadata).toMatchObject({
      key: ModelKeyName.AnthropicClaudeOpus46,
      modelId: "claude-opus-4-6",
      label: "Anthropic Claude Opus 4.6",
      pricing: {
        inputUsdPer1m: 5,
        outputUsdPer1m: 25,
      },
    });
  });
});
