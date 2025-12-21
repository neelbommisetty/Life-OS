import { TRPCError } from "@trpc/server";
import type { TaskStatus, Priority } from "@prisma/client";
import { z } from "zod";
import {
  getThreadSchema,
  listMessagesSchema,
  sendMessageSchema,
  setThreadModelSchema,
} from "@/lib/validations/chat";
import { createTaskSchema, createManyTaskSchema } from "@/lib/validations/task";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/logger";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
  extractTasksFromMessage,
  isApproval,
} from "@/lib/chat-utils";
import "@/lib/ai/init";
import { modelRegistry } from "@/lib/ai";
import { getModelFor } from "@/lib/ai/providers/router";
import { initializeChatServices } from "@/lib/ai/chat-services";
import type { ModelKey } from "@/lib/ai";

const logger = createLogger("trpc:chat");

// Initialize chat AI services
initializeChatServices();

// Token cap before triggering summarization (~6k tokens)
const HISTORY_TOKEN_CAP = 6000;

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

        // Get or create default thread
        let thread = await ctx.prisma.chatThread.findFirst({
          where: {
            projectId: input.projectId,
            name: "Default",
          },
        });

        if (!thread) {
          logger.info("Creating default chat thread", {
            projectId: input.projectId,
          });
          thread = await ctx.prisma.chatThread.create({
            data: {
              projectId: input.projectId,
              name: "Default",
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

        let thread = await ctx.prisma.chatThread.findFirst({
          where: {
            projectId: input.projectId,
            name: "Default",
          },
        });

        if (!thread) {
          logger.info("Creating default chat thread for pagination", {
            projectId: input.projectId,
          });
          thread = await ctx.prisma.chatThread.create({
            data: {
              projectId: input.projectId,
              name: "Default",
            },
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

      let thread = await ctx.prisma.chatThread.findFirst({
        where: {
          projectId: input.projectId,
          name: "Default",
        },
      });

      if (!thread) {
        thread = await ctx.prisma.chatThread.create({
          data: {
            projectId: input.projectId,
            name: "Default",
            modelKey: input.modelKey,
          },
        });
      } else {
        thread = await ctx.prisma.chatThread.update({
          where: { id: thread.id },
          data: {
            modelKey: input.modelKey,
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
        let thread = await ctx.prisma.chatThread.findFirst({
          where: {
            projectId: input.projectId,
            name: "Default",
          },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        if (!thread) {
          thread = await ctx.prisma.chatThread.create({
            data: {
              projectId: input.projectId,
              name: "Default",
            },
            include: {
              messages: {
                orderBy: { createdAt: "asc" },
              },
            },
          });
        }

        // Save user message
        const userMessage = await ctx.prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: "USER",
            content: input.content,
          },
        });

        logger.info("User message saved", { messageId: userMessage.id });

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
                const systemMsg = await ctx.prisma.chatMessage.create({
                  data: {
                    threadId: thread.id,
                    role: "SYSTEM", // Using SYSTEM role to denote system action
                    content: `Tasks created successfully: ${createdTasks.map((t) => t.title).join(", ")}`,
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

          const summaryResult = await summaryModel.call({
            prompt: summaryPrompt,
            mode: "text",
          });

          // Update thread with summary
          const oldestSummarizedDate = oldMessages[oldMessages.length - 1]?.createdAt;
          thread = await ctx.prisma.chatThread.update({
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

        // Call AI model
        const chatModel = getModelFor("project_chat", overrideKey);
        const aiResult = await chatModel.call({
          prompt: fullPrompt,
          mode: "text",
        });

        // Save assistant message
        const assistantMessage = await ctx.prisma.chatMessage.create({
          data: {
            threadId: thread.id,
            role: "ASSISTANT",
            content: aiResult.text,
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
