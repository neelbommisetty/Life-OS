import { z } from "zod";

export const listProjectsSchema = z.object({
  search: z.string().optional(),
  includeArchived: z.boolean().optional().default(false),
});

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional(),
  aiInstructions: z.string().max(5000).optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().cuid(),
});

export const deleteProjectSchema = z.object({
  id: z.string().cuid(),
});

export const getProjectByIdSchema = z.object({
  id: z.string().cuid(),
});

export const archiveProjectSchema = z.object({
  id: z.string().cuid(),
});

export const unarchiveProjectSchema = z.object({
  id: z.string().cuid(),
});

export type ListProjectsInput = z.infer<typeof listProjectsSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;
export type GetProjectByIdInput = z.infer<typeof getProjectByIdSchema>;
export type ArchiveProjectInput = z.infer<typeof archiveProjectSchema>;
export type UnarchiveProjectInput = z.infer<typeof unarchiveProjectSchema>;
