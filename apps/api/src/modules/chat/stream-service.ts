import {
  getModelFor,
  type ModelKey,
  type ModelStreamResult,
} from "@life-os/ai";
import type { ChatMessage, Prisma } from "@life-os/db";
import { createLogger } from "@life-os/logger";
import {
  createChatTrackingContext,
  createSummaryTrackingContext,
  createTitleGenTrackingContext,
  wrapWithTracking,
} from "@life-os/ai/tracking/middleware";
import type { ChatModelRegistry } from "./service.js";
import { streamMessageSchema } from "./schemas.js";
import {
  captureSentryException,
  withSentrySpan,
} from "../common/sentry.js";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
  encodeSSE,
  resolveTokenCount,
  isPlaceholderThreadName,
  type StreamEvent,
} from "./stream-utils.js";
import {
  appendMessageToContext,
  formatPromptFromContext,
  getOrCreateContext,
  summarizeContextIfOverBudget,
  type ContextMessageEntry,
} from "./thread-context-service.js";

const logger = createLogger("api:chat:stream");

const HISTORY_TOKEN_CAP = 30000;
const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER: Prisma.ChatThreadOrderByWithRelationInput[] = [
  { lastChattedAt: "desc" },
  { createdAt: "desc" },
];

type ThreadMessage = Pick<
  ChatMessage,
  "id" | "threadId" | "role" | "content" | "tokenCount" | "createdAt"
>;

type ThreadProject = {
  name: string;
  description: string | null;
  aiInstructions: string | null;
} | null;

type ThreadWithMessages = {
  id: string;
  name: string;
  modelKey: string | null;
  summary: string | null;
  summaryUpTo: Date | null;
  messages: ThreadMessage[];
  project: ThreadProject;
};

type ThreadWithoutMessages = Omit<ThreadWithMessages, "messages">;

type AssistantModelData = {
  modelKey: string | null;
  modelLabel: string | null;
  modelProvider: string | null;
};

type ChatThreadContextRow = {
  threadId: string;
  baseContext: string;
  conversationContext: string;
  conversationTokenCount: number;
  messageCount: number;
  lastMessageId: string | null;
};

type ChatStreamDbTransaction = {
  chatThread: {
    findMany: (args: unknown) => Promise<Array<{ name: string }>>;
    findFirst: (
      args: unknown,
    ) => Promise<ThreadWithMessages | ThreadWithoutMessages | null>;
    create: (args: unknown) => Promise<ThreadWithMessages>;
    update: (
      args: unknown,
    ) => Promise<ThreadWithMessages | ThreadWithoutMessages>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  chatMessage: {
    create: (args: unknown) => Promise<ThreadMessage>;
    findMany: (args: unknown) => Promise<ThreadMessage[]>;
  };
  chatThreadContext: {
    findUnique: (args: unknown) => Promise<ChatThreadContextRow | null>;
    create: (args: unknown) => Promise<ChatThreadContextRow>;
    update: (args: unknown) => Promise<ChatThreadContextRow>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

export type ChatStreamDb = ChatStreamDbTransaction & {
  $transaction: <T>(
    fn: (tx: ChatStreamDbTransaction) => Promise<T>,
  ) => Promise<T>;
};

type StreamChatParams = {
  request: Request;
  userId: string;
  db: ChatStreamDb;
  modelRegistry: ChatModelRegistry;
};

async function traceChatStep<T>(params: {
  name: string;
  mode: "legacy" | "context";
  callback: () => Promise<T> | T;
  attributes?: Record<string, string | number | boolean | undefined>;
}): Promise<T> {
  return withSentrySpan({
    name: params.name,
    op: "chat.stream.step",
    attributes: {
      "chat.mode": params.mode,
      ...params.attributes,
    },
    callback: params.callback,
  });
}

async function getUniqueThreadName(
  db: ChatStreamDb,
  userId: string,
  baseName: string,
): Promise<string> {
  const existingThreads = await db.chatThread.findMany({
    where: { userId },
    select: { name: true },
  });

  const existingNames = new Set(existingThreads.map((thread) => thread.name));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  while (existingNames.has(`${baseName} (${suffix})`)) {
    suffix += 1;
  }

  return `${baseName} (${suffix})`;
}

function buildThreadTitlePrompt(firstMessage: string): string {
  return `Summarize the user's first message into a short, descriptive chat thread title.
Constraints:
- 3 to 6 words
- Title Case
- No quotes or punctuation at the end
- Output only the title

Message:
${firstMessage}`;
}

function normalizeThreadTitle(rawTitle: string): string {
  const firstLine = rawTitle.split("\n")[0] ?? "";
  return firstLine.replace(/^["'""]+|["'""]+$/g, "").trim();
}

function queueThreadTitleGeneration(params: {
  db: ChatStreamDb;
  threadId: string;
  userId: string;
  firstMessage: string;
  currentName: string;
}): void {
  const { db, threadId, userId, firstMessage, currentName } = params;
  if (!isPlaceholderThreadName(currentName)) {
    return;
  }

  void (async () => {
    try {
      const baseModel = getModelFor("project_chat_summary");
      const trackingContext = createTitleGenTrackingContext({
        userId,
        threadId,
      });
      const model = wrapWithTracking(baseModel, trackingContext);
      const prompt = buildThreadTitlePrompt(firstMessage);
      const result = await model.call({ prompt, mode: "text" });
      const normalized = normalizeThreadTitle(result.text);
      if (!normalized) return;

      const uniqueName = await getUniqueThreadName(db, userId, normalized);
      await db.chatThread.updateMany({
        where: {
          id: threadId,
          name: currentName ?? undefined,
        },
        data: { name: uniqueName },
      });

      logger.info("Generated thread title", { threadId, title: uniqueName });
    } catch (error) {
      logger.warn("Failed to generate thread title", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

function streamResponseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
}

function toThreadMessage(message: ThreadMessage): ChatMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    content: message.content,
    modelKey: null,
    modelLabel: null,
    modelProvider: null,
    tokenCount: message.tokenCount,
    tokenCountSource: null,
    savedNoteId: null,
    createdAt: message.createdAt,
  };
}

function toChatMessages(messages: ThreadMessage[]): ChatMessage[] {
  return messages.map(toThreadMessage);
}

function toAssistantModelData(
  modelRegistry: ChatModelRegistry,
  overrideKey: ModelKey | undefined,
): AssistantModelData {
  const metadata = overrideKey ? modelRegistry.getMetadata(overrideKey) : undefined;
  if (metadata) {
    return {
      modelKey: metadata.key,
      modelLabel: metadata.label,
      modelProvider: metadata.providerId,
    };
  }

  return {
    modelKey: null,
    modelLabel: "Auto routing",
    modelProvider: null,
  };
}

async function streamChatLegacy(params: StreamChatParams): Promise<Response> {
  const start = Date.now();

  try {
    const body = await params.request.json();
    const validation = streamMessageSchema.safeParse(body);
    if (!validation.success) {
      logger.warn("Invalid stream request", { errors: validation.error.issues });
      return Response.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 },
      );
    }

    const { content, threadId, regenerateFromMessageId } = validation.data;
    const isRegenerate = Boolean(regenerateFromMessageId);

    logger.debug("Starting chat stream", {
      userId: params.userId,
      contentLength: content?.length ?? 0,
      isRegenerate,
    });

    let thread = (threadId
      ? await params.db.chatThread.findFirst({
          where: { id: threadId, userId: params.userId },
          include: {
            messages: { orderBy: { createdAt: "asc" } },
            project: true,
          },
        })
      : await params.db.chatThread.findFirst({
          where: { userId: params.userId, archivedAt: null },
          orderBy: THREAD_ORDER,
          include: {
            messages: { orderBy: { createdAt: "asc" } },
            project: true,
          },
        })) as ThreadWithMessages | null;

    if (threadId && !thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    if (!thread) {
      const name = await getUniqueThreadName(
        params.db,
        params.userId,
        DEFAULT_THREAD_NAME,
      );
      thread = await params.db.chatThread.create({
        data: {
          userId: params.userId,
          name,
        },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          project: true,
        },
      });
    }

    let userMessage: ThreadMessage | null = null;
    let allMessages = thread.messages;

    if (isRegenerate) {
      const targetIndex = thread.messages.findIndex(
        (message) => message.id === regenerateFromMessageId,
      );
      if (targetIndex === -1) {
        return Response.json({ error: "Message not found" }, { status: 404 });
      }

      const targetMessage = thread.messages[targetIndex];
      if (targetMessage.role !== "ASSISTANT") {
        return Response.json(
          { error: "Can only regenerate assistant messages" },
          { status: 400 },
        );
      }

      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage || lastMessage.id !== targetMessage.id) {
        return Response.json(
          { error: "Can only regenerate the latest assistant message" },
          { status: 400 },
        );
      }

      const userIndex = thread.messages
        .slice(0, targetIndex)
        .map((message) => message.role)
        .lastIndexOf("USER");
      if (userIndex === -1) {
        return Response.json(
          { error: "No user message found to regenerate from" },
          { status: 400 },
        );
      }

      userMessage = thread.messages[userIndex] ?? null;
      allMessages = thread.messages.slice(0, userIndex + 1);
    } else {
      const shouldGenerateTitle =
        thread.messages.length === 0 && isPlaceholderThreadName(thread.name);

      if (!content) {
        return Response.json({ error: "Content is required" }, { status: 400 });
      }

      userMessage = await params.db.chatMessage.create({
        data: {
          threadId: thread.id,
          role: "USER",
          content,
          ...resolveTokenCount(content),
        },
      });

      await params.db.chatThread.update({
        where: { id: thread.id },
        data: { lastChattedAt: userMessage.createdAt },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          project: true,
        },
      });

      if (shouldGenerateTitle) {
        queueThreadTitleGeneration({
          db: params.db,
          threadId: thread.id,
          userId: params.userId,
          firstMessage: content,
          currentName: thread.name,
        });
      }

      allMessages = [...thread.messages, userMessage];
    }

    const promptMessages = toChatMessages(allMessages);
    const historyTokens = calculateHistoryTokens(promptMessages);

    if (historyTokens > HISTORY_TOKEN_CAP && allMessages.length > 2) {
      const recentCount = Math.ceil(allMessages.length * 0.3);
      const oldMessages = allMessages.slice(0, -recentCount);
      const summaryPrompt = buildSummarizationPrompt(toChatMessages(oldMessages));
      const baseSummaryModel = getModelFor("project_chat_summary");
      const summaryTrackingContext = createSummaryTrackingContext({
        userId: params.userId,
        threadId: thread.id,
      });
      const summaryModel = wrapWithTracking(baseSummaryModel, summaryTrackingContext);
      const summaryResult = await summaryModel.call({
        prompt: summaryPrompt,
        mode: "text",
      });
      const oldestSummarizedDate = oldMessages[oldMessages.length - 1]?.createdAt;

      thread = (await params.db.chatThread.update({
        where: { id: thread.id },
        data: {
          summary: summaryResult?.text ?? "",
          summaryUpTo: oldestSummarizedDate,
        },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          project: true,
        },
      })) as ThreadWithMessages;
    }

    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const projectContext = thread.project
      ? {
          name: thread.project.name,
          description: thread.project.description,
          aiInstructions: thread.project.aiInstructions,
        }
      : undefined;
    const systemPrompt = buildSystemPrompt(projectContext);
    const messagesForAI = allMessages.filter((message) => {
      if (thread.summaryUpTo) {
        return message.createdAt > thread.summaryUpTo;
      }
      return true;
    });

    const fullPrompt = formatMessagesForAI(
      systemPrompt,
      toChatMessages(messagesForAI),
      thread.summary,
    );

    const overrideKey =
      thread.modelKey && params.modelRegistry.has(thread.modelKey as ModelKey)
        ? (thread.modelKey as ModelKey)
        : undefined;

    const assistantModelData = toAssistantModelData(
      params.modelRegistry,
      overrideKey,
    );

    const baseChatModel = getModelFor("project_chat", overrideKey);
    const chatTrackingContext = createChatTrackingContext({
      userId: params.userId,
      threadId: thread.id,
      isStreaming: Boolean(baseChatModel.streamCall),
    });
    const chatModel = wrapWithTracking(baseChatModel, chatTrackingContext);

    if (!chatModel.streamCall) {
      const result = await chatModel.call({
        prompt: fullPrompt,
        mode: "text",
      });

      const assistantMessage = await params.db.chatMessage.create({
        data: {
          threadId: thread.id,
          role: "ASSISTANT",
          content: result.text,
          ...resolveTokenCount(result.text, result.usage?.outputTokens),
          ...assistantModelData,
        },
      });

      await params.db.chatThread.update({
        where: { id: thread.id },
        data: { lastChattedAt: assistantMessage.createdAt },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          project: true,
        },
      });

      const payload = [
        encodeSSE({ type: "chunk", text: result.text }),
        encodeSSE({ type: "message_saved", messageId: assistantMessage.id }),
        encodeSSE({ type: "done" }),
      ].join("");

      return new Response(new TextEncoder().encode(payload), {
        headers: streamResponseHeaders(),
      });
    }

    const activeThreadId = thread.id;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedText = "";
        let streamResult: ModelStreamResult | undefined;

        try {
          const streamGenerator = chatModel.streamCall!({
            prompt: fullPrompt,
            mode: "text",
          });

          while (true) {
            const { value, done } = await streamGenerator.next();
            if (done) {
              streamResult = value;
              break;
            }

            if (value.text) {
              accumulatedText += value.text;
              const event: StreamEvent = { type: "chunk", text: value.text };
              controller.enqueue(encoder.encode(encodeSSE(event)));
            }
          }

          const finalText =
            streamResult?.text?.length ? streamResult.text : accumulatedText;

          const assistantMessage = await params.db.chatMessage.create({
            data: {
              threadId: activeThreadId,
              role: "ASSISTANT",
              content: finalText,
              ...resolveTokenCount(finalText, streamResult?.usage?.outputTokens),
              ...assistantModelData,
            },
          });

          await params.db.chatThread.update({
            where: { id: activeThreadId },
            data: { lastChattedAt: assistantMessage.createdAt },
            include: {
              messages: { orderBy: { createdAt: "asc" } },
              project: true,
            },
          });

          logger.info("Chat stream completed", {
            userMessageId: userMessage?.id,
            assistantMessageId: assistantMessage.id,
            responseLength: finalText.length,
            durationMs: Date.now() - start,
          });

          controller.enqueue(
            encoder.encode(
              encodeSSE({ type: "message_saved", messageId: assistantMessage.id }),
            ),
          );
          controller.enqueue(encoder.encode(encodeSSE({ type: "done" })));
          controller.close();
        } catch (error) {
          captureSentryException(error, {
            tags: {
              mode: "context",
              step: "chat_model_stream",
            },
            extras: {
              threadId: activeThreadId,
            },
          });
          logger.error("Stream error", {
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - start,
          });

          if (accumulatedText.length > 0) {
            try {
              const partialContent = `${accumulatedText}\n\n[Response interrupted]`;
              const partialMessage = await params.db.chatMessage.create({
                data: {
                  threadId: activeThreadId,
                  role: "ASSISTANT",
                  content: partialContent,
                  ...resolveTokenCount(partialContent),
                  ...assistantModelData,
                },
              });

              await params.db.chatThread.update({
                where: { id: activeThreadId },
                data: { lastChattedAt: partialMessage.createdAt },
                include: {
                  messages: { orderBy: { createdAt: "asc" } },
                  project: true,
                },
              });

              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "message_saved",
                    messageId: partialMessage.id,
                  }),
                ),
              );
            } catch {
              // ignore save failures in stream error path
            }
          }

          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "error",
                error:
                  error instanceof Error ? error.message : "Stream failed",
              }),
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: streamResponseHeaders() });
  } catch (error) {
    logger.error("Failed to start chat stream", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    });

    return Response.json({ error: "Failed to process request" }, { status: 500 });
  }
}

type ValidatedStreamInput = {
  threadId?: string;
  content?: string;
  regenerateFromMessageId?: string;
};

function toChatMessagesFromContext(
  messages: ContextMessageEntry[],
  threadId: string,
): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    threadId,
    role: message.role,
    content: message.content,
    modelKey: null,
    modelLabel: null,
    modelProvider: null,
    tokenCount: message.tokenCount,
    tokenCountSource: null,
    savedNoteId: null,
    createdAt: message.createdAt,
  }));
}

async function persistAssistantMessageWithContext(params: {
  db: ChatStreamDb;
  threadId: string;
  text: string;
  assistantModelData: AssistantModelData;
  usageOutputTokens?: number | null;
}) {
  const tokenData = resolveTokenCount(params.text, params.usageOutputTokens);

  return params.db.$transaction(async (tx) => {
    const assistantMessage = await tx.chatMessage.create({
      data: {
        threadId: params.threadId,
        role: "ASSISTANT",
        content: params.text,
        ...tokenData,
        ...params.assistantModelData,
      },
    });

    await appendMessageToContext({
      db: tx,
      threadId: params.threadId,
      message: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        content: assistantMessage.content,
        tokenCount: tokenData.tokenCount,
        createdAt: assistantMessage.createdAt,
      },
    });

    await tx.chatThread.update({
      where: { id: params.threadId },
      data: { lastChattedAt: assistantMessage.createdAt },
    });

    return assistantMessage;
  });
}

async function streamChatWithContextTable(
  params: StreamChatParams,
  input: ValidatedStreamInput,
): Promise<Response> {
  const start = Date.now();

  try {
    if (!input.content) {
      return Response.json({ error: "Content is required" }, { status: 400 });
    }

    const { content, threadId } = input;

    const thread = await traceChatStep({
      name: "chat.context.thread.resolve",
      mode: "context",
      attributes: {
        "chat.has_thread_id": Boolean(threadId),
      },
      callback: async () => {
        let resolved = (threadId
          ? await params.db.chatThread.findFirst({
              where: { id: threadId, userId: params.userId },
              include: { project: true },
            })
          : await params.db.chatThread.findFirst({
              where: { userId: params.userId, archivedAt: null },
              orderBy: THREAD_ORDER,
              include: { project: true },
            })) as ThreadWithoutMessages | null;

        if (threadId && !resolved) {
          return null;
        }

        if (!resolved) {
          const name = await getUniqueThreadName(
            params.db,
            params.userId,
            DEFAULT_THREAD_NAME,
          );
          resolved = (await params.db.chatThread.create({
            data: {
              userId: params.userId,
              name,
            },
            include: { project: true },
          })) as ThreadWithoutMessages;
        }

        return resolved;
      },
    });

    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const existingContext = await traceChatStep({
      name: "chat.context.get_or_create",
      mode: "context",
      callback: async () =>
        getOrCreateContext({
          db: params.db,
          thread,
        }),
    });

    const shouldGenerateTitle =
      existingContext.messageCount === 0 && isPlaceholderThreadName(thread.name);

    const userTokenData = resolveTokenCount(content);
    const { userMessage, updatedContext } = await traceChatStep({
      name: "chat.context.append.user",
      mode: "context",
      callback: async () =>
        params.db.$transaction(async (tx) => {
          const created = await tx.chatMessage.create({
            data: {
              threadId: thread.id,
              role: "USER",
              content,
              ...userTokenData,
            },
          });

          const contextAfterAppend = await appendMessageToContext({
            db: tx,
            threadId: thread.id,
            message: {
              id: created.id,
              role: created.role,
              content: created.content,
              tokenCount: userTokenData.tokenCount,
              createdAt: created.createdAt,
            },
          });

          await tx.chatThread.update({
            where: { id: thread.id },
            data: { lastChattedAt: created.createdAt },
          });

          return {
            userMessage: created,
            updatedContext: contextAfterAppend,
          };
        }),
    });

    if (shouldGenerateTitle) {
      queueThreadTitleGeneration({
        db: params.db,
        threadId: thread.id,
        userId: params.userId,
        firstMessage: content,
        currentName: thread.name,
      });
    }

    const contextSummaryResult = await traceChatStep({
      name: "chat.context.summarize_if_needed",
      mode: "context",
      attributes: {
        "chat.context_token_count": updatedContext.conversationTokenCount,
      },
      callback: async () =>
        summarizeContextIfOverBudget({
          db: params.db,
          context: updatedContext,
          tokenCap: HISTORY_TOKEN_CAP,
          summarize: async (messagesToSummarize) =>
            traceChatStep({
              name: "chat.context.summarize.model_call",
              mode: "context",
              callback: async () => {
                const summaryPrompt = buildSummarizationPrompt(
                  toChatMessagesFromContext(messagesToSummarize, thread.id),
                );
                const baseSummaryModel = getModelFor("project_chat_summary");
                const summaryTrackingContext = createSummaryTrackingContext({
                  userId: params.userId,
                  threadId: thread.id,
                });
                const summaryModel = wrapWithTracking(
                  baseSummaryModel,
                  summaryTrackingContext,
                );
                const summaryResult = await summaryModel.call({
                  prompt: summaryPrompt,
                  mode: "text",
                });
                return summaryResult.text;
              },
            }),
        }),
    });

    if (contextSummaryResult.summary !== null || contextSummaryResult.summaryUpTo !== null) {
      await traceChatStep({
        name: "chat.context.summary.dual_write_legacy",
        mode: "context",
        callback: async () => {
          await params.db.chatThread.update({
            where: { id: thread.id },
            data: {
              summary: contextSummaryResult.summary,
              summaryUpTo: contextSummaryResult.summaryUpTo,
            },
          });
        },
      });
    }

    const fullPrompt = formatPromptFromContext({
      baseContext: contextSummaryResult.context.baseContext,
      conversationContext: contextSummaryResult.context.conversationContext,
    });

    const overrideKey =
      thread.modelKey && params.modelRegistry.has(thread.modelKey as ModelKey)
        ? (thread.modelKey as ModelKey)
        : undefined;

    const assistantModelData = toAssistantModelData(
      params.modelRegistry,
      overrideKey,
    );

    const baseChatModel = getModelFor("project_chat", overrideKey);
    const chatTrackingContext = createChatTrackingContext({
      userId: params.userId,
      threadId: thread.id,
      isStreaming: Boolean(baseChatModel.streamCall),
    });
    const chatModel = wrapWithTracking(baseChatModel, chatTrackingContext);

    if (!chatModel.streamCall) {
      const result = await traceChatStep({
        name: "chat.model.call",
        mode: "context",
        callback: async () =>
          chatModel.call({
            prompt: fullPrompt,
            mode: "text",
          }),
      });

      const assistantMessage = await traceChatStep({
        name: "chat.context.append.assistant",
        mode: "context",
        callback: async () =>
          persistAssistantMessageWithContext({
            db: params.db,
            threadId: thread.id,
            text: result.text,
            usageOutputTokens: result.usage?.outputTokens,
            assistantModelData,
          }),
      });

      const payload = [
        encodeSSE({ type: "chunk", text: result.text }),
        encodeSSE({ type: "message_saved", messageId: assistantMessage.id }),
        encodeSSE({ type: "done" }),
      ].join("");

      return new Response(new TextEncoder().encode(payload), {
        headers: streamResponseHeaders(),
      });
    }

    const activeThreadId = thread.id;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedText = "";
        let streamResult: ModelStreamResult | undefined;

        try {
          const streamGenerator = await traceChatStep({
            name: "chat.model.stream.start",
            mode: "context",
            callback: async () =>
              chatModel.streamCall!({
                prompt: fullPrompt,
                mode: "text",
              }),
          });

          while (true) {
            const { value, done } = await streamGenerator.next();
            if (done) {
              streamResult = value;
              break;
            }

            if (value.text) {
              accumulatedText += value.text;
              const event: StreamEvent = { type: "chunk", text: value.text };
              controller.enqueue(encoder.encode(encodeSSE(event)));
            }
          }

          const finalText =
            streamResult?.text?.length ? streamResult.text : accumulatedText;

          const assistantMessage = await traceChatStep({
            name: "chat.context.append.assistant",
            mode: "context",
            callback: async () =>
              persistAssistantMessageWithContext({
                db: params.db,
                threadId: activeThreadId,
                text: finalText,
                usageOutputTokens: streamResult?.usage?.outputTokens,
                assistantModelData,
              }),
          });

          logger.info("Chat stream completed", {
            userMessageId: userMessage?.id,
            assistantMessageId: assistantMessage.id,
            responseLength: finalText.length,
            durationMs: Date.now() - start,
          });

          controller.enqueue(
            encoder.encode(
              encodeSSE({ type: "message_saved", messageId: assistantMessage.id }),
            ),
          );
          controller.enqueue(encoder.encode(encodeSSE({ type: "done" })));
          controller.close();
        } catch (error) {
          logger.error("Stream error", {
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - start,
          });

          if (accumulatedText.length > 0) {
            try {
              const partialContent = `${accumulatedText}\n\n[Response interrupted]`;
              const partialMessage = await traceChatStep({
                name: "chat.context.append.assistant_partial",
                mode: "context",
                callback: async () =>
                  persistAssistantMessageWithContext({
                    db: params.db,
                    threadId: activeThreadId,
                    text: partialContent,
                    assistantModelData,
                  }),
              });

              controller.enqueue(
                encoder.encode(
                  encodeSSE({
                    type: "message_saved",
                    messageId: partialMessage.id,
                  }),
                ),
              );
            } catch {
              // ignore save failures in stream error path
            }
          }

          controller.enqueue(
            encoder.encode(
              encodeSSE({
                type: "error",
                error:
                  error instanceof Error ? error.message : "Stream failed",
              }),
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: streamResponseHeaders() });
  } catch (error) {
    captureSentryException(error, {
      tags: {
        mode: "context",
        step: "chat_stream_start",
      },
      extras: {
        durationMs: Date.now() - start,
      },
    });
    logger.error("Failed to start chat stream (context mode)", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    });

    return Response.json({ error: "Failed to process request" }, { status: 500 });
  }
}

export async function streamChat(params: StreamChatParams): Promise<Response> {
  try {
    const validation = await traceChatStep({
      name: "chat.request.parse_and_validate",
      mode: "context",
      callback: async () => {
        const cloned = params.request.clone();
        const body = (await cloned.json()) as unknown;
        return streamMessageSchema.safeParse(body);
      },
    });
    if (!validation.success) {
      await traceChatStep({
        name: "chat.route.legacy_fallback.invalid_request",
        mode: "legacy",
        callback: async () => undefined,
      });
      return streamChatLegacy(params);
    }

    if (validation.data.regenerateFromMessageId) {
      await traceChatStep({
        name: "chat.route.legacy_fallback.regenerate",
        mode: "legacy",
        callback: async () => undefined,
      });
      return streamChatLegacy(params);
    }

    return streamChatWithContextTable(params, validation.data);
  } catch (error) {
    captureSentryException(error, {
      tags: {
        mode: "router",
        step: "chat_request_parse",
      },
    });
    return streamChatLegacy(params);
  }
}
