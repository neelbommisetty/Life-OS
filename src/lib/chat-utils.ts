import type { ChatMessage, Priority, Project, TaskStatus } from "@prisma/client";

export type ProposedTask = {
  title: string;
  description?: string;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: string | null;
};

export type CreatedTaskInfo = {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: Priority;
  createdAt: Date | string;
};

export type TaskResolution = {
  created?: CreatedTaskInfo[];
  error?: string;
};

/**
 * Approximate token count for text (rough estimate: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build system prompt for chat with project context
 */
export function buildSystemPrompt(
  project: Project,
  systemContext?: string | null
): string {
  const trimmedContext = systemContext?.trim();
  const contextBlock = trimmedContext
    ? `System context (authoritative):
${trimmedContext}`
    : `Project Details:
- Status: ${project.status}
- Priority: ${project.priority || "Not set"}
- Description: ${project.description || "No description"}
${project.tags.length > 0 ? `- Tags: ${project.tags.join(", ")}` : ""}`;

  return `You are a helpful AI assistant for the project "${project.name}".

${contextBlock}

Your role is to help brainstorm ideas, answer questions, and provide guidance related to this project. Be concise, helpful, and creative.

You can also propose creating tasks for this project. If you suggest creating tasks (one or multiple), you MUST ask for user approval first.
When proposing tasks, output them in a STRICT JSON block format at the end of your message, wrapped in \`\`\`json\`\`\` code fences with the structure below.
DO NOT create tasks without this structure.

Example format:
\`\`\`json
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Task description (optional)",
      "priority": "MEDIUM",
      "status": "BACKLOG",
      "dueDate": "2024-12-31" (optional, ISO date)
    }
  ]
}
\`\`\`

Valid priorities: LOW, MEDIUM, HIGH, URGENT
Valid statuses: BACKLOG, TODO, IN_PROGRESS, DONE, ARCHIVED (Default: BACKLOG)

Ground your answers in the latest project details provided above. If the project description changes, adapt your suggestions accordingly.`;
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
  return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
}

/**
 * Build summarization prompt
 */
export function buildSummarizationPrompt(messages: ChatMessage[]): string {
  let prompt = "Please provide a concise summary of the following conversation. Focus on key points, decisions, and context that would be useful to continue the conversation:\n\n";

  for (const msg of messages) {
    const role = msg.role === "USER" ? "User" : msg.role === "ASSISTANT" ? "Assistant" : "System";
    prompt += `${role}: ${msg.content}\n`;
  }

  prompt += "\nProvide a clear, concise summary in 2-3 paragraphs:";

  return prompt;
}

/**
 * Extract task proposals from message content
 */
export function extractTasksFromMessage(content: string): ProposedTask[] | null {
  try {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[1]) as unknown;
    if (data && typeof data === "object" && "tasks" in data) {
      const tasks = (data as { tasks?: unknown }).tasks;
      if (Array.isArray(tasks)) {
        return tasks as ProposedTask[];
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if user message is an approval
 */
export function isApproval(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  const approvalPatterns = [
    /^(yes|yeah|yep|sure|ok|okay|do it|go ahead|proceed|approve|confirm|please do)$/,
    /^create (them|the tasks)$/,
    /^looks good$/,
    /^make it so$/
  ];

  return approvalPatterns.some(pattern => pattern.test(normalized));
}

// ===== Streaming Utilities =====

/**
 * Stream event types for Server-Sent Events
 */
export type StreamEventType = 'chunk' | 'done' | 'error' | 'message_saved';

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
  if (!line.startsWith('data: ')) {
    return null;
  }

  try {
    const jsonStr = line.slice(6); // Remove 'data: ' prefix
    const event = JSON.parse(jsonStr) as StreamEvent;

    // Validate event structure
    if (!event.type || !['chunk', 'done', 'error', 'message_saved'].includes(event.type)) {
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
  const lines = chunk.split('\n');

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
    public readonly code: 'STREAM_ABORTED' | 'STREAM_ERROR' | 'PARSE_ERROR' | 'NETWORK_ERROR'
  ) {
    super(message);
    this.name = 'StreamError';
  }
}

/**
 * Handle stream error with graceful degradation
 * Returns a user-friendly error message
 */
export function handleStreamError(error: unknown): string {
  if (error instanceof StreamError) {
    switch (error.code) {
      case 'STREAM_ABORTED':
        return 'Response was cancelled.';
      case 'NETWORK_ERROR':
        return 'Network connection was lost. Please try again.';
      case 'PARSE_ERROR':
        return 'Received invalid response format.';
      default:
        return 'An error occurred while streaming the response.';
    }
  }

  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Request was cancelled.';
    }
    return error.message;
  }

  return 'An unexpected error occurred.';
}
