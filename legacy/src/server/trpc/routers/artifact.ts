import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createArtifactSchema,
  listArtifactsSchema,
  updateArtifactSchema,
} from "@/lib/validations/artifact";
import { publicProcedure, router } from "../trpc";
import { createLogger } from "@/lib/logger";
import { UTApi } from "uploadthing/server";
import {
  SYSTEM_CONTEXT_ARTIFACT_TITLE,
  isSystemContextTitle,
} from "@/lib/system-context";

const logger = createLogger("trpc:artifact");
const utapi = new UTApi();

export const artifactRouter = router({
  list: publicProcedure
    .input(listArtifactsSchema)
    .query(async ({ ctx, input }) => {
      const start = Date.now();
      logger.debug("Listing artifacts", { projectId: input.projectId });

      try {
        const artifacts = await ctx.prisma.artifact.findMany({
          where: { projectId: input.projectId },
          orderBy: { updatedAt: "desc" },
        });

        logger.info("Artifacts listed successfully", {
          projectId: input.projectId,
          count: artifacts.length,
          durationMs: Date.now() - start,
        });

        return artifacts;
      } catch (error) {
        logger.error("Failed to list artifacts", {
          projectId: input.projectId,
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
      logger.debug("Getting artifact by id", { artifactId: input.id });

      try {
        const artifact = await ctx.prisma.artifact.findUnique({
          where: { id: input.id },
        });

        if (!artifact) {
          logger.warn("Artifact not found", { artifactId: input.id });
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Artifact not found",
          });
        }

        logger.info("Artifact retrieved successfully", {
          artifactId: input.id,
          durationMs: Date.now() - start,
        });

        return artifact;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        logger.error("Failed to get artifact", {
          artifactId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  create: publicProcedure
    .input(createArtifactSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const isSystemContext = isSystemContextTitle(input.title);
      logger.debug("Creating artifact", {
        projectId: input.projectId,
        type: input.type,
      });

      try {
        if (isSystemContext) {
          const existing = await ctx.prisma.artifact.findFirst({
            where: {
              projectId: input.projectId,
              title: {
                equals: SYSTEM_CONTEXT_ARTIFACT_TITLE,
                mode: "insensitive",
              },
            },
            select: { id: true },
          });
          if (existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "System context already exists",
            });
          }
          if (input.type !== "TEXT") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "System context must be a text artifact",
            });
          }
        }

        const artifact = await ctx.prisma.artifact.create({
          data: {
            projectId: input.projectId,
            type: input.type,
            title: input.title,
            content: input.content,
            url: input.url,
            fileKey: input.fileKey,
            fileName: input.fileName,
            fileSize: input.fileSize,
            fileType: input.fileType,
            fileUrl: input.fileUrl,
          },
        });

        logger.info("Artifact created successfully", {
          artifactId: artifact.id,
          projectId: input.projectId,
          durationMs: Date.now() - start,
        });

        return artifact;
      } catch (error) {
        logger.error("Failed to create artifact", {
          projectId: input.projectId,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),

  update: publicProcedure
    .input(updateArtifactSchema)
    .mutation(async ({ ctx, input }) => {
      const start = Date.now();
      const { id, ...data } = input;
      logger.debug("Updating artifact", { artifactId: id });

      try {
        const existing = await ctx.prisma.artifact.findUnique({
          where: { id },
        });

        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Artifact not found",
          });
        }

        const nextData = { ...data };
        const isExistingSystemContext = isSystemContextTitle(existing.title);
        const isNextSystemContext = nextData.title
          ? isSystemContextTitle(nextData.title)
          : isExistingSystemContext;

        if (isExistingSystemContext) {
          if (nextData.title && !isSystemContextTitle(nextData.title)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "System context title cannot be changed",
            });
          }
          if (nextData.type && nextData.type !== "TEXT") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "System context must be a text artifact",
            });
          }
          nextData.title = SYSTEM_CONTEXT_ARTIFACT_TITLE;
          nextData.type = "TEXT";
        } else if (isNextSystemContext) {
          const existingSystem = await ctx.prisma.artifact.findFirst({
            where: {
              projectId: existing.projectId,
              title: {
                equals: SYSTEM_CONTEXT_ARTIFACT_TITLE,
                mode: "insensitive",
              },
              NOT: { id },
            },
            select: { id: true },
          });

          if (existingSystem) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "System context already exists",
            });
          }

          if (nextData.type && nextData.type !== "TEXT") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "System context must be a text artifact",
            });
          }

          nextData.title = SYSTEM_CONTEXT_ARTIFACT_TITLE;
          nextData.type = "TEXT";
        }

        const updated = await ctx.prisma.artifact.update({
          where: { id },
          data: {
            type: nextData.type,
            title: nextData.title,
            content: nextData.content,
            url: nextData.url,
            fileKey: nextData.fileKey,
            fileName: nextData.fileName,
            fileSize: nextData.fileSize,
            fileType: nextData.fileType,
            fileUrl: nextData.fileUrl,
          },
        });

        logger.info("Artifact updated successfully", {
          artifactId: id,
          durationMs: Date.now() - start,
        });

        return updated;
      } catch (error) {
        logger.error("Failed to update artifact", {
          artifactId: id,
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
      logger.debug("Deleting artifact", { artifactId: input.id });

      try {
        const artifact = await ctx.prisma.artifact.findUnique({
          where: { id: input.id },
        });

        if (!artifact) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Artifact not found",
          });
        }

        if (isSystemContextTitle(artifact.title)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "System context cannot be deleted",
          });
        }

        if (artifact.fileKey) {
          try {
            await utapi.deleteFiles([artifact.fileKey]);
          } catch (error) {
            logger.warn("Failed to delete artifact file", {
              artifactId: input.id,
              fileKey: artifact.fileKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        await ctx.prisma.artifact.delete({
          where: { id: input.id },
        });

        logger.info("Artifact deleted successfully", {
          artifactId: input.id,
          durationMs: Date.now() - start,
        });

        return { success: true };
      } catch (error) {
        logger.error("Failed to delete artifact", {
          artifactId: input.id,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        });
        throw error;
      }
    }),
});
