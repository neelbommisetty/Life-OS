"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import type { ChatThread, Note, Project, Task } from "@prisma/client";
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

type ProjectResponse = Omit<Project, "archivedAt" | "createdAt" | "updatedAt"> & {
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatThreadResponse = Omit<
  ChatThread,
  "summaryUpTo" | "lastChattedAt" | "archivedAt" | "createdAt" | "updatedAt"
> & {
  summaryUpTo: string | null;
  lastChattedAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TaskResponse = Omit<Task, "dueDate" | "deletedAt" | "createdAt" | "updatedAt"> & {
  dueDate: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteResponse = Omit<Note, "deletedAt" | "createdAt" | "updatedAt"> & {
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProjectWithItemsResponse = ProjectResponse & {
  chatThreads: ChatThreadResponse[];
  tasks: TaskResponse[];
  notes: NoteResponse[];
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }
  return parsed;
}

function hydrateProject(project: ProjectResponse): Project {
  return {
    ...project,
    archivedAt: project.archivedAt ? parseDate(project.archivedAt) : null,
    createdAt: parseDate(project.createdAt),
    updatedAt: parseDate(project.updatedAt),
  };
}

function hydrateChatThread(thread: ChatThreadResponse): ChatThread {
  return {
    ...thread,
    summaryUpTo: thread.summaryUpTo ? parseDate(thread.summaryUpTo) : null,
    lastChattedAt: parseDate(thread.lastChattedAt),
    archivedAt: thread.archivedAt ? parseDate(thread.archivedAt) : null,
    createdAt: parseDate(thread.createdAt),
    updatedAt: parseDate(thread.updatedAt),
  };
}

function hydrateTask(task: TaskResponse): Task {
  return {
    ...task,
    dueDate: task.dueDate ? parseDate(task.dueDate) : null,
    deletedAt: task.deletedAt ? parseDate(task.deletedAt) : null,
    createdAt: parseDate(task.createdAt),
    updatedAt: parseDate(task.updatedAt),
  };
}

function hydrateNote(note: NoteResponse): Note {
  return {
    ...note,
    deletedAt: note.deletedAt ? parseDate(note.deletedAt) : null,
    createdAt: parseDate(note.createdAt),
    updatedAt: parseDate(note.updatedAt),
  };
}

export async function listProjects(input?: ListProjectsInput) {
  const parsed = listProjectsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }
  if (parsed.includeArchived) {
    params.set("includeArchived", "true");
  }

  const path = params.size ? `/api/projects?${params.toString()}` : "/api/projects";
  const projects = await apiFetchJson<ProjectResponse[]>(path);

  return projects.map(hydrateProject);
}

export async function getProjectById(input: GetProjectByIdInput) {
  const parsed = getProjectByIdSchema.parse(input);
  const project = await apiFetchJson<ProjectResponse>(`/api/projects/${parsed.id}`);
  return hydrateProject(project);
}

export async function getProjectWithItems(input: GetProjectByIdInput) {
  const parsed = getProjectByIdSchema.parse(input);
  const project = await apiFetchJson<ProjectWithItemsResponse>(
    `/api/projects/${parsed.id}/items`,
  );

  return {
    ...hydrateProject(project),
    chatThreads: project.chatThreads.map(hydrateChatThread),
    tasks: project.tasks.map(hydrateTask),
    notes: project.notes.map(hydrateNote),
  };
}

export async function createProject(input: CreateProjectInput) {
  const parsed = createProjectSchema.parse(input);
  const project = await apiFetchJson<ProjectResponse>("/api/projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateProject(project);
}

export async function updateProject(input: UpdateProjectInput) {
  const parsed = updateProjectSchema.parse(input);
  const { id, ...payload } = parsed;
  const project = await apiFetchJson<ProjectResponse>(`/api/projects/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return hydrateProject(project);
}

export async function archiveProject(input: ArchiveProjectInput) {
  const parsed = archiveProjectSchema.parse(input);
  const project = await apiFetchJson<ProjectResponse>(
    `/api/projects/${parsed.id}/archive`,
    {
      method: "POST",
    },
  );

  return hydrateProject(project);
}

export async function unarchiveProject(input: UnarchiveProjectInput) {
  const parsed = unarchiveProjectSchema.parse(input);
  const project = await apiFetchJson<ProjectResponse>(
    `/api/projects/${parsed.id}/unarchive`,
    {
      method: "POST",
    },
  );

  return hydrateProject(project);
}

export async function deleteProject(input: DeleteProjectInput) {
  const parsed = deleteProjectSchema.parse(input);
  return apiFetchJson<{ success: boolean }>(`/api/projects/${parsed.id}`, {
    method: "DELETE",
  });
}
