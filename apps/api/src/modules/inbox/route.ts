import { Hono } from "hono";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { handleRouteError, readJsonRequest } from "../common/http.js";
import {
  archiveInboxItem,
  createInboxItem,
  getInboxItemById,
  listArchivedInboxItems,
  listInboxItems,
  processInboxItem,
  unarchiveInboxItem,
  type InboxDb,
} from "./service.js";

type InboxRouteDependencies = {
  getDb?: () => Promise<InboxDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createInboxRoute(dependencies: InboxRouteDependencies = {}) {
  const inboxRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<InboxDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  const listHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      search: url.searchParams.get("search") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return listInboxItems({
      db,
      userId,
      input: input as {
        search?: string;
        state?: "SAVED" | "PROCESSING" | "REVIEW" | "PROCESSED";
      },
    });
  };

  const listArchivedHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      search: url.searchParams.get("search") ?? undefined,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return listArchivedInboxItems({
      db,
      userId,
      input,
    });
  };

  const getByIdHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getInboxItemById({ db, userId, input: { id } });
  };

  const createHandler = async (request: Request) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return createInboxItem({
      db,
      userId,
      input: body as {
        content: string;
      },
    });
  };

  const processHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return processInboxItem({
      db,
      userId,
      input: { id },
    });
  };

  const archiveHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return archiveInboxItem({
      db,
      userId,
      input: { id },
    });
  };

  const unarchiveHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return unarchiveInboxItem({
      db,
      userId,
      input: { id },
    });
  };

  inboxRoute.get("/inbox", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.get("/api/inbox", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.get("/inbox/archived", async (c) => {
    try {
      return c.json(await listArchivedHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.get("/api/inbox/archived", async (c) => {
    try {
      return c.json(await listArchivedHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.get("/inbox/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.get("/api/inbox/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/api/inbox", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/:id/process", async (c) => {
    try {
      return c.json(await processHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/api/inbox/:id/process", async (c) => {
    try {
      return c.json(await processHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/:id/archive", async (c) => {
    try {
      return c.json(await archiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/api/inbox/:id/archive", async (c) => {
    try {
      return c.json(await archiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/:id/unarchive", async (c) => {
    try {
      return c.json(await unarchiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/api/inbox/:id/unarchive", async (c) => {
    try {
      return c.json(await unarchiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return inboxRoute;
}

export const inboxRoute = createInboxRoute();
