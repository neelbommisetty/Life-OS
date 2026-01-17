import { z } from "zod";

export const artifactTypeEnum = z.enum(["TEXT", "LINK", "FILE"]);

export const createArtifactSchema = z
  .object({
    projectId: z.string().cuid(),
    type: artifactTypeEnum,
    title: z.string().min(1, "Title is required"),
    content: z.string().optional(),
    url: z.string().url().optional(),
    fileKey: z.string().optional(),
    fileName: z.string().optional(),
    fileSize: z.number().int().nonnegative().optional(),
    fileType: z.string().optional(),
    fileUrl: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "TEXT" && !value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Content is required",
      });
    }
    if (value.type === "LINK" && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "URL is required",
      });
    }
    if (value.type === "FILE") {
      if (!value.fileKey || !value.fileUrl || !value.fileName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fileKey"],
          message: "File upload is required",
        });
      }
    }
  });

export const updateArtifactSchema = createArtifactSchema.partial().extend({
  id: z.string().cuid(),
  type: artifactTypeEnum,
});

export const listArtifactsSchema = z.object({
  projectId: z.string().cuid(),
});
