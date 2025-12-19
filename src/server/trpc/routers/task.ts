import { TRPCError } from "@trpc/server";
import {
  createTaskSchema,
  createManyTaskSchema,
  listTasksSchema,
  moveTaskSchema,
  updateTaskSchema,
} from "@/lib/validations/task";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/ai/logger";

const logger = createLogger("trpc:task");

const coerceDate = (value?: string | null) => {
  if (value === null) return null;
  return value ? new Date(value) : undefined;
};

export const taskRouter = router({
  list: publicProcedure.input(listTasksSchema).query(async ({ ctx, input }) => {
    const start = Date.now();
    logger.debug("Listing tasks", {
      projectId: input.projectId,
      priority: input.priority,
      hasSearch: !!input.search,
    });

    try {
      if (!ctx?.prisma) {
        logger.error("Prisma client is missing from context", {
          hasCtx: !!ctx,
          ctxKeys: ctx ? Object.keys(ctx) : [],
        });
        throw new Error("Database client is not available");
      }

      if (!ctx.prisma.task) {
        logger.error("Prisma task model is missing", {
          prismaKeys: Object.keys(ctx.prisma),
        });
        throw new Error("Database task model is not available");
      }

      const result = await ctx.prisma.task.findMany({
        where: {
          projectId: input.projectId,
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.search
            ? {
                OR: [
                  { title: { contains: input.search, mode: "insensitive" } },
                  {
                    description: {
                      contains: input.search,
                      mode: "insensitive",
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
      });

      logger.info("Tasks listed successfully", {
        projectId: input.projectId,
        count: result.length,
        durationMs: Date.now() - start,
      });

      return result;
    } catch (error) {
      logger.error("Failed to list tasks", {
        projectId: input.projectId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }),

  create: publicProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating task", {
        projectId: input.projectId,
        title: input.title,
        status: input.status ?? "BACKLOG",
        priority: input.priority ?? "MEDIUM",
      });

      try {
        const status = input.status ?? "BACKLOG";
        const maxOrder = await ctx.prisma.task.aggregate({
          where: { projectId: input.projectId, status },
          _max: { sortOrder: true },
        });

        const sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

        const result = await ctx.prisma.task.create({
          data: {
            projectId: input.projectId,
            title: input.title,
            description: input.description,
            status,
            priority: input.priority ?? "MEDIUM",
            dueDate: coerceDate(input.dueDate),
            sortOrder,
          },
        });

        logger.info("Task created successfully", {
          taskId: result.id,
          projectId: input.projectId,
          title: input.title,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        logger.error("Failed to create task", {
          projectId: input.projectId,
          title: input.title,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  createMany: publicProcedure
    .input(createManyTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating multiple tasks", {
        projectId: input.projectId,
        count: input.tasks.length,
      });

      try {
        const results = [];
        // Process sequentially to handle sort order correctly per status
        // A transaction would be better but sortOrder logic is complex per status
        // For now, simple loop inside transaction is safer if we want to guarantee order

        // Let's group by status to optimize sort order fetching
        const tasksByStatus = input.tasks.reduce((acc, task) => {
          const status = task.status ?? "BACKLOG";
          if (!acc[status]) acc[status] = [];
          acc[status].push(task);
          return acc;
        }, {} as Record<string, typeof input.tasks>);

        await ctx.prisma.$transaction(async (tx) => {
          for (const [status, tasks] of Object.entries(tasksByStatus)) {
            // Get current max order for this status
            const maxOrder = await tx.task.aggregate({
              where: { projectId: input.projectId, status: status as any },
              _max: { sortOrder: true },
            });

            let currentSortOrder = (maxOrder._max.sortOrder ?? 0) + 1;

            for (const task of tasks) {
              const created = await tx.task.create({
                data: {
                  projectId: input.projectId,
                  title: task.title,
                  description: task.description,
                  status: status as any,
                  priority: task.priority ?? "MEDIUM",
                  dueDate: coerceDate(task.dueDate),
                  sortOrder: currentSortOrder++,
                },
              });
              results.push(created);
            }
          }
        });

        logger.info("Tasks created successfully", {
          projectId: input.projectId,
          count: results.length,
          durationMs: Date.now() - start,
        });

        return results;
      } catch (error) {
        logger.error("Failed to create multiple tasks", {
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  update: publicProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Updating task", {
        taskId: input.id,
        hasStatus: !!input.status,
        hasTitle: !!input.title,
      });

      try {
        const task = await ctx.prisma.task.findUnique({
          where: { id: input.id },
        });

        if (!task) {
          logger.warn("Task not found for update", { taskId: input.id });
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        const nextStatus = input.status ?? task.status;
        const shouldMoveColumn = nextStatus !== task.status;

        let sortOrder = task.sortOrder;
        const nextDueDate = coerceDate(input.dueDate);

        if (shouldMoveColumn) {
          const maxOrder = await ctx.prisma.task.aggregate({
            where: { projectId: task.projectId, status: nextStatus },
            _max: { sortOrder: true },
          });

          sortOrder = (maxOrder._max.sortOrder ?? 0) + 1;
        }

        const result = await ctx.prisma.task.update({
          where: { id: input.id },
          data: {
            title: input.title ?? task.title,
            description: input.description ?? task.description,
            status: nextStatus,
            priority: input.priority ?? task.priority,
            dueDate: nextDueDate !== undefined ? nextDueDate : task.dueDate,
            sortOrder,
          },
        });

        logger.info("Task updated successfully", {
          taskId: input.id,
          projectId: task.projectId,
          statusChanged: shouldMoveColumn,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to update task", {
          taskId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  move: publicProcedure
    .input(moveTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Moving task", {
        taskId: input.id,
        projectId: input.projectId,
        newStatus: input.status,
        position: input.position,
      });

      try {
        const task = await ctx.prisma.task.findUnique({
          where: { id: input.id },
        });

        if (!task) {
          logger.warn("Task not found for move", { taskId: input.id });
          throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
        }

        if (task.projectId !== input.projectId) {
          logger.warn("Task does not belong to project", {
            taskId: input.id,
            taskProjectId: task.projectId,
            inputProjectId: input.projectId,
          });
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Task does not belong to project",
          });
        }

        const targetIndex = Math.max(input.position, 0);
        const statusChanged = task.status !== input.status;

        if (task.status === input.status) {
          const current = await ctx.prisma.task.findMany({
            where: { projectId: input.projectId, status: task.status },
            orderBy: { sortOrder: "asc" },
            select: { id: true },
          });

          const withoutActive = current.filter((item) => item.id !== input.id);
          withoutActive.splice(Math.min(targetIndex, withoutActive.length), 0, {
            id: input.id,
          });

          await ctx.prisma.$transaction(
            withoutActive.map((item, index) =>
              ctx.prisma.task.update({
                where: { id: item.id },
                data: { sortOrder: index + 1 },
              })
            )
          );
        } else {
          const source = await ctx.prisma.task.findMany({
            where: {
              projectId: input.projectId,
              status: task.status,
              NOT: { id: input.id },
            },
            orderBy: { sortOrder: "asc" },
            select: { id: true },
          });

          const target = await ctx.prisma.task.findMany({
            where: {
              projectId: input.projectId,
              status: input.status,
              NOT: { id: input.id },
            },
            orderBy: { sortOrder: "asc" },
            select: { id: true },
          });

          target.splice(Math.min(targetIndex, target.length), 0, {
            id: input.id,
          });

          await ctx.prisma.$transaction([
            ...source.map((item, index) =>
              ctx.prisma.task.update({
                where: { id: item.id },
                data: { sortOrder: index + 1 },
              })
            ),
            ...target.map((item, index) =>
              ctx.prisma.task.update({
                where: { id: item.id },
                data: { status: input.status, sortOrder: index + 1 },
              })
            ),
          ]);
        }

        const result = await ctx.prisma.task.findMany({
          where: { projectId: input.projectId },
          orderBy: [{ status: "asc" }, { sortOrder: "asc" }],
        });

        logger.info("Task moved successfully", {
          taskId: input.id,
          projectId: input.projectId,
          statusChanged,
          fromStatus: task.status,
          toStatus: input.status,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to move task", {
          taskId: input.id,
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  delete: publicProcedure
    .input(updateTaskSchema.pick({ id: true }))
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Deleting task", { taskId: input.id });

      try {
        await ctx.prisma.task.delete({ where: { id: input.id } });

        logger.info("Task deleted successfully", {
          taskId: input.id,
          durationMs: Date.now() - start,
        });

        return { success: true };
      } catch (error) {
        logger.error("Failed to delete task", {
          taskId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),
});
