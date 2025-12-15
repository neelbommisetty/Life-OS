import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProjectSchema,
  listProjectsSchema,
  updateProjectSchema,
  updateStatusSchema,
} from "@/lib/validations/project";
import { publicProcedure, router } from "../trpc";

const coerceDate = (value?: string | null) =>
  value ? new Date(value) : undefined;

export const projectRouter = router({
  list: publicProcedure
    .input(listProjectsSchema.optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.project.findMany({
        where: {
          status: input?.status,
        },
        orderBy: { updatedAt: "desc" },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.id },
        include: {
          statusHistory: {
            orderBy: { timestamp: "asc" },
          },
        },
      });

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      return project;
    }),

  create: publicProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.project.create({
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
    }),

  update: publicProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      return ctx.prisma.project.update({
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
    }),

  updateStatus: publicProcedure
    .input(updateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, status } = input;

      return ctx.prisma.$transaction(async (tx) => {
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
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.project.delete({
        where: { id: input.id },
      });
      return { success: true };
    }),
});

