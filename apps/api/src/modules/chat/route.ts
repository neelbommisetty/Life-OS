import { Hono } from "hono";
import { modelRegistry as globalModelRegistry } from "@life-os/ai";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { badRequestError } from "../common/errors.js";
import {
  handleRouteError,
  parseBooleanQuery,
  parseNumberQuery,
  readJsonRequest,
} from "../common/http.js";
import {
  archiveThread,
  createThread,
  getThread,
  listMessages,
  listModels,
  listThreads,
  setThreadModel,
  type ChatDb,
  type ChatModelRegistry,
} from "./service.js";

type ChatRouteDependencies = {
  getDb?: () => Promise<ChatDb>;
  getUserId?: (request: Request) => Promise<string>;
  modelRegistry?: ChatModelRegistry;
};

function parseCursor(url: URL) {
  const cursorId = url.searchParams.get("cursorId") ?? undefined;
  const cursorCreatedAt = url.searchParams.get("cursorCreatedAt") ?? undefined;

  if (!cursorId && !cursorCreatedAt) {
    return undefined;
  }

  if (!cursorId || !cursorCreatedAt) {
    throw badRequestError("Both cursorId and cursorCreatedAt are required");
  }

  const parsedDate = new Date(cursorCreatedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    throw badRequestError("cursorCreatedAt must be a valid ISO datetime");
  }

  return {
    id: cursorId,
    createdAt: parsedDate,
  };
}

export function createChatRoute(dependencies: ChatRouteDependencies = {}) {
  const chatRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<ChatDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;
  const modelRegistry = dependencies.modelRegistry ?? globalModelRegistry;

  const listThreadsHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      includeArchived: parseBooleanQuery(
        url.searchParams.get("includeArchived") ?? undefined,
      ),
      projectId: url.searchParams.get("projectId") ?? undefined,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listThreads({ db, userId, input });
  };

  const createThreadHandler = async (request: Request) => {
    const body = (await readJsonRequest(request)) as {
      name?: string;
      projectId?: string;
    };
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return createThread({
      db,
      userId,
      input: {
        name: body.name,
        projectId: body.projectId,
      },
    });
  };

  const archiveThreadHandler = async (request: Request, threadId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return archiveThread({ db, userId, input: { threadId } });
  };

  const getThreadHandler = async (request: Request, threadId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getThread({ db, userId, threadId, modelRegistry });
  };

  const setModelHandler = async (request: Request, threadId: string) => {
    const body = (await readJsonRequest(request)) as {
      modelKey?: string | null;
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return setThreadModel({
      db,
      userId,
      modelRegistry,
      input: {
        threadId,
        modelKey: body.modelKey ?? null,
      },
    });
  };

  const listMessagesHandler = async (request: Request, threadId: string) => {
    const url = new URL(request.url);
    const cursor = parseCursor(url);
    const limit = parseNumberQuery(url.searchParams.get("limit") ?? undefined);

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listMessages({
      db,
      userId,
      input: {
        threadId,
        cursor,
        limit,
      },
    });
  };

  const listModelsHandler = async () => listModels(modelRegistry);

  chatRoute.get("/chat/threads", async (c) => {
    try {
      return c.json(await listThreadsHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/api/chat/threads", async (c) => {
    try {
      return c.json(await listThreadsHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/chat/threads", async (c) => {
    try {
      return c.json(await createThreadHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/api/chat/threads", async (c) => {
    try {
      return c.json(await createThreadHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/chat/threads/:threadId/archive", async (c) => {
    try {
      return c.json(
        await archiveThreadHandler(c.req.raw, c.req.param("threadId")),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/api/chat/threads/:threadId/archive", async (c) => {
    try {
      return c.json(
        await archiveThreadHandler(c.req.raw, c.req.param("threadId")),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/chat/threads/:threadId", async (c) => {
    try {
      return c.json(await getThreadHandler(c.req.raw, c.req.param("threadId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/api/chat/threads/:threadId", async (c) => {
    try {
      return c.json(await getThreadHandler(c.req.raw, c.req.param("threadId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/chat/threads/:threadId/model", async (c) => {
    try {
      return c.json(await setModelHandler(c.req.raw, c.req.param("threadId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.post("/api/chat/threads/:threadId/model", async (c) => {
    try {
      return c.json(await setModelHandler(c.req.raw, c.req.param("threadId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/chat/threads/:threadId/messages", async (c) => {
    try {
      return c.json(
        await listMessagesHandler(c.req.raw, c.req.param("threadId")),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/api/chat/threads/:threadId/messages", async (c) => {
    try {
      return c.json(
        await listMessagesHandler(c.req.raw, c.req.param("threadId")),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/chat/models", async (c) => {
    try {
      return c.json(await listModelsHandler());
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  chatRoute.get("/api/chat/models", async (c) => {
    try {
      return c.json(await listModelsHandler());
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return chatRoute;
}

export const chatRoute = createChatRoute();
