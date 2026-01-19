import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import type { Prisma } from "@prisma/client";
import { streamMessageSchema } from "@/lib/chat/validations";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
  encodeSSE,
  resolveTokenCount,
  isPlaceholderThreadName,
  type StreamEvent,
} from "@/lib/chat-utils";
import { createLogger } from "@/lib/logger";
import { modelRegistry, getModelFor, initializeChatServices } from "@/lib/ai";
import type { ModelKey, ModelStreamResult } from "@/lib/ai";

const logger = createLogger("api:chat:stream");

// Initialize chat AI services
initializeChatServices();

// Token cap before triggering summarization (~30k tokens)
const HISTORY_TOKEN_CAP = 30000;
const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER: Prisma.ChatThreadOrderByWithRelationInput[] = [
  { lastChattedAt: "desc" },
  { createdAt: "desc" },
];

/**
 * Get a unique thread name for the user
 */
async function getUniqueThreadName(
  userId: string,
  baseName: string
): Promise<string> {
  const existingThreads = await prisma.chatThread.findMany({
    where: { userId },
    select: { name: true },
  });

  const existingNames = new Set(existingThreads.map((t) => t.name));

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  while (existingNames.has(`${baseName} (${suffix})`)) {
    suffix += 1;
  }

  return `${baseName} (${suffix})`;
}

/**
 * Build a prompt for generating thread titles
 */
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

/**
 * Normalize the generated thread title
 */
function normalizeThreadTitle(rawTitle: string): string {
  const firstLine = rawTitle.split("\n")[0] ?? "";
  const trimmed = firstLine.replace(/^["'""]+|["'""]+$/g, "").trim();
  return trimmed;
}

/**
 * Queue thread title generation (fire-and-forget)
 */
function queueThreadTitleGeneration(params: {
  threadId: string;
  userId: string;
  firstMessage: string;
  currentName: string;
}): void {
  const { threadId, userId, firstMessage, currentName } = params;

  if (!isPlaceholderThreadName(currentName)) {
    return;
  }

  void (async () => {
    try {
      const model = getModelFor("project_chat_summary");
      const prompt = buildThreadTitlePrompt(firstMessage);

      const result = await model.call({
        prompt,
        mode: "text",
      });

      const normalized = normalizeThreadTitle(result.text);
      if (!normalized) {
        return;
      }

      const uniqueName = await getUniqueThreadName(userId, normalized);

      await prisma.chatThread.updateMany({
        where: {
          id: threadId,
          name: currentName ?? undefined,
        },
        data: {
          name: uniqueName,
        },
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

export async function POST(request: Request) {
  const start = Date.now();

  try {
    // Authenticate user
    const { data: session } = await authServer.getSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    const userId = session.user.id;

    // Parse and validate request body
    const body = await request.json();
    const validation = streamMessageSchema.safeParse(body);

    if (!validation.success) {
      logger.warn("Invalid stream request", {
        errors: validation.error.issues,
      });
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { content, threadId, regenerateFromMessageId } = validation.data;
    const isRegenerate = Boolean(regenerateFromMessageId);

    logger.debug("Starting chat stream", {
      userId,
      contentLength: content?.length ?? 0,
      isRegenerate,
    });

    // Get or create thread
    let thread = threadId
      ? await prisma.chatThread.findFirst({
          where: {
            id: threadId,
            userId,
          },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        })
      : await prisma.chatThread.findFirst({
          where: {
            userId,
            archivedAt: null,
          },
          orderBy: THREAD_ORDER,
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

    if (threadId && !thread) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 }
      );
    }

    if (!thread) {
      const name = await getUniqueThreadName(userId, DEFAULT_THREAD_NAME);
      thread = await prisma.chatThread.create({
        data: {
          userId,
          name,
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    }

    let userMessage = null as typeof thread.messages[number] | null;
    let allMessages = thread.messages;

    if (isRegenerate) {
      const targetIndex = thread.messages.findIndex(
        (msg) => msg.id === regenerateFromMessageId
      );

      if (targetIndex === -1) {
        return NextResponse.json(
          { error: "Message not found" },
          { status: 404 }
        );
      }

      const targetMessage = thread.messages[targetIndex];
      if (targetMessage.role !== "ASSISTANT") {
        return NextResponse.json(
          { error: "Can only regenerate assistant messages" },
          { status: 400 }
        );
      }

      const lastMessage = thread.messages[thread.messages.length - 1];
      if (!lastMessage || lastMessage.id !== targetMessage.id) {
        return NextResponse.json(
          { error: "Can only regenerate the latest assistant message" },
          { status: 400 }
        );
      }

      const userIndex = thread.messages
        .slice(0, targetIndex)
        .map((msg) => msg.role)
        .lastIndexOf("USER");
      if (userIndex === -1) {
        return NextResponse.json(
          { error: "No user message found to regenerate from" },
          { status: 400 }
        );
      }

      userMessage = thread.messages[userIndex] ?? null;
      allMessages = thread.messages.slice(0, userIndex + 1);
    } else {
      const shouldGenerateTitle =
        thread.messages.length === 0 && isPlaceholderThreadName(thread.name);

      if (!content) {
        return NextResponse.json(
          { error: "Content is required" },
          { status: 400 }
        );
      }

      // Save user message
      userMessage = await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: "USER",
          content,
          ...resolveTokenCount(content),
        },
      });

      logger.info("User message saved", { messageId: userMessage.id });

      await prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          lastChattedAt: userMessage.createdAt,
        },
      });

      if (shouldGenerateTitle) {
        queueThreadTitleGeneration({
          threadId: thread.id,
          userId,
          firstMessage: content,
          currentName: thread.name,
        });
      }

      // Get all messages including the new one
      allMessages = [...thread.messages, userMessage];
    }

    // Check if we need to summarize
    const historyTokens = calculateHistoryTokens(allMessages);
    logger.debug("Checking history tokens", {
      historyTokens,
      cap: HISTORY_TOKEN_CAP,
    });

    if (historyTokens > HISTORY_TOKEN_CAP && allMessages.length > 2) {
      logger.info("History exceeds cap, summarizing older messages", {
        historyTokens,
        messageCount: allMessages.length,
      });

      // Split messages: keep recent ones, summarize the rest
      const recentCount = Math.ceil(allMessages.length * 0.3); // Keep 30% recent
      const oldMessages = allMessages.slice(0, -recentCount);

      // Call summarization model (blocking - OK for background task)
      const summaryPrompt = buildSummarizationPrompt(oldMessages);
      const summaryModel = getModelFor("project_chat_summary");

      logger.debug("Calling summarization model", {
        oldMessageCount: oldMessages.length,
      });

      const summaryResult = await summaryModel.call({
        prompt: summaryPrompt,
        mode: "text",
      });

      // Update thread with summary
      const oldestSummarizedDate = oldMessages[oldMessages.length - 1]?.createdAt;
      thread = await prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          summary: summaryResult?.text ?? "",
          summaryUpTo: oldestSummarizedDate,
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      logger.info("Conversation summarized", {
        summaryLength: summaryResult?.text.length ?? 0,
        summarizedCount: oldMessages.length,
      });
    }

    // Build prompt with system context + history
    const systemPrompt = buildSystemPrompt();
    const messagesForAI = allMessages.filter((msg) => {
      // If we have a summary, only include messages after summaryUpTo
      if (thread.summaryUpTo) {
        return msg.createdAt > thread.summaryUpTo;
      }
      return true;
    });

    const fullPrompt = formatMessagesForAI(
      systemPrompt,
      messagesForAI,
      thread.summary
    );

    logger.debug("Starting AI stream", {
      promptLength: fullPrompt.length,
      messageCount: messagesForAI.length,
      hasSummary: !!thread.summary,
    });

    // Determine the model to use
    const overrideKey =
      thread.modelKey && modelRegistry.has(thread.modelKey as ModelKey)
        ? (thread.modelKey as ModelKey)
        : undefined;

    if (thread.modelKey && !overrideKey) {
      logger.warn("Stored model key not found in registry", {
        threadId: thread.id,
        modelKey: thread.modelKey,
      });
    }

    const modelMetadata = overrideKey
      ? modelRegistry.getMetadata(overrideKey)
      : undefined;
    const assistantModelData = modelMetadata
      ? {
          modelKey: modelMetadata.key,
          modelLabel: modelMetadata.label,
          modelProvider: modelMetadata.providerId,
        }
      : {
          modelKey: null,
          modelLabel: "Auto routing",
          modelProvider: null,
        };

    // Get the chat model
    const chatModel = getModelFor("project_chat", overrideKey);

    // Check if model supports streaming
    if (!chatModel.streamCall) {
      logger.warn("Model does not support streaming, falling back to blocking call", {
        modelName: chatModel.name,
      });

      // Fallback to blocking call
      const result = await chatModel.call({
        prompt: fullPrompt,
        mode: "text",
      });

      // Save assistant message
      const assistantMessage = await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: "ASSISTANT",
          content: result.text,
          ...resolveTokenCount(result.text, result.usage?.outputTokens),
          ...assistantModelData,
        },
      });

      await prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          lastChattedAt: assistantMessage.createdAt,
        },
      });

      // Return complete response as SSE
      const encoder = new TextEncoder();
      const events = [
        encodeSSE({ type: "chunk", text: result.text }),
        encodeSSE({ type: "message_saved", messageId: assistantMessage.id }),
        encodeSSE({ type: "done" }),
      ];

      return new Response(encoder.encode(events.join("")), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Create streaming response
    const encoder = new TextEncoder();
    const activeThreadId = thread.id;

    const stream = new ReadableStream({
      async start(controller) {
        let accumulatedText = "";
        let streamResult: ModelStreamResult | undefined;

        try {
          // Stream from AI model
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

          // Save complete assistant message to database
          const assistantMessage = await prisma.chatMessage.create({
            data: {
              threadId: activeThreadId,
              role: "ASSISTANT",
              content: finalText,
              ...resolveTokenCount(finalText, streamResult?.usage?.outputTokens),
              ...assistantModelData,
            },
          });

          await prisma.chatThread.update({
            where: { id: activeThreadId },
            data: {
              lastChattedAt: assistantMessage.createdAt,
            },
          });

          logger.info("Chat stream completed", {
            userMessageId: userMessage?.id,
            assistantMessageId: assistantMessage.id,
            responseLength: finalText.length,
            durationMs: Date.now() - start,
          });

          // Send message saved event
          const savedEvent: StreamEvent = {
            type: "message_saved",
            messageId: assistantMessage.id,
          };
          controller.enqueue(encoder.encode(encodeSSE(savedEvent)));

          // Send done event
          const doneEvent: StreamEvent = { type: "done" };
          controller.enqueue(encoder.encode(encodeSSE(doneEvent)));

          controller.close();
        } catch (error) {
          logger.error("Stream error", {
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - start,
          });

          // If we have accumulated text, try to save it
          if (accumulatedText.length > 0) {
            try {
              const partialContent = `${accumulatedText}\n\n[Response interrupted]`;
              const partialMessage = await prisma.chatMessage.create({
                data: {
                  threadId: activeThreadId,
                  role: "ASSISTANT",
                  content: partialContent,
                  ...resolveTokenCount(partialContent),
                  ...assistantModelData,
                },
              });

              await prisma.chatThread.update({
                where: { id: activeThreadId },
                data: {
                  lastChattedAt: partialMessage.createdAt,
                },
              });

              const savedEvent: StreamEvent = {
                type: "message_saved",
                messageId: partialMessage.id,
              };
              controller.enqueue(encoder.encode(encodeSSE(savedEvent)));
            } catch {
              // Ignore save errors in error path
            }
          }

          // Send error event
          const errorEvent: StreamEvent = {
            type: "error",
            error: error instanceof Error ? error.message : "Stream failed",
          };
          controller.enqueue(encoder.encode(encodeSSE(errorEvent)));

          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logger.error("Failed to start chat stream", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    });

    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
