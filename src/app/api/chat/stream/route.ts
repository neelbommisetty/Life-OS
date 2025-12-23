import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import type { Prisma } from "@prisma/client";
import { streamMessageSchema } from "@/lib/validations/chat";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
  encodeSSE,
  type StreamEvent,
} from "@/lib/chat-utils";
import { createLogger } from "@/lib/logger";
import "@/lib/ai/init";
import { modelRegistry } from "@/lib/ai";
import { getModelFor } from "@/lib/ai/providers/router";
import { initializeChatServices } from "@/lib/ai/chat-services";
import type { ModelKey } from "@/lib/ai";
import {
  getUniqueThreadName,
  isPlaceholderThreadName,
  queueThreadTitleGeneration,
} from "@/server/chat-thread-utils";

const logger = createLogger("api:chat:stream");

// Initialize chat AI services
initializeChatServices();

// Token cap before triggering summarization (~6k tokens)
const HISTORY_TOKEN_CAP = 6000;
const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER: Prisma.ChatThreadOrderByWithRelationInput[] = [
  { lastChattedAt: "desc" },
  { createdAt: "desc" },
];

export async function POST(request: Request) {
  const start = Date.now();

  try {
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

    const { projectId, content, threadId, regenerateFromMessageId } =
      validation.data;
    const isRegenerate = Boolean(regenerateFromMessageId);

    logger.debug("Starting chat stream", {
      projectId,
      contentLength: content?.length ?? 0,
      isRegenerate,
    });

    // Get project with details
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      logger.warn("Project not found", { projectId });
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Get or create thread
    let thread = threadId
      ? await prisma.chatThread.findFirst({
          where: {
            id: threadId,
            projectId,
          },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        })
      : await prisma.chatThread.findFirst({
          where: {
            projectId,
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
      const name = await getUniqueThreadName(
        projectId,
        DEFAULT_THREAD_NAME,
        prisma
      );
      thread = await prisma.chatThread.create({
        data: {
          projectId,
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
          projectId,
          firstMessage: content,
          currentName: thread.name,
          client: prisma,
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
          summary: summaryResult.text,
          summaryUpTo: oldestSummarizedDate,
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      logger.info("Conversation summarized", {
        summaryLength: summaryResult.text.length,
        summarizedCount: oldMessages.length,
      });
    }

    // Build prompt with system context + history
    const systemPrompt = buildSystemPrompt(project);
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

        try {
          // Stream from AI model
          const streamGenerator = chatModel.streamCall!({
            prompt: fullPrompt,
            mode: "text",
          });

          for await (const chunk of streamGenerator) {
            if (chunk.text) {
              accumulatedText += chunk.text;
              const event: StreamEvent = { type: "chunk", text: chunk.text };
              controller.enqueue(encoder.encode(encodeSSE(event)));
            }

            if (chunk.done) {
              break;
            }
          }

          // Save complete assistant message to database
          const assistantMessage = await prisma.chatMessage.create({
            data: {
              threadId: activeThreadId,
              role: "ASSISTANT",
              content: accumulatedText,
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
            responseLength: accumulatedText.length,
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
              const partialMessage = await prisma.chatMessage.create({
                data: {
                  threadId: activeThreadId,
                  role: "ASSISTANT",
                  content: accumulatedText + "\n\n[Response interrupted]",
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
