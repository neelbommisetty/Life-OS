import {
  archiveProjectSchema,
  createProjectSchema,
  deleteProjectSchema,
  getProjectByIdSchema,
  listProjectsSchema,
  unarchiveProjectSchema,
  updateProjectSchema,
  type ArchiveProjectInput,
  type CreateProjectInput,
  type DeleteProjectInput,
  type GetProjectByIdInput,
  type ListProjectsInput,
  type UnarchiveProjectInput,
  type UpdateProjectInput,
} from "./schemas.js";

const PROJECT_ORDER = [{ updatedAt: "desc" }] as const;

export type ProjectsDb = {
  project: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };
};

export async function listProjects(params: {
  db: ProjectsDb;
  userId: string;
  input?: ListProjectsInput;
}) {
  const parsed = listProjectsSchema.parse(params.input ?? {});

  const where = {
    userId: params.userId,
    ...(parsed.includeArchived ? {} : { archivedAt: null }),
    ...(parsed.search
      ? {
          OR: [
            {
              name: {
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

  return params.db.project.findMany({
    where,
    orderBy: PROJECT_ORDER,
  });
}

export async function getProjectById(params: {
  db: ProjectsDb;
  userId: string;
  input: GetProjectByIdInput;
}) {
  const parsed = getProjectByIdSchema.parse(params.input);

  const project = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

export async function getProjectWithItems(params: {
  db: ProjectsDb;
  userId: string;
  input: GetProjectByIdInput;
}) {
  const parsed = getProjectByIdSchema.parse(params.input);

  const project = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
    },
    include: {
      chatThreads: {
        where: { archivedAt: null },
        orderBy: { lastChattedAt: "desc" },
      },
      tasks: {
        where: { deletedAt: null },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      },
      notes: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

export async function createProject(params: {
  db: ProjectsDb;
  userId: string;
  input: CreateProjectInput;
}) {
  const parsed = createProjectSchema.parse(params.input);

  return params.db.project.create({
    data: {
      userId: params.userId,
      name: parsed.name,
      description: parsed.description,
      aiInstructions: parsed.aiInstructions,
    },
  });
}

export async function updateProject(params: {
  db: ProjectsDb;
  userId: string;
  input: UpdateProjectInput;
}) {
  const parsed = updateProjectSchema.parse(params.input);

  const existingProject = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
    },
  });

  if (!existingProject) {
    throw new Error("Project not found");
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.name !== undefined) updateData.name = parsed.name;
  if (parsed.description !== undefined) updateData.description = parsed.description;
  if (parsed.aiInstructions !== undefined) {
    updateData.aiInstructions = parsed.aiInstructions;
  }

  return params.db.project.update({
    where: { id: parsed.id },
    data: updateData,
  });
}

export async function archiveProject(params: {
  db: ProjectsDb;
  userId: string;
  input: ArchiveProjectInput;
}) {
  const parsed = archiveProjectSchema.parse(params.input);

  const existingProject = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
      archivedAt: null,
    },
  });

  if (!existingProject) {
    throw new Error("Project not found");
  }

  return params.db.project.update({
    where: { id: parsed.id },
    data: { archivedAt: new Date() },
  });
}

export async function unarchiveProject(params: {
  db: ProjectsDb;
  userId: string;
  input: UnarchiveProjectInput;
}) {
  const parsed = unarchiveProjectSchema.parse(params.input);

  const existingProject = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
    },
  });

  if (!existingProject) {
    throw new Error("Project not found");
  }

  return params.db.project.update({
    where: { id: parsed.id },
    data: { archivedAt: null },
  });
}

export async function deleteProject(params: {
  db: ProjectsDb;
  userId: string;
  input: DeleteProjectInput;
}) {
  const parsed = deleteProjectSchema.parse(params.input);

  const existingProject = await params.db.project.findFirst({
    where: {
      id: parsed.id,
      userId: params.userId,
    },
  });

  if (!existingProject) {
    throw new Error("Project not found");
  }

  await params.db.project.delete({
    where: { id: parsed.id },
  });

  return { success: true };
}
