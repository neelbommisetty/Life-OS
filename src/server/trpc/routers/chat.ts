import { TRPCError } from "@trpc/server";
import type { TaskStatus, Priority, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  getThreadSchema,
  listMessagesSchema,
  getMessageReasoningSchema,
  sendMessageSchema,
  setThreadModelSchema,
  setThreadReasoningSchema,
  listThreadsSchema,
  createThreadSchema,
  archiveThreadSchema,
} from "@/lib/validations/chat";
import { createTaskSchema, createManyTaskSchema } from "@/lib/validations/task";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/logger";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  estimateTokens,
  buildSummarizationPrompt,
  extractTasksFromMessage,
  isApproval,
} from "@/lib/chat-utils";
import "@/lib/ai/init";
import { modelRegistry } from "@/lib/ai";
import { getModelFor } from "@/lib/ai/providers/router";
import { initializeChatServices } from "@/lib/ai/chat-services";
import type { ModelKey } from "@/lib/ai";
import { getTelemetryFromError, recordAiCall } from "@/server/ai/telemetry";
import {
  getUniqueThreadName,
  isPlaceholderThreadName,
  queueThreadTitleGeneration,
} from "@/server/chat-thread-utils";
import { SYSTEM_CONTEXT_ARTIFACT_TITLE } from "@/lib/system-context";

const logger = createLogger("trpc:chat");

// Initialize chat AI services
initializeChatServices();

const resolveAiStatus = (error: unknown): "ERROR" | "ABORTED" => {
  if (!error || typeof error !== "object") {
    return "ERROR";
  }

  const typed = error as { name?: string; code?: string };
  if (typed.name === "AbortError" || typed.code === "STREAM_ABORTED") {
    return "ABORTED";
  }

  return "ERROR";
};

const resolveTokenCount = (text: string, usageTokens?: number | null) => {
  if (typeof usageTokens === "number") {
    return { tokenCount: usageTokens, tokenCountSource: "usage" };
  }
  return { tokenCount: estimateTokens(text), tokenCountSource: "estimate" };
};

const resolveReasoningTokenCount = (
  text: string,
  usageTokens?: number | null
) => {
  if (typeof usageTokens === "number") {
    return { tokenCount: usageTokens, tokenCountSource: "usage" };
  }
  return { tokenCount: estimateTokens(text), tokenCountSource: "estimate" };
};

// Token cap before triggering summarization (~30k tokens)
const HISTORY_TOKEN_CAP = 30000;
const DEFAULT_THREAD_NAME = "New thread";
const THREAD_ORDER: Prisma.ChatThreadOrderByWithRelationInput[] = [
  { lastChattedAt: "desc" },
  { createdAt: "desc" },
];

export const chatRouter = router({
  getThread: publicProcedure
    .input(getThreadSchema)
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Getting chat thread", { projectId: input.projectId });

      try {
        // Check if project exists
        const project = await ctx.prisma.project.findUnique({
          where: { id: input.projectId },
        });

        if (!project) {
          logger.warn("Project not found", { projectId: input.projectId });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        let thread = input.threadId
          ? await ctx.prisma.chatThread.findFirst({
              where: {
                id: input.threadId,
                projectId: input.projectId,
              },
            })
          : await ctx.prisma.chatThread.findFirst({
              where: {
                projectId: input.projectId,
                archivedAt: null,
              },
              orderBy: THREAD_ORDER,
            });

        if (input.threadId && !thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Thread not found",
          });
        }

        if (!thread) {
          logger.info("Creating default chat thread", {
            projectId: input.projectId,
          });
          const name = await getUniqueThreadName(
            input.projectId,
            DEFAULT_THREAD_NAME,
            ctx.prisma
          );
          thread = await ctx.prisma.chatThread.create({
            data: {
              projectId: input.projectId,
              name,
            },
          });
        }

        logger.info("Chat thread retrieved successfully", {
          threadId: thread.id,
          durationMs: Date.now() - start,
        });

        return thread;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to get chat thread", {
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  listThreads: publicProcedure
    .input(listThreadsSchema)
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Listing chat threads", { projectId: input.projectId });

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        logger.warn("Project not found", { projectId: input.projectId });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const includeArchived = input.includeArchived ?? false;

      let threads = await ctx.prisma.chatThread.findMany({
        where: {
          projectId: input.projectId,
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: THREAD_ORDER,
      });

      if (!includeArchived && threads.length === 0) {
        const name = await getUniqueThreadName(
          input.projectId,
          DEFAULT_THREAD_NAME,
          ctx.prisma
        );
        const created = await ctx.prisma.chatThread.create({
          data: {
            projectId: input.projectId,
            name,
          },
        });
        threads = [created];
      }

      logger.info("Chat threads listed", {
        projectId: input.projectId,
        count: threads.length,
        durationMs: Date.now() - start,
      });

      return threads;
    }),

  createThread: publicProcedure
    .input(createThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating chat thread", { projectId: input.projectId });

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        logger.warn("Project not found", { projectId: input.projectId });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      const baseName = input.name?.trim() || DEFAULT_THREAD_NAME;
      const name = await getUniqueThreadName(
        input.projectId,
        baseName,
        ctx.prisma
      );

      const thread = await ctx.prisma.chatThread.create({
        data: {
          projectId: input.projectId,
          name,
          lastChattedAt: new Date(),
        },
      });

      const seedMessage = input.seedMessage?.trim();
      if (seedMessage) {
        const role = input.seedMessageRole ?? "SYSTEM";
        const createdMessage = await ctx.prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role,
            content: seedMessage,
            ...resolveTokenCount(seedMessage),
          },
        });

        await ctx.prisma.chatThread.update({
          where: { id: thread.id },
          data: {
            lastChattedAt: createdMessage.createdAt,
          },
        });
      }

      logger.info("Chat thread created", {
        threadId: thread.id,
        durationMs: Date.now() - start,
      });

      return thread;
    }),

  archiveThread: publicProcedure
    .input(archiveThreadSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Archiving chat thread", {
        projectId: input.projectId,
        threadId: input.threadId,
      });

      const thread = await ctx.prisma.chatThread.findFirst({
        where: {
          id: input.threadId,
          projectId: input.projectId,
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found",
        });
      }

      const archivedThread = await ctx.prisma.chatThread.update({
        where: { id: input.threadId },
        data: {
          archivedAt: new Date(),
        },
      });

      logger.info("Chat thread archived", {
        threadId: archivedThread.id,
        durationMs: Date.now() - start,
      });

      return archivedThread;
    }),

  listMessages: publicProcedure
    .input(listMessagesSchema)
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Listing chat messages", {
        projectId: input.projectId,
        hasCursor: !!input.cursor,
      });

      try {
        const project = await ctx.prisma.project.findUnique({
          where: { id: input.projectId },
        });

        if (!project) {
          logger.warn("Project not found", { projectId: input.projectId });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        const thread = await ctx.prisma.chatThread.findFirst({
          where: {
            id: input.threadId,
            projectId: input.projectId,
          },
        });

        if (!thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Thread not found",
          });
        }

        const limit = input.limit ?? 30;
        const take = limit + 1;
        const where: {
          threadId: string;
          OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
        } = { threadId: thread.id };

        if (input.cursor) {
          where.OR = [
            { createdAt: { lt: input.cursor.createdAt } },
            { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
          ];
        }

        const messages = await ctx.prisma.chatMessage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
        });

        const hasMore = messages.length > limit;
        const page = hasMore ? messages.slice(0, limit) : messages;
        const nextCursor = hasMore
          ? {
              id: page[page.length - 1].id,
              createdAt: page[page.length - 1].createdAt,
            }
          : null;

        logger.info("Chat messages listed", {
          threadId: thread.id,
          messageCount: page.length,
          durationMs: Date.now() - start,
        });

        return {
          threadId: thread.id,
          messages: page.reverse(),
          nextCursor,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to list chat messages", {
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  getMessageReasoning: publicProcedure
    .input(getMessageReasoningSchema)
    .query(async ({ ctx, input }) => {
      const message = await ctx.prisma.chatMessage.findFirst({
        where: {
          id: input.messageId,
          thread: {
            projectId: input.projectId,
          },
        },
        select: { id: true },
      });

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      return ctx.prisma.chatMessageReasoning.findUnique({
        where: { messageId: input.messageId },
      });
    }),

  listModels: publicProcedure.query(() => {
    const models = modelRegistry
      .listMetadata()
      .filter((model) => model.modes.includes("text"))
      .map((model) => ({
        key: model.key,
        label: model.label,
        provider: model.providerId,
        costTier: model.costTier ?? null,
        description: model.description ?? null,
        supportsStreaming: model.supportsStreaming ?? false,
        supportsReasoning: model.supportsReasoning ?? false,
      }));

    return models;
  }),

  setThreadModel: publicProcedure
    .input(setThreadModelSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Setting chat thread model", {
        projectId: input.projectId,
        modelKey: input.modelKey,
      });

      if (input.modelKey) {
        const modelMetadata = modelRegistry.getMetadata(input.modelKey as ModelKey);

        if (!modelMetadata || !modelMetadata.modes.includes("text")) {
          logger.warn("Invalid chat model selection", {
            projectId: input.projectId,
            modelKey: input.modelKey,
          });
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selected model is not available",
          });
        }
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        logger.warn("Project not found for model update", {
          projectId: input.projectId,
        });
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      let thread = input.threadId
        ? await ctx.prisma.chatThread.findFirst({
            where: {
              id: input.threadId,
              projectId: input.projectId,
            },
          })
        : await ctx.prisma.chatThread.findFirst({
            where: {
              projectId: input.projectId,
              archivedAt: null,
            },
            orderBy: THREAD_ORDER,
          });

      if (input.threadId && !thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found",
        });
      }

      if (!thread) {
        const name = await getUniqueThreadName(
          input.projectId,
          DEFAULT_THREAD_NAME,
          ctx.prisma
        );
        thread = await ctx.prisma.chatThread.create({
          data: {
            projectId: input.projectId,
            name,
            modelKey: input.modelKey,
            reasoningEnabled: false,
          },
        });
      } else {
        thread = await ctx.prisma.chatThread.update({
          where: { id: thread.id },
          data: {
            modelKey: input.modelKey,
            reasoningEnabled: false,
          },
        });
      }

      logger.info("Chat thread model updated", {
        threadId: thread.id,
        modelKey: thread.modelKey,
        durationMs: Date.now() - start,
      });

      return thread;
    }),

  setThreadReasoning: publicProcedure
    .input(setThreadReasoningSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Setting chat thread reasoning", {
        projectId: input.projectId,
        threadId: input.threadId,
        reasoningEnabled: input.reasoningEnabled,
      });

      const thread = await ctx.prisma.chatThread.findFirst({
        where: {
          id: input.threadId,
          projectId: input.projectId,
        },
      });

      if (!thread) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Thread not found",
        });
      }

      const updatedThread = await ctx.prisma.chatThread.update({
        where: { id: thread.id },
        data: {
          reasoningEnabled: input.reasoningEnabled,
        },
      });

      logger.info("Chat thread reasoning updated", {
        threadId: updatedThread.id,
        reasoningEnabled: updatedThread.reasoningEnabled,
        durationMs: Date.now() - start,
      });

      return updatedThread;
    }),

  sendMessage: publicProcedure
    .input(sendMessageSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Sending chat message", {
        projectId: input.projectId,
        contentLength: input.content.length,
      });

      try {
        // Get project with details
        const project = await ctx.prisma.project.findUnique({
          where: { id: input.projectId },
        });

        if (!project) {
          logger.warn("Project not found", { projectId: input.projectId });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        // Get or create thread
        let thread = input.threadId
          ? await ctx.prisma.chatThread.findFirst({
              where: {
                id: input.threadId,
                projectId: input.projectId,
              },
              include: {
                messages: {
                  orderBy: { createdAt: "asc" },
                },
              },
            })
          : await ctx.prisma.chatThread.findFirst({
              where: {
                projectId: input.projectId,
                archivedAt: null,
              },
              orderBy: THREAD_ORDER,
              include: {
                messages: {
                  orderBy: { createdAt: "asc" },
                },
              },
            });

        if (input.threadId && !thread) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Thread not found",
          });
        }

        if (!thread) {
          const name = await getUniqueThreadName(
            input.projectId,
            DEFAULT_THREAD_NAME,
            ctx.prisma
          );
          thread = await ctx.prisma.chatThread.create({
            data: {
              projectId: input.projectId,
              name,
            },
            include: {
              messages: {
                orderBy: { createdAt: "asc" },
              },
            },
          });
        }

        const shouldGenerateTitle =
          thread.messages.length === 0 && isPlaceholderThreadName(thread.name);

        // Save user message
        const userMessage = await ctx.prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: "USER",
            content: input.content,
            ...resolveTokenCount(input.content),
          },
        });

        logger.info("User message saved", { messageId: userMessage.id });

        await ctx.prisma.chatThread.update({
          where: { id: thread.id },
          data: {
            lastChattedAt: userMessage.createdAt,
          },
        });

        if (shouldGenerateTitle) {
          queueThreadTitleGeneration({
            threadId: thread.id,
            projectId: input.projectId,
            firstMessage: input.content,
            currentName: thread.name,
            client: ctx.prisma,
          });
        }

        // Check for Task Approval Flow
        const lastMessage = thread.messages[thread.messages.length - 1];
        if (
          lastMessage &&
          lastMessage.role === "ASSISTANT" &&
          isApproval(input.content)
        ) {
          const tasks = extractTasksFromMessage(lastMessage.content);
          if (tasks) {
            logger.info("Detected task approval", { count: tasks.length });
            try {
              const validation = createManyTaskSchema.safeParse({
                projectId: input.projectId,
                tasks: tasks,
              });

              if (validation.success) {
                const createdTasks: Array<{ id: string; title: string; description: string | null; status: TaskStatus; priority: Priority; createdAt: Date }> = [];

                await ctx.prisma.$transaction(async (tx) => {
                  const tasksByStatus: Record<TaskStatus, typeof validation.data.tasks> = {
                    BACKLOG: [],
                    TODO: [],
                    IN_PROGRESS: [],
                    DONE: [],
                    ARCHIVED: [],
                  };

                  validation.data.tasks.forEach((task) => {
                    const status = task.status ?? "BACKLOG";
                    tasksByStatus[status].push(task);
                  });

                  const statusEntries = Object.entries(tasksByStatus) as [
                    TaskStatus,
                    typeof validation.data.tasks,
                  ][];

                  for (const [status, tasks] of statusEntries) {
                    const maxOrder = await tx.task.aggregate({
                      where: { projectId: input.projectId, status },
                      _max: { sortOrder: true },
                    });

                    let currentSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

                    for (const task of tasks) {
                      const created = await tx.task.create({
                        data: {
                          projectId: input.projectId,
                          title: task.title,
                          description: task.description,
                          status,
                          priority: task.priority ?? "MEDIUM",
                          dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
                          sortOrder: currentSortOrder++,
                        },
                      });
                      createdTasks.push(created);
                    }
                  }
                });

                // Update the assistant message with taskResolution
                const taskResolution = {
                  created: createdTasks.map((t) => ({
                    id: t.id,
                    title: t.title,
                    description: t.description ?? undefined,
                    status: t.status,
                    priority: t.priority,
                    createdAt: t.createdAt.toISOString(),
                  })),
                };

                await ctx.prisma.chatMessage.update({
                  where: { id: lastMessage.id },
                  data: {
                    taskResolution: taskResolution,
                  },
                });

                // Add System Message to confirm creation
                const systemContent = `Tasks created successfully: ${createdTasks
                  .map((t) => t.title)
                  .join(", ")}`;
                const systemMsg = await ctx.prisma.chatMessage.create({
                  data: {
                    threadId: thread.id,
                    role: "SYSTEM", // Using SYSTEM role to denote system action
                    content: systemContent,
                    ...resolveTokenCount(systemContent),
                  },
                });

                await ctx.prisma.chatThread.update({
                  where: { id: thread.id },
                  data: {
                    lastChattedAt: systemMsg.createdAt,
                  },
                });

                // Add to our local messages list so AI sees it (or we can return early if we want to skip AI response)
                thread.messages.push(systemMsg);

                logger.info("Created tasks from approval", { count: createdTasks.length });

                // Skip AI generation if this was an approval action
                // Return updated thread immediately
                const updatedThread = await ctx.prisma.chatThread.findUnique({
                  where: { id: thread.id },
                  include: {
                    messages: {
                      orderBy: { createdAt: "asc" },
                    },
                  },
                });
                return updatedThread!;
              }
            } catch (e) {
              logger.error("Failed to create tasks from approval", {
                error: e instanceof Error ? e.message : String(e),
              });

              // Update the assistant message with error
              try {
                const errorResolution = {
                  error: e instanceof Error ? e.message : "Failed to create tasks",
                };

                await ctx.prisma.chatMessage.update({
                  where: { id: lastMessage.id },
                  data: {
                    taskResolution: errorResolution,
                  },
                });
              } catch (updateError) {
                logger.error("Failed to update message with error", { updateError });
              }
              // Continue to AI response (AI might ask what went wrong if we added a failure message, but for now we just log)
            }
          }
        }

        // Get all messages including the new one
        const allMessages = [
          ...thread.messages,
          userMessage,
        ];

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

          // Call summarization model
          const summaryPrompt = buildSummarizationPrompt(oldMessages);
          const summaryModel = getModelFor("project_chat_summary");

          logger.debug("Calling summarization model", {
            oldMessageCount: oldMessages.length,
          });

          const summaryStartAt = new Date();
          let summaryResult: Awaited<ReturnType<typeof summaryModel.call>> | undefined;

          try {
            summaryResult = await summaryModel.call({
              prompt: summaryPrompt,
              mode: "text",
            });
            const summaryEndAt = new Date();
            await recordAiCall({
              prisma: ctx.prisma,
              context: {
                projectId: project.id,
                threadId: thread.id,
                source: "summarization",
                actionType: "thread.summarize",
              },
              prompt: summaryPrompt,
              outputText: summaryResult.text,
              usage: summaryResult.usage,
              telemetry: summaryResult.telemetry,
              timing: {
                requestStartAt: summaryStartAt,
                responseEndAt: summaryEndAt,
              },
              status: "SUCCESS",
            });
          } catch (error) {
            const summaryEndAt = new Date();
            await recordAiCall({
              prisma: ctx.prisma,
              context: {
                projectId: project.id,
                threadId: thread.id,
                source: "summarization",
                actionType: "thread.summarize",
              },
              prompt: summaryPrompt,
              outputText: null,
              usage: undefined,
              telemetry: getTelemetryFromError(error),
              timing: {
                requestStartAt: summaryStartAt,
                responseEndAt: summaryEndAt,
              },
              status: resolveAiStatus(error),
            });
            throw error;
          }

          // Update thread with summary
          const oldestSummarizedDate = oldMessages[oldMessages.length - 1]?.createdAt;
          thread = await ctx.prisma.chatThread.update({
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
        const systemContextArtifact = await ctx.prisma.artifact.findFirst({
          where: {
            projectId: project.id,
            title: {
              equals: SYSTEM_CONTEXT_ARTIFACT_TITLE,
              mode: "insensitive",
            },
          },
          select: { content: true },
        });
        const systemPrompt = buildSystemPrompt(
          project,
          systemContextArtifact?.content ?? null
        );
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

        logger.debug("Calling AI model", {
          promptLength: fullPrompt.length,
          messageCount: messagesForAI.length,
          hasSummary: !!thread.summary,
        });

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
        const reasoningEnabled = Boolean(
          thread.reasoningEnabled && modelMetadata?.supportsReasoning
        );

        // Call AI model
        const chatModel = getModelFor("project_chat", overrideKey);
        const callStartAt = new Date();
        let aiResult!: Awaited<ReturnType<typeof chatModel.call>>;
        try {
          aiResult = await chatModel.call({
            prompt: fullPrompt,
            mode: "text",
            ...(reasoningEnabled ? { reasoning: { effort: "medium" } } : {}),
          });
          const callEndAt = new Date();
          await recordAiCall({
            prisma: ctx.prisma,
            context: {
              projectId: project.id,
              threadId: thread.id,
              source: "chat",
              actionType: "chat.reply",
            },
            prompt: fullPrompt,
            outputText: aiResult.text,
            usage: aiResult.usage,
            telemetry: aiResult.telemetry,
            timing: {
              requestStartAt: callStartAt,
              responseEndAt: callEndAt,
            },
            status: "SUCCESS",
          });
        } catch (error) {
          const callEndAt = new Date();
          await recordAiCall({
            prisma: ctx.prisma,
            context: {
              projectId: project.id,
              threadId: thread.id,
              source: "chat",
              actionType: "chat.reply",
            },
            prompt: fullPrompt,
            outputText: null,
            usage: undefined,
            telemetry: getTelemetryFromError(error),
            timing: {
              requestStartAt: callStartAt,
              responseEndAt: callEndAt,
            },
            status: resolveAiStatus(error),
          });
          throw error;
        }

        // Save assistant message
        const assistantMessage = await ctx.prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: "ASSISTANT",
            content: aiResult.text,
            ...resolveTokenCount(aiResult.text, aiResult.usage?.outputTokens),
            ...assistantModelData,
          },
        });

        if (aiResult.reasoningText?.trim()) {
          await ctx.prisma.chatMessageReasoning.create({
            data: {
              messageId: assistantMessage.id,
              content: aiResult.reasoningText.trim(),
              ...resolveReasoningTokenCount(
                aiResult.reasoningText,
                aiResult.usage?.reasoningTokens
              ),
            },
          });
        }

        await ctx.prisma.chatThread.update({
          where: { id: thread.id },
          data: {
            lastChattedAt: assistantMessage.createdAt,
          },
        });

        logger.info("Chat message completed", {
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          durationMs: Date.now() - start,
        });

        // Return updated thread
        const updatedThread = await ctx.prisma.chatThread.findUnique({
          where: { id: thread.id },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        return updatedThread!;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to send chat message", {
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  createTaskFromChat: publicProcedure
    .input(
      z.object({
        messageId: z.string().cuid(),
        task: createTaskSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating task from chat", {
        messageId: input.messageId,
        projectId: input.task.projectId,
      });

      try {
        // Get the message to verify it exists
        const message = await ctx.prisma.chatMessage.findUnique({
          where: { id: input.messageId },
        });

        if (!message) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Message not found",
          });
        }

        const status = input.task.status ?? "BACKLOG";
        const maxOrder = await ctx.prisma.task.aggregate({
          where: { projectId: input.task.projectId, status },
          _max: { sortOrder: true },
        });

        const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

        const createdTask = await ctx.prisma.task.create({
          data: {
            projectId: input.task.projectId,
            title: input.task.title,
            description: input.task.description,
            status,
            priority: input.task.priority ?? "MEDIUM",
            dueDate: input.task.dueDate ? new Date(input.task.dueDate) : undefined,
            sortOrder,
          },
        });

        // Update message with taskResolution
        const existingResolution = message.taskResolution as {
          created?: Array<{
            id: string;
            title: string;
            description?: string;
            status: TaskStatus;
            priority?: string;
            createdAt: string;
          }>
        } | null;
        const existingCreated = existingResolution?.created ?? [];

        const newTaskResolution = {
          created: [
            ...existingCreated,
            {
              id: createdTask.id,
              title: createdTask.title,
              description: createdTask.description ?? undefined,
              status: createdTask.status,
              priority: createdTask.priority,
              createdAt: createdTask.createdAt.toISOString(),
            },
          ],
        };

        await ctx.prisma.chatMessage.update({
          where: { id: input.messageId },
          data: {
            taskResolution: newTaskResolution,
          },
        });

        logger.info("Task created from chat", {
          taskId: createdTask.id,
          messageId: input.messageId,
          durationMs: Date.now() - start,
        });

        return createdTask;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to create task from chat", {
          messageId: input.messageId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  createTasksFromChat: publicProcedure
    .input(
      z.object({
        messageId: z.string().cuid(),
        tasks: createManyTaskSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating multiple tasks from chat", {
        messageId: input.messageId,
        projectId: input.tasks.projectId,
        count: input.tasks.tasks.length,
      });

      try {
        // Get the message to verify it exists
        const message = await ctx.prisma.chatMessage.findUnique({
          where: { id: input.messageId },
        });

        if (!message) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Message not found",
          });
        }

        const createdTasks: Array<{ id: string; title: string; description: string | null; status: TaskStatus; priority: Priority; createdAt: Date }> = [];

        await ctx.prisma.$transaction(async (tx) => {
          const tasksByStatus: Record<TaskStatus, typeof input.tasks.tasks> = {
            BACKLOG: [],
            TODO: [],
            IN_PROGRESS: [],
            DONE: [],
            ARCHIVED: [],
          };

          input.tasks.tasks.forEach((task) => {
            const status = task.status ?? "BACKLOG";
            tasksByStatus[status].push(task);
          });

          const statusEntries = Object.entries(tasksByStatus) as [
            TaskStatus,
            typeof input.tasks.tasks,
          ][];

          for (const [status, tasks] of statusEntries) {
            const maxOrder = await tx.task.aggregate({
              where: { projectId: input.tasks.projectId, status },
              _max: { sortOrder: true },
            });

            let currentSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

            for (const task of tasks) {
              const created = await tx.task.create({
                data: {
                  projectId: input.tasks.projectId,
                  title: task.title,
                  description: task.description,
                  status,
                  priority: task.priority ?? "MEDIUM",
                  dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
                  sortOrder: currentSortOrder++,
                },
              });
              createdTasks.push(created);
            }
          }
        });

        // Update message with taskResolution
        const newTaskResolution = {
          created: createdTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description ?? undefined,
            status: t.status,
            priority: t.priority,
            createdAt: t.createdAt.toISOString(),
          })),
        };

        await ctx.prisma.chatMessage.update({
          where: { id: input.messageId },
          data: {
            taskResolution: newTaskResolution,
          },
        });

        logger.info("Tasks created from chat", {
          messageId: input.messageId,
          count: createdTasks.length,
          durationMs: Date.now() - start,
        });

        return createdTasks;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to create tasks from chat", {
          messageId: input.messageId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),
});
