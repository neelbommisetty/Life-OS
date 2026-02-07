import { unauthorizedError } from "../common/errors.js";

export type HomeDb = {
  project: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  task: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  note: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
};

export async function getRecentProjects(params: {
  db: HomeDb;
  userId: string;
}) {
  if (!params.userId) {
    throw unauthorizedError("Unauthorized");
  }

  return params.db.project.findMany({
    where: {
      userId: params.userId,
      archivedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
    include: {
      _count: {
        select: {
          tasks: {
            where: {
              status: "TODO",
            },
          },
        },
      },
    },
  });
}

export async function getUpcomingTasks(params: {
  db: HomeDb;
  userId: string;
  now?: Date;
}) {
  if (!params.userId) {
    throw unauthorizedError("Unauthorized");
  }

  const now = params.now ?? new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  return params.db.task.findMany({
    where: {
      userId: params.userId,
      status: { not: "DONE" },
      deletedAt: null,
      OR: [
        {
          dueDate: {
            lte: nextWeek,
            gte: startOfToday,
          },
        },
        {
          dueDate: null,
        },
      ],
    },
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    take: 4,
    include: {
      project: {
        select: {
          name: true,
        },
      },
    },
  });
}

export async function getRecentNotes(params: { db: HomeDb; userId: string }) {
  if (!params.userId) {
    throw unauthorizedError("Unauthorized");
  }

  return params.db.note.findMany({
    where: {
      userId: params.userId,
      deletedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
  });
}
