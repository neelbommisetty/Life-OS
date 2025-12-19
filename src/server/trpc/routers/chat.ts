import { TRPCError } from "@trpc/server";
import { getThreadSchema, sendMessageSchema } from "@/lib/validations/chat";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/ai/logger";
import {
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
} from "@/lib/chat-utils";
import "@/lib/ai/init";
import { getModelFor } from "@/lib/ai/providers/router";
import { initializeChatServices } from "@/lib/ai/chat-services";

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
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
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
            include: {
              messages: {
                orderBy: { createdAt: "asc" },
              },
            },
          });
        }

        logger.info("Chat thread retrieved successfully", {
          threadId: thread.id,
          messageCount: thread.messages.length,
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

        // Call AI model
        const chatModel = getModelFor("project_chat");
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
});

