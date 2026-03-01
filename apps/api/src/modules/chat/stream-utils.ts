import type { ChatMessage } from "@life-os/db";
import { buildCoreBrandPrompt, defaultBrandTerms } from "@life-os/ai/copy";

export type StreamEventType = "chunk" | "done" | "error" | "message_saved";

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  messageId?: string;
  error?: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildSystemPrompt(projectContext?: {
  name: string;
  description?: string | null;
  aiInstructions?: string | null;
}): string {
  let prompt = buildCoreBrandPrompt(defaultBrandTerms);

  if (projectContext) {
    prompt += `\n\n## Project Context: ${projectContext.name}`;

    if (projectContext.description) {
      prompt += `\n\n${projectContext.description}`;
    }

    if (projectContext.aiInstructions) {
      prompt += `\n\n### Instructions\n${projectContext.aiInstructions}`;
    }
  }

  return prompt;
}

export function formatMessagesForAI(
  systemPrompt: string,
  messages: ChatMessage[],
  summary?: string | null,
): string {
  let prompt = `${systemPrompt}\n\n`;

  if (summary) {
    prompt += `Previous conversation summary:\n${summary}\n\n`;
  }

  prompt += "Conversation:\n";
  for (const message of messages) {
    const role =
      message.role === "USER"
        ? "User"
        : message.role === "ASSISTANT"
          ? "Assistant"
          : "System";
    prompt += `${role}: ${message.content}\n`;
  }

  return prompt;
}

export function calculateHistoryTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      (typeof message.tokenCount === "number"
        ? message.tokenCount
        : estimateTokens(message.content)),
    0,
  );
}

export function buildSummarizationPrompt(messages: ChatMessage[]): string {
  let prompt =
    "Please provide a concise summary of the following conversation. Focus on key points, decisions, and context that would be useful to continue the conversation:\n\n";

  for (const message of messages) {
    const role =
      message.role === "USER"
        ? "User"
        : message.role === "ASSISTANT"
          ? "Assistant"
          : "System";
    prompt += `${role}: ${message.content}\n`;
  }

  prompt += "\nProvide a clear, concise summary in 2-3 paragraphs:";

  return prompt;
}

export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function resolveTokenCount(text: string, usageTokens?: number | null) {
  if (typeof usageTokens === "number") {
    return { tokenCount: usageTokens, tokenCountSource: "usage" as const };
  }
  return { tokenCount: estimateTokens(text), tokenCountSource: "estimate" as const };
}

export function isPlaceholderThreadName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^New thread( \(\d+\))?$/.test(name);
}
