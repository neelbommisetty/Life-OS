import { z } from "zod";

export const projectStatusEnum = z.enum([
  "IDEA",
  "IN_PROGRESS",
  "MVP",
  "COMPLETE",
  "ARCHIVE",
  "DEFER",
  "NOT_INTERESTED",
]);

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: projectStatusEnum.default("IDEA"),
  priority: priorityEnum.default("MEDIUM").optional(),
  tags: z.array(z.string().trim()).default([]),
  color: z.string().regex(/^#([0-9A-F]{3}){1,2}$/i, "Must be a valid hex color code (e.g. #000000)").optional(),
  icon: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().cuid(),
});

export const updateStatusSchema = z.object({
  id: z.string().cuid(),
  status: projectStatusEnum,
});

export const listProjectsSchema = z.object({
  status: projectStatusEnum.optional(),
  search: z.string().optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'name', 'dueDate', 'priority']).default('updatedAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  limit: z.number().min(1).max(100).default(50).optional(),
  cursor: z.string().cuid().optional(),
});

