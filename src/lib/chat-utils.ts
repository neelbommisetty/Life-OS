import type { ChatMessage, Project } from "@prisma/client";

/**
 * Approximate token count for text (rough estimate: 1 token ≈ 4 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build system prompt for chat with project context
 */
export function buildSystemPrompt(project: Project): string {
  return `You are a helpful AI assistant for the project "${project.name}".

Project Details:
- Status: ${project.status}
- Priority: ${project.priority || "Not set"}
- Description: ${project.description || "No description"}
${project.tags.length > 0 ? `- Tags: ${project.tags.join(", ")}` : ""}

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
export function extractTasksFromMessage(content: string): any[] | null {
  try {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;

    const data = JSON.parse(jsonMatch[1]);
    if (data && Array.isArray(data.tasks)) {
      return data.tasks;
    }
    return null;
  } catch (e) {
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
