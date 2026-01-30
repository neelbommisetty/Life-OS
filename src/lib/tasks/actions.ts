"use server";

import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import { createLogger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import {
  listTasksSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  type ListTasksInput,
  type CreateTaskInput,
  type UpdateTaskInput,
  type DeleteTaskInput,
} from "./validations";

const logger = createLogger("tasks:actions");

const TASK_ORDER: Prisma.TaskOrderByWithRelationInput[] = [
  { status: "asc" },
  { updatedAt: "desc" },
];

/**
 * Get the current authenticated user ID
 */
async function getCurrentUserId(): Promise<string> {
  const { data: session } = await authServer.getSession();

  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  return session.user.id;
}

/**
 * Coerce date string to Date or return undefined
 * Handles both YYYY-MM-DD (from HTML date inputs) and ISO datetime strings
 */
function coerceDate(
  dateString: string | null | undefined,
): Date | null | undefined {
  if (dateString === null || dateString === undefined) {
    return dateString;
  }
  if (dateString === "") {
    return null;
  }
  // Handle YYYY-MM-DD format (from HTML date inputs) - create at local midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  // Handle ISO datetime strings
  return new Date(dateString);
}

/**
 * List tasks for the current user
 */
export async function listTasks(input?: ListTasksInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = listTasksSchema.parse(input ?? {});

  logger.debug("Listing tasks", {
    userId,
    hasSearch: !!parsed.search,
    status: parsed.status,
  });

  const where: Prisma.TaskWhereInput = {
    userId,
    deletedAt: null, // Exclude soft-deleted tasks
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.status ? { status: parsed.status } : {}),
    ...(parsed.search
      ? {
          OR: [
            { title: { contains: parsed.search, mode: "insensitive" } },
            {
              description: {
                contains: parsed.search,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Auto-archive done tasks older than 7 days
  await prisma.task.updateMany({
    where: {
      userId,
      status: "DONE",
      deletedAt: null,
      updatedAt: {
        lt: sevenDaysAgo,
      },
    },
    data: {
      deletedAt: now,
    },
  });

  const tasks = await prisma.task.findMany({
    where,
    orderBy: TASK_ORDER,
    include: {
      project: true,
    },
  });

  logger.info("Tasks listed successfully", {
    userId,
    count: tasks.length,
    durationMs: Date.now() - start,
  });

  return tasks;
}

/**
 * Create a new task for the current user
 */
export async function createTask(input?: CreateTaskInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = createTaskSchema.parse(input ?? {});

  logger.debug("Creating task", {
    userId,
    title: parsed.title,
    status: parsed.status,
    priority: parsed.priority,
  });

  const task = await prisma.task.create({
    data: {
      userId,
      title: parsed.title,
      description: parsed.description,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: coerceDate(parsed.dueDate),
      projectId: parsed.projectId,
    },
  });

  logger.info("Task created successfully", {
    taskId: task.id,
    userId,
    durationMs: Date.now() - start,
  });

  return task;
}

/**
 * Update a task (validates ownership)
 */
export async function updateTask(input: UpdateTaskInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = updateTaskSchema.parse(input);

  logger.debug("Updating task", {
    userId,
    taskId: parsed.id,
    hasTitle: !!parsed.title,
    hasStatus: !!parsed.status,
  });

  // Verify ownership
  const existingTask = await prisma.task.findFirst({
    where: {
      id: parsed.id,
      userId,
      deletedAt: null,
    },
  });

  if (!existingTask) {
    logger.warn("Task not found for update", {
      userId,
      taskId: parsed.id,
    });
    throw new Error("Task not found");
  }

  const updateData: Prisma.TaskUpdateInput = {};
  if (parsed.title !== undefined) updateData.title = parsed.title;
  if (parsed.description !== undefined)
    updateData.description = parsed.description;
  if (parsed.status !== undefined) updateData.status = parsed.status;
  if (parsed.priority !== undefined) updateData.priority = parsed.priority;
  if (parsed.dueDate !== undefined) {
    updateData.dueDate = coerceDate(parsed.dueDate);
  }

  const task = await prisma.task.update({
    where: { id: parsed.id },
    data: updateData,
  });

  logger.info("Task updated successfully", {
    taskId: task.id,
    userId,
    durationMs: Date.now() - start,
  });

  return task;
}

/**
 * Soft delete a task (validates ownership)
 */
export async function deleteTask(input: DeleteTaskInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = deleteTaskSchema.parse(input);

  logger.debug("Deleting task", {
    userId,
    taskId: parsed.id,
  });

  // Verify ownership
  const existingTask = await prisma.task.findFirst({
    where: {
      id: parsed.id,
      userId,
      deletedAt: null,
    },
  });

  if (!existingTask) {
    logger.warn("Task not found for delete", {
      userId,
      taskId: parsed.id,
    });
    throw new Error("Task not found");
  }

  // Soft delete by setting deletedAt
  const task = await prisma.task.update({
    where: { id: parsed.id },
    data: {
      deletedAt: new Date(),
    },
  });

  logger.info("Task deleted successfully", {
    taskId: task.id,
    userId,
    durationMs: Date.now() - start,
  });

  return { success: true };
}

/**
 * List archived tasks (soft-deleted)
 */
export async function listArchivedTasks() {
  const userId = await getCurrentUserId();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Ensure auto-archived tasks are updated before listing
  await prisma.task.updateMany({
    where: {
      userId,
      status: "DONE",
      deletedAt: null,
      updatedAt: {
        lt: sevenDaysAgo,
      },
    },
    data: {
      deletedAt: now,
    },
  });

  const tasks = await prisma.task.findMany({
    where: {
      userId,
      deletedAt: {
        not: null,
      },
    },
    orderBy: {
      deletedAt: "desc",
    },
    include: {
      project: true,
    },
  });

  return tasks;
}
