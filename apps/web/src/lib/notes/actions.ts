"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import type { Note, Project } from "@life-os/db";
import {
  listNotesSchema,
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  getNoteByIdSchema,
  saveMessageAsNoteSchema,
  type ListNotesInput,
  type CreateNoteInput,
  type UpdateNoteInput,
  type DeleteNoteInput,
  type GetNoteByIdInput,
  type SaveMessageAsNoteInput,
} from "./validations";

type ProjectResponse = Omit<Project, "archivedAt" | "createdAt" | "updatedAt"> & {
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteResponse = Omit<Note, "deletedAt" | "createdAt" | "updatedAt"> & {
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteWithProjectResponse = NoteResponse & {
  project: ProjectResponse | null;
};

type SaveMessageAsNoteResponse = {
  note: NoteResponse;
  alreadySaved: boolean;
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

function hydrateNote(note: NoteResponse): Note {
  return {
    ...note,
    deletedAt: note.deletedAt ? parseDate(note.deletedAt) : null,
    createdAt: parseDate(note.createdAt),
    updatedAt: parseDate(note.updatedAt),
  };
}

function hydrateNoteWithProject(note: NoteWithProjectResponse): Note & { project: Project | null } {
  return {
    ...hydrateNote(note),
    project: note.project ? hydrateProject(note.project) : null,
  };
}

export async function listNotes(input?: ListNotesInput) {
  const parsed = listNotesSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }
  if (parsed.projectId) {
    params.set("projectId", parsed.projectId);
  }

  const path = params.size ? `/api/notes?${params.toString()}` : "/api/notes";
  const notes = await apiFetchJson<NoteWithProjectResponse[]>(path);

  return notes.map(hydrateNoteWithProject);
}

export async function getNoteById(input: GetNoteByIdInput) {
  const parsed = getNoteByIdSchema.parse(input);
  const note = await apiFetchJson<NoteResponse>(`/api/notes/${parsed.id}`);
  return hydrateNote(note);
}

export async function createNote(input?: CreateNoteInput) {
  const parsed = createNoteSchema.parse(input ?? {});
  const note = await apiFetchJson<NoteResponse>("/api/notes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateNote(note);
}

export async function saveMessageAsNote(input: SaveMessageAsNoteInput) {
  const parsed = saveMessageAsNoteSchema.parse(input);
  const result = await apiFetchJson<SaveMessageAsNoteResponse>(
    "/api/notes/save-from-message",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(parsed),
    },
  );

  return {
    ...result,
    note: hydrateNote(result.note),
  };
}

export async function updateNote(input: UpdateNoteInput) {
  const parsed = updateNoteSchema.parse(input);
  const { id, ...payload } = parsed;
  const note = await apiFetchJson<NoteResponse>(`/api/notes/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return hydrateNote(note);
}

export async function deleteNote(input: DeleteNoteInput) {
  const parsed = deleteNoteSchema.parse(input);
  return apiFetchJson<{ success: boolean }>(`/api/notes/${parsed.id}`, {
    method: "DELETE",
  });
}
