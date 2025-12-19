import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProjectSchema,
  listProjectsSchema,
  updateProjectSchema,
  updateStatusSchema,
} from "@/lib/validations/project";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/ai/logger";

const logger = createLogger("trpc:project");

const coerceDate = (value?: string | null) =>
  value ? new Date(value) : undefined;

export const projectRouter = router({
  list: publicProcedure
    .input(listProjectsSchema.optional())
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Listing projects", { status: input?.status });

      try {
        const result = await ctx.prisma.project.findMany({
          where: {
            status: input?.status,
          },
          orderBy: { updatedAt: "desc" },
        });

        logger.info("Projects listed successfully", {
          count: result.length,
          status: input?.status,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        logger.error("Failed to list projects", {
          status: input?.status,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Getting project by id", { projectId: input.id });

      try {
        const project = await ctx.prisma.project.findUnique({
          where: { id: input.id },
          include: {
            statusHistory: {
              orderBy: { timestamp: "asc" },
            },
          },
        });

        if (!project) {
          logger.warn("Project not found", { projectId: input.id });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        logger.info("Project retrieved successfully", {
          projectId: input.id,
          name: project.name,
          statusHistoryCount: project.statusHistory.length,
          durationMs: Date.now() - start,
        });

        return project;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to get project", {
          projectId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  create: publicProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Creating project", {
        name: input.name,
        status: input.status,
        priority: input.priority,
        tagsCount: input.tags?.length ?? 0,
      });

      try {
        const result = await ctx.prisma.project.create({
          data: {
            name: input.name,
            description: input.description,
            status: input.status,
            priority: input.priority ?? undefined,
            tags: input.tags ?? [],
            color: input.color,
            icon: input.icon,
            dueDate: coerceDate(input.dueDate),
            statusHistory: {
              create: {
                status: input.status,
              },
            },
          },
        });

        logger.info("Project created successfully", {
          projectId: result.id,
          name: input.name,
          status: input.status,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        logger.error("Failed to create project", {
          name: input.name,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  update: publicProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const { id, ...data } = input;
      logger.debug("Updating project", {
        projectId: id,
        hasName: !!data.name,
        hasStatus: !!data.status,
        hasTags: !!data.tags,
      });

      try {
        const result = await ctx.prisma.project.update({
          where: { id },
          data: {
            name: data.name,
            description: data.description,
            status: data.status,
            priority: data.priority ?? undefined,
            tags: data.tags,
            color: data.color,
            icon: data.icon,
            dueDate: coerceDate(data.dueDate),
          },
        });

        logger.info("Project updated successfully", {
          projectId: id,
          name: result.name,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        logger.error("Failed to update project", {
          projectId: id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  updateStatus: publicProcedure
    .input(updateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const { id, status } = input;
      logger.debug("Updating project status", {
        projectId: id,
        newStatus: status,
      });

      try {
        const result = await ctx.prisma.$transaction(async (tx) => {
          const project = await tx.project.update({
            where: { id },
            data: { status },
          });

          await tx.statusHistory.create({
            data: {
              projectId: id,
              status,
            },
          });

          return project;
        });

        logger.info("Project status updated successfully", {
          projectId: id,
          newStatus: status,
          durationMs: Date.now() - start,
        });

        return result;
      } catch (error) {
        logger.error("Failed to update project status", {
          projectId: id,
          newStatus: status,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Deleting project", { projectId: input.id });

      try {
        await ctx.prisma.project.delete({
          where: { id: input.id },
        });

        logger.info("Project deleted successfully", {
          projectId: input.id,
          durationMs: Date.now() - start,
        });

        return { success: true };
      } catch (error) {
        logger.error("Failed to delete project", {
          projectId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),
});
