"use server";

import { apiFetchJson } from "@/lib/api/fetch";

type RecentProjectResponse = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  _count: {
    tasks: number;
  };
};

type UpcomingTaskResponse = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  project: {
    name: string;
  } | null;
};

type RecentNoteResponse = {
  id: string;
  title: string;
  content: string | null;
  updatedAt: string;
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }
  return parsed;
}

export async function getRecentProjects() {
  const projects = await apiFetchJson<RecentProjectResponse[]>(
    "/api/home/recent-projects",
  );

  return projects.map((project) => ({
    ...project,
    updatedAt: parseDate(project.updatedAt),
  }));
}

export async function getUpcomingTasks() {
  const tasks = await apiFetchJson<UpcomingTaskResponse[]>(
    "/api/home/upcoming-tasks",
  );

  return tasks.map((task) => ({
    ...task,
    dueDate: task.dueDate ? parseDate(task.dueDate) : null,
  }));
}

export async function getRecentNotes() {
  const notes = await apiFetchJson<RecentNoteResponse[]>(
    "/api/home/recent-notes",
  );

  return notes.map((note) => ({
    ...note,
    updatedAt: parseDate(note.updatedAt),
  }));
}
