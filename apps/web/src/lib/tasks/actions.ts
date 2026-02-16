"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import type { Project, Task } from "@life-os/db";
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

type ProjectResponse = Omit<Project, "archivedAt" | "createdAt" | "updatedAt"> & {
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

type TaskWithProjectResponse = TaskResponse & {
  project: ProjectResponse | null;
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

function hydrateTask(task: TaskResponse): Task {
  return {
    ...task,
    dueDate: task.dueDate ? parseDate(task.dueDate) : null,
    deletedAt: task.deletedAt ? parseDate(task.deletedAt) : null,
    createdAt: parseDate(task.createdAt),
    updatedAt: parseDate(task.updatedAt),
  };
}

function hydrateTaskWithProject(task: TaskWithProjectResponse): Task & { project: Project | null } {
  return {
    ...hydrateTask(task),
    project: task.project ? hydrateProject(task.project) : null,
  };
}

export async function listTasks(input?: ListTasksInput) {
  const parsed = listTasksSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }
  if (parsed.status) {
    params.set("status", parsed.status);
  }
  if (parsed.projectId) {
    params.set("projectId", parsed.projectId);
  }

  const path = params.size ? `/tasks?${params.toString()}` : "/tasks";
  const tasks = await apiFetchJson<TaskWithProjectResponse[]>(path);

  return tasks.map(hydrateTaskWithProject);
}

export async function createTask(input?: CreateTaskInput) {
  const parsed = createTaskSchema.parse(input ?? {});
  const task = await apiFetchJson<TaskResponse>("/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateTask(task);
}

export async function updateTask(input: UpdateTaskInput) {
  const parsed = updateTaskSchema.parse(input);
  const { id, ...payload } = parsed;
  const task = await apiFetchJson<TaskResponse>(`/tasks/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return hydrateTask(task);
}

export async function deleteTask(input: DeleteTaskInput) {
  const parsed = deleteTaskSchema.parse(input);
  return apiFetchJson<{ success: boolean }>(`/tasks/${parsed.id}`, {
    method: "DELETE",
  });
}

export async function listArchivedTasks() {
  const tasks = await apiFetchJson<TaskWithProjectResponse[]>("/tasks/archived");
  return tasks.map(hydrateTaskWithProject);
}
