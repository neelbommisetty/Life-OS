import { z } from "zod";

export const taskStatusEnum = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const listTasksSchema = z.object({
  search: z.string().optional(),
  status: taskStatusEnum.optional(),
});

// Accept date strings (YYYY-MM-DD) or datetime strings (ISO)
const dateStringSchema = z
  .string()
  .refine(
    (val) => {
      if (!val || val === "") return true;
      // Accept YYYY-MM-DD format (from HTML date inputs)
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return true;
      // Accept ISO datetime format
      try {
        const date = new Date(val);
        return !isNaN(date.getTime());
      } catch {
        return false;
      }
    },
    { message: "Invalid date format" }
  )
  .optional()
  .nullable();

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  description: z.string().max(5000).optional(),
  status: taskStatusEnum.default("TODO"),
  priority: priorityEnum.default("MEDIUM"),
  dueDate: dateStringSchema,
  projectId: z.string().cuid().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.string().cuid(),
});

export const deleteTaskSchema = z.object({
  id: z.string().cuid(),
});

export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
