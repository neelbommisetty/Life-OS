import { Hono } from "hono";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { handleRouteError, readJsonRequest } from "../common/http.js";
import {
  createNote,
  deleteNote,
  getNoteById,
  listNotes,
  saveMessageAsNote,
  updateNote,
  type NotesDb,
} from "./service.js";

type NotesRouteDependencies = {
  getDb?: () => Promise<NotesDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createNotesRoute(dependencies: NotesRouteDependencies = {}) {
  const notesRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<NotesDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  const listHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      search: url.searchParams.get("search") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listNotes({ db, userId, input });
  };

  const getByIdHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getNoteById({ db, userId, input: { id } });
  };

  const createHandler = async (request: Request) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return createNote({
      db,
      userId,
      input: body as {
        title: string;
        content: string;
        projectId?: string;
      },
    });
  };

  const saveFromMessageHandler = async (request: Request) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return saveMessageAsNote({
      db,
      userId,
      input: body as { messageId: string },
    });
  };

  const updateHandler = async (request: Request, id: string) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return updateNote({
      db,
      userId,
      input: {
        ...(body as Record<string, unknown>),
        id,
      } as {
        id: string;
        title?: string;
        content?: string;
      },
    });
  };

  const deleteHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return deleteNote({ db, userId, input: { id } });
  };

  notesRoute.get("/notes", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.get("/api/notes", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.get("/notes/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.get("/api/notes/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.post("/notes", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.post("/api/notes", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.post("/notes/save-from-message", async (c) => {
    try {
      return c.json(await saveFromMessageHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.post("/api/notes/save-from-message", async (c) => {
    try {
      return c.json(await saveFromMessageHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.patch("/notes/:id", async (c) => {
    try {
      return c.json(await updateHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.patch("/api/notes/:id", async (c) => {
    try {
      return c.json(await updateHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.delete("/notes/:id", async (c) => {
    try {
      return c.json(await deleteHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  notesRoute.delete("/api/notes/:id", async (c) => {
    try {
      return c.json(await deleteHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return notesRoute;
}

export const notesRoute = createNotesRoute();
