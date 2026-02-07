import {
  createTaskSchema,
  deleteTaskSchema,
  listTasksSchema,
  updateTaskSchema,
  type DeleteTaskInput,
  type ListTasksInput,
  type UpdateTaskInput,
} from "./schemas.js";

const TASK_ORDER = [{ status: "asc" }, { updatedAt: "desc" }] as const;

export type TasksDb = {
  task: {
    updateMany: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    create: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    update: (args: unknown) => Promise<unknown>;
  };
};

function coerceDate(dateString: string | null | undefined): Date | null | undefined {
  if (dateString === null || dateString === undefined) {
    return dateString;
  }

  if (dateString === "") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(dateString);
}

async function autoArchiveDoneTasks(params: {
  db: TasksDb;
  userId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  await params.db.task.updateMany({
    where: {
      userId: params.userId,
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
}

export async function listTasks(params: {
  db: TasksDb;
  userId: string;
  input?: ListTasksInput;
  now?: Date;
}) {
  const parsed = listTasksSchema.parse(params.input ?? {});

  const where = {
    userId: params.userId,
    deletedAt: null,
    ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
    ...(parsed.status ? { status: parsed.status } : {}),
    ...(parsed.search
      ? {
          OR: [
            {
              title: {
                contains: parsed.search,
                mode: "insensitive",
              },
            },
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

  await autoArchiveDoneTasks({ db: params.db, userId: params.userId, now: params.now });

  return params.db.task.findMany({
    where,
    orderBy: TASK_ORDER,
    include: {
      project: true,
    },
  });
}

export async function createTask(params: {
  db: TasksDb;
  userId: string;
  input?: unknown;
}) {
  const parsed = createTaskSchema.parse(params.input ?? {});

  return params.db.task.create({
    data: {
      userId: params.userId,
      title: parsed.title,
      description: parsed.description,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: coerceDate(parsed.dueDate),
      projectId: parsed.projectId,
    },
  });
}

export async function updateTask(params: {
  db: TasksDb;
  userId: string;
  input: UpdateTaskInput;
}) {
  const parsed = updateTaskSchema.parse(params.input);

  const existingTask = await params.db.task.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      deletedAt: null,
    },
  });

  if (!existingTask) {
    throw new Error("Task not found");
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.title !== undefined) updateData.title = parsed.title;
  if (parsed.description !== undefined) updateData.description = parsed.description;
  if (parsed.status !== undefined) updateData.status = parsed.status;
  if (parsed.priority !== undefined) updateData.priority = parsed.priority;
  if (parsed.dueDate !== undefined) updateData.dueDate = coerceDate(parsed.dueDate);

  return params.db.task.update({
    where: {
      id: parsed.id,
    },
    data: updateData,
  });
}

export async function deleteTask(params: {
  db: TasksDb;
  userId: string;
  input: DeleteTaskInput;
}) {
  const parsed = deleteTaskSchema.parse(params.input);

  const existingTask = await params.db.task.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      deletedAt: null,
    },
  });

  if (!existingTask) {
    throw new Error("Task not found");
  }

  await params.db.task.update({
    where: {
      id: parsed.id,
    },
    data: {
      deletedAt: new Date(),
    },
  });

  return { success: true };
}

export async function listArchivedTasks(params: {
  db: TasksDb;
  userId: string;
  now?: Date;
}) {
  await autoArchiveDoneTasks({ db: params.db, userId: params.userId, now: params.now });

  return params.db.task.findMany({
    where: {
      userId: params.userId,
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
}
