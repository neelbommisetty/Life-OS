import type { ChatMessage, ChatRole } from "@life-os/db";
import {
  buildSystemPrompt,
  estimateTokens,
  formatMessagesForAI,
} from "./stream-utils.js";

const SUMMARY_START = "<|summary:base64|>";
const SUMMARY_END = "<|endsummary|>";
const MESSAGE_BLOCK_REGEX =
  /<\|msg\|role=(USER|ASSISTANT|SYSTEM)\|id=([^|]+)\|createdAt=([^|]+)\|tokenCount=(\d+)\|>\n([\s\S]*?)\n<\|endmsg\|>\n?/g;

export type ContextMessageEntry = {
  id: string;
  role: ChatRole;
  content: string;
  tokenCount: number;
  createdAt: Date;
};

type ThreadProject = {
  name: string;
  description: string | null;
  aiInstructions: string | null;
} | null;

type ThreadForContext = {
  id: string;
  summary: string | null;
  summaryUpTo: Date | null;
  project: ThreadProject;
};

type ContextRow = {
  threadId: string;
  baseContext: string;
  conversationContext: string;
  conversationTokenCount: number;
  messageCount: number;
  lastMessageId: string | null;
};

type LegacyMessage = Pick<
  ChatMessage,
  "id" | "role" | "content" | "tokenCount" | "createdAt"
>;

export type ChatThreadContextDb = {
  chatThreadContext: {
    findUnique: (args: unknown) => Promise<ContextRow | null>;
    create: (args: unknown) => Promise<ContextRow>;
    update: (args: unknown) => Promise<ContextRow>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  chatMessage: {
    findMany: (args: unknown) => Promise<LegacyMessage[]>;
  };
};

type ParsedConversationContext = {
  summary: string | null;
  messages: ContextMessageEntry[];
};

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decodeBase64(value: string): string {
  return Buffer.from(value, "base64").toString("utf8");
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[|\n\r]/g, "");
}

function toSafeTokenCount(tokenCount: number | null | undefined, content: string): number {
  return typeof tokenCount === "number" ? tokenCount : estimateTokens(content);
}

function parseSummaryBlock(raw: string): { summary: string | null; remainder: string } {
  if (!raw.startsWith(`${SUMMARY_START}\n`)) {
    return { summary: null, remainder: raw };
  }

  const endMarker = `\n${SUMMARY_END}\n`;
  const endIndex = raw.indexOf(endMarker);
  if (endIndex === -1) {
    return { summary: null, remainder: raw };
  }

  const encoded = raw.slice(SUMMARY_START.length + 1, endIndex);
  const summary = encoded.length > 0 ? decodeBase64(encoded) : null;
  const remainder = raw.slice(endIndex + endMarker.length);
  return { summary, remainder };
}

function serializeSummaryBlock(summary: string | null): string {
  const encoded = summary && summary.length > 0 ? encodeBase64(summary) : "";
  return `${SUMMARY_START}\n${encoded}\n${SUMMARY_END}\n`;
}

function serializeMessageBlock(message: ContextMessageEntry): string {
  const encodedContent = encodeBase64(message.content);
  const role = sanitizeMetadata(message.role);
  const id = sanitizeMetadata(message.id);
  const createdAt = sanitizeMetadata(message.createdAt.toISOString());
  const tokenCount = Math.max(0, Math.floor(message.tokenCount));

  return `<|msg|role=${role}|id=${id}|createdAt=${createdAt}|tokenCount=${tokenCount}|>\n${encodedContent}\n<|endmsg|>\n`;
}

function toChatMessages(entries: ContextMessageEntry[]): ChatMessage[] {
  return entries.map((entry) => ({
    id: entry.id,
    threadId: "",
    role: entry.role,
    content: entry.content,
    modelKey: null,
    modelLabel: null,
    modelProvider: null,
    tokenCount: entry.tokenCount,
    tokenCountSource: null,
    savedNoteId: null,
    createdAt: entry.createdAt,
  }));
}

export function parseConversationContext(conversationContext: string): ParsedConversationContext {
  const { summary, remainder } = parseSummaryBlock(conversationContext);
  const messages: ContextMessageEntry[] = [];
  let match: RegExpExecArray | null = null;

  MESSAGE_BLOCK_REGEX.lastIndex = 0;
  while (true) {
    match = MESSAGE_BLOCK_REGEX.exec(remainder);
    if (!match) break;

    const [, roleRaw, idRaw, createdAtRaw, tokenCountRaw, encodedContent] = match;
    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime())) {
      continue;
    }

    const role = roleRaw as ChatRole;
    const tokenCount = Number(tokenCountRaw);
    const content = decodeBase64(encodedContent);

    messages.push({
      id: idRaw,
      role,
      content,
      tokenCount: Number.isFinite(tokenCount) ? tokenCount : estimateTokens(content),
      createdAt,
    });
  }

  return { summary, messages };
}

export function serializeConversationContext(params: {
  summary: string | null;
  messages: ContextMessageEntry[];
}): string {
  const summaryBlock = serializeSummaryBlock(params.summary);
  const messageBlocks = params.messages.map(serializeMessageBlock).join("");
  return `${summaryBlock}${messageBlocks}`;
}

function buildConversationPayload(params: {
  summary: string | null;
  messages: ContextMessageEntry[];
}) {
  const conversationTokenCount =
    (params.summary ? estimateTokens(params.summary) : 0) +
    params.messages.reduce((total, message) => total + message.tokenCount, 0);

  return {
    conversationContext: serializeConversationContext(params),
    conversationTokenCount,
    messageCount: params.messages.length,
    lastMessageId: params.messages[params.messages.length - 1]?.id ?? null,
  };
}

export async function getOrCreateContext(params: {
  db: ChatThreadContextDb;
  thread: ThreadForContext;
}): Promise<ContextRow> {
  const baseContext = buildSystemPrompt(
    params.thread.project
      ? {
          name: params.thread.project.name,
          description: params.thread.project.description,
          aiInstructions: params.thread.project.aiInstructions,
        }
      : undefined,
  );

  const existing = await params.db.chatThreadContext.findUnique({
    where: { threadId: params.thread.id },
  });

  if (existing) {
    if (existing.baseContext !== baseContext) {
      return params.db.chatThreadContext.update({
        where: { threadId: params.thread.id },
        data: { baseContext },
      });
    }
    return existing;
  }

  const unsummarizedMessages = await params.db.chatMessage.findMany({
    where: {
      threadId: params.thread.id,
      ...(params.thread.summaryUpTo
        ? { createdAt: { gt: params.thread.summaryUpTo } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      tokenCount: true,
      createdAt: true,
    },
  });

  const contextMessages: ContextMessageEntry[] = unsummarizedMessages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    tokenCount: toSafeTokenCount(message.tokenCount, message.content),
    createdAt: message.createdAt,
  }));

  const payload = buildConversationPayload({
    summary: params.thread.summary ?? null,
    messages: contextMessages,
  });

  return params.db.chatThreadContext.create({
    data: {
      threadId: params.thread.id,
      baseContext,
      ...payload,
    },
  });
}

export async function appendMessageToContext(params: {
  db: ChatThreadContextDb;
  threadId: string;
  message: ContextMessageEntry;
}): Promise<ContextRow> {
  const maxRetries = 3;
  let retries = 0;

  while (retries <= maxRetries) {
    const existing = await params.db.chatThreadContext.findUnique({
      where: { threadId: params.threadId },
    });

    if (!existing) {
      throw new Error("Chat thread context not found");
    }

    if (existing.lastMessageId === params.message.id) {
      return existing;
    }

    const updateResult = await params.db.chatThreadContext.updateMany({
      where: {
        threadId: params.threadId,
        lastMessageId: existing.lastMessageId,
      },
      data: {
        conversationContext: `${existing.conversationContext}${serializeMessageBlock(params.message)}`,
        conversationTokenCount: existing.conversationTokenCount + params.message.tokenCount,
        messageCount: existing.messageCount + 1,
        lastMessageId: params.message.id,
      },
    });

    if (updateResult.count === 1) {
      const updated = await params.db.chatThreadContext.findUnique({
        where: { threadId: params.threadId },
      });
      if (!updated) {
        throw new Error("Chat thread context not found after update");
      }
      return updated;
    }

    retries += 1;
  }

  throw new Error("Failed to append message to context after retries");
}

export async function summarizeContextIfOverBudget(params: {
  db: ChatThreadContextDb;
  context: ContextRow;
  tokenCap: number;
  summarize: (messagesToSummarize: ContextMessageEntry[]) => Promise<string>;
}): Promise<{
  context: ContextRow;
  summary: string | null;
  summaryUpTo: Date | null;
}> {
  if (params.context.conversationTokenCount <= params.tokenCap) {
    return { context: params.context, summary: null, summaryUpTo: null };
  }

  const parsed = parseConversationContext(params.context.conversationContext);
  if (parsed.messages.length <= 2) {
    return { context: params.context, summary: null, summaryUpTo: null };
  }

  const recentCount = Math.ceil(parsed.messages.length * 0.3);
  const oldMessages = parsed.messages.slice(0, -recentCount);
  const keptMessages = parsed.messages.slice(-recentCount);

  if (oldMessages.length === 0) {
    return { context: params.context, summary: null, summaryUpTo: null };
  }

  const summaryText = await params.summarize(oldMessages);
  const mergedSummary = [parsed.summary, summaryText].filter(Boolean).join("\n\n");
  const payload = buildConversationPayload({
    summary: mergedSummary.length > 0 ? mergedSummary : null,
    messages: keptMessages,
  });

  const updated = await params.db.chatThreadContext.update({
    where: { threadId: params.context.threadId },
    data: payload,
  });

  return {
    context: updated,
    summary: mergedSummary.length > 0 ? mergedSummary : null,
    summaryUpTo: oldMessages[oldMessages.length - 1]?.createdAt ?? null,
  };
}

export function formatPromptFromContext(params: {
  baseContext: string;
  conversationContext: string;
}): string {
  const parsed = parseConversationContext(params.conversationContext);
  return formatMessagesForAI(
    params.baseContext,
    toChatMessages(parsed.messages),
    parsed.summary,
  );
}

export async function refreshBaseContext(params: {
  db: ChatThreadContextDb;
  threadId: string;
  baseContext: string;
}) {
  return params.db.chatThreadContext.update({
    where: { threadId: params.threadId },
    data: { baseContext: params.baseContext },
  });
}
