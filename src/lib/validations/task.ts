import { z } from "zod";
import { priorityEnum } from "./project";

export const taskStatusEnum = z.enum([
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "WAITING",
  "DONE",
]);

export const createTaskSchema = z.object({
  projectId: z.string().cuid(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: taskStatusEnum.default("BACKLOG"),
  priority: priorityEnum.default("MEDIUM"),
  dueDate: z.string().datetime().optional().nullable(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.string().cuid(),
});

export const listTasksSchema = z.object({
  projectId: z.string().cuid(),
  search: z.string().optional(),
  priority: priorityEnum.optional(),
});

export const moveTaskSchema = z.object({
  id: z.string().cuid(),
  projectId: z.string().cuid(),
  status: taskStatusEnum,
  position: z.number().int().min(0),
});
