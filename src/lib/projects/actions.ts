"use server";

import { prisma } from "@/lib/db";
import { authServer } from "@/lib/auth/server";
import { createLogger } from "@/lib/logger";
import type { Prisma } from "@prisma/client";
import {
  listProjectsSchema,
  createProjectSchema,
  updateProjectSchema,
  deleteProjectSchema,
  getProjectByIdSchema,
  archiveProjectSchema,
  unarchiveProjectSchema,
  type ListProjectsInput,
  type CreateProjectInput,
  type UpdateProjectInput,
  type DeleteProjectInput,
  type GetProjectByIdInput,
  type ArchiveProjectInput,
  type UnarchiveProjectInput,
} from "./validations";

const logger = createLogger("projects:actions");

const PROJECT_ORDER: Prisma.ProjectOrderByWithRelationInput[] = [
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
 * List projects for the current user
 */
export async function listProjects(input?: ListProjectsInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = listProjectsSchema.parse(input ?? {});

  logger.debug("Listing projects", {
    userId,
    hasSearch: !!parsed.search,
    includeArchived: parsed.includeArchived,
  });

  const where: Prisma.ProjectWhereInput = {
    userId,
    ...(parsed.includeArchived ? {} : { archivedAt: null }),
    ...(parsed.search
      ? {
          OR: [
            { name: { contains: parsed.search, mode: "insensitive" } },
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

  const projects = await prisma.project.findMany({
    where,
    orderBy: PROJECT_ORDER,
  });

  logger.info("Projects listed successfully", {
    userId,
    count: projects.length,
    durationMs: Date.now() - start,
  });

  return projects;
}

/**
 * Get a single project by ID (validates ownership)
 */
export async function getProjectById(input: GetProjectByIdInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = getProjectByIdSchema.parse(input);

  logger.debug("Getting project by ID", {
    userId,
    projectId: parsed.id,
  });

  const project = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
    },
  });

  if (!project) {
    logger.warn("Project not found", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  logger.info("Project retrieved successfully", {
    projectId: project.id,
    userId,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Get a project with all its related items (threads, tasks, notes)
 */
export async function getProjectWithItems(input: GetProjectByIdInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = getProjectByIdSchema.parse(input);

  logger.debug("Getting project with items", {
    userId,
    projectId: parsed.id,
  });

  const project = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
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
    logger.warn("Project not found", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  logger.info("Project with items retrieved successfully", {
    projectId: project.id,
    userId,
    threadCount: project.chatThreads.length,
    taskCount: project.tasks.length,
    noteCount: project.notes.length,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Create a new project for the current user
 */
export async function createProject(input: CreateProjectInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = createProjectSchema.parse(input);

  logger.debug("Creating project", {
    userId,
    name: parsed.name,
  });

  const project = await prisma.project.create({
    data: {
      userId,
      name: parsed.name,
      description: parsed.description,
      aiInstructions: parsed.aiInstructions,
    },
  });

  logger.info("Project created successfully", {
    projectId: project.id,
    userId,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Update a project (validates ownership)
 */
export async function updateProject(input: UpdateProjectInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = updateProjectSchema.parse(input);

  logger.debug("Updating project", {
    userId,
    projectId: parsed.id,
    hasName: !!parsed.name,
  });

  // Verify ownership
  const existingProject = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
    },
  });

  if (!existingProject) {
    logger.warn("Project not found for update", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  const updateData: Prisma.ProjectUpdateInput = {};
  if (parsed.name !== undefined) updateData.name = parsed.name;
  if (parsed.description !== undefined) updateData.description = parsed.description;
  if (parsed.aiInstructions !== undefined)
    updateData.aiInstructions = parsed.aiInstructions;

  const project = await prisma.project.update({
    where: { id: parsed.id },
    data: updateData,
  });

  logger.info("Project updated successfully", {
    projectId: project.id,
    userId,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Archive a project (soft delete)
 */
export async function archiveProject(input: ArchiveProjectInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = archiveProjectSchema.parse(input);

  logger.debug("Archiving project", {
    userId,
    projectId: parsed.id,
  });

  // Verify ownership
  const existingProject = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
      archivedAt: null,
    },
  });

  if (!existingProject) {
    logger.warn("Project not found for archive", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  const project = await prisma.project.update({
    where: { id: parsed.id },
    data: {
      archivedAt: new Date(),
    },
  });

  logger.info("Project archived successfully", {
    projectId: project.id,
    userId,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Unarchive a project
 */
export async function unarchiveProject(input: UnarchiveProjectInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = unarchiveProjectSchema.parse(input);

  logger.debug("Unarchiving project", {
    userId,
    projectId: parsed.id,
  });

  // Verify ownership
  const existingProject = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
    },
  });

  if (!existingProject) {
    logger.warn("Project not found for unarchive", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  const project = await prisma.project.update({
    where: { id: parsed.id },
    data: {
      archivedAt: null,
    },
  });

  logger.info("Project unarchived successfully", {
    projectId: project.id,
    userId,
    durationMs: Date.now() - start,
  });

  return project;
}

/**
 * Delete a project (hard delete - validates ownership)
 */
export async function deleteProject(input: DeleteProjectInput) {
  const start = Date.now();
  const userId = await getCurrentUserId();
  const parsed = deleteProjectSchema.parse(input);

  logger.debug("Deleting project", {
    userId,
    projectId: parsed.id,
  });

  // Verify ownership
  const existingProject = await prisma.project.findFirst({
    where: {
      id: parsed.id,
      userId,
    },
  });

  if (!existingProject) {
    logger.warn("Project not found for delete", {
      userId,
      projectId: parsed.id,
    });
    throw new Error("Project not found");
  }

  // Hard delete - foreign keys are set to ON DELETE SET NULL so related items will be unlinked
  await prisma.project.delete({
    where: { id: parsed.id },
  });

  logger.info("Project deleted successfully", {
    projectId: parsed.id,
    userId,
    durationMs: Date.now() - start,
  });

  return { success: true };
}
