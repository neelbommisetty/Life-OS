import type { ChatMessage } from "@life-os/db";
import { buildCoreBrandPrompt } from "@life-os/ai/copy";
import { brand, couldnt } from "@/lib/brand";

/**
 * Approximate token count for text (rough estimate: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build system prompt for standalone AI chat
 */
export function buildSystemPrompt(projectContext?: {
  name: string;
  description?: string | null;
  aiInstructions?: string | null;
}): string {
  let prompt = buildCoreBrandPrompt(brand.terms);

  // Inject project context if provided
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

/**
 * Format messages for AI model prompt
 */
export function formatMessagesForAI(
  systemPrompt: string,
  messages: ChatMessage[],
  summary?: string | null
): string {
  let prompt = `${systemPrompt}\n\n`;

  if (summary) {
    prompt += `Previous conversation summary:\n${summary}\n\n`;
  }

  prompt += "Conversation:\n";
  for (const msg of messages) {
    const role = msg.role === "USER" ? "User" : msg.role === "ASSISTANT" ? "Assistant" : "System";
    prompt += `${role}: ${msg.content}\n`;
  }

  return prompt;
}

/**
 * Calculate total tokens in message history
 */
export function calculateHistoryTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, msg) =>
      total + (typeof msg.tokenCount === "number" ? msg.tokenCount : estimateTokens(msg.content)),
    0
  );
}

/**
 * Build summarization prompt
 */
export function buildSummarizationPrompt(messages: ChatMessage[]): string {
  let prompt =
    "Provide a concise summary of the conversation. Capture key context, decisions, and next steps that will help continue the work:\n\n";

  for (const msg of messages) {
    const role = msg.role === "USER" ? "User" : msg.role === "ASSISTANT" ? "Assistant" : "System";
    prompt += `${role}: ${msg.content}\n`;
  }

  prompt += "\nProvide a clear, concise summary in 2-3 paragraphs:";

  return prompt;
}

// ===== Streaming Utilities =====

/**
 * Stream event types for Server-Sent Events
 */
export type StreamEventType = "chunk" | "done" | "error" | "message_saved";

/**
 * Structure of a streaming event
 */
export interface StreamEvent {
  type: StreamEventType;
  /** Text content for chunk events */
  text?: string;
  /** Message ID when saved to database */
  messageId?: string;
  /** Error message for error events */
  error?: string;
}

/**
 * Encode a stream event as SSE format
 */
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse a Server-Sent Event line into a StreamEvent
 * Returns null if parsing fails or line is not a data event
 */
export function parseSSELine(line: string): StreamEvent | null {
  if (!line.startsWith("data: ")) {
    return null;
  }

  try {
    const jsonStr = line.slice(6); // Remove 'data: ' prefix
    const event = JSON.parse(jsonStr) as StreamEvent;

    // Validate event structure
    if (!event.type || !["chunk", "done", "error", "message_saved"].includes(event.type)) {
      return null;
    }

    return event;
  } catch {
    return null;
  }
}

/**
 * Parse SSE text chunk that may contain multiple events
 */
export function parseSSEChunk(chunk: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  const lines = chunk.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      const event = parseSSELine(trimmed);
      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

/**
 * Error class for stream-specific errors
 */
export class StreamError extends Error {
  constructor(
    message: string,
    public readonly code: "STREAM_ABORTED" | "STREAM_ERROR" | "PARSE_ERROR" | "NETWORK_ERROR"
  ) {
    super(message);
    this.name = "StreamError";
  }
}

/**
 * Handle stream error with graceful degradation
 * Returns a user-friendly error message
 */
export function handleStreamError(error: unknown): string {
  if (error instanceof StreamError) {
    switch (error.code) {
      case "STREAM_ABORTED":
        return "Canceled.";
      case "NETWORK_ERROR":
        return couldnt("reach the server", {
          safeState: "Your conversation is unchanged",
          nextStep: "Check your connection and try again",
        });
      case "PARSE_ERROR":
        return couldnt("read the response", {
          safeState: "Your conversation is unchanged",
        });
      default:
        return couldnt("stream the response", {
          safeState: "Your conversation is unchanged",
        });
    }
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Canceled.";
    }
    return error.message;
  }

  return couldnt("complete that request", {
    safeState: "Your conversation is unchanged",
  });
}

/**
 * Resolve token count from usage data or estimate
 */
export function resolveTokenCount(text: string, usageTokens?: number | null) {
  if (typeof usageTokens === "number") {
    return { tokenCount: usageTokens, tokenCountSource: "usage" };
  }
  return { tokenCount: estimateTokens(text), tokenCountSource: "estimate" };
}

/**
 * Check if a thread name is a placeholder (to determine if title should be generated)
 */
export function isPlaceholderThreadName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^New thread( \(\d+\))?$/.test(name);
}
