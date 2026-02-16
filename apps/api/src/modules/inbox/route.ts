import { Hono } from "hono";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { handleRouteError, readJsonRequest } from "../common/http.js";
import {
  approveAllInboxProposalOutputs,
  approveInboxProposalOutput,
  archiveInboxItem,
  createInboxItem,
  declineAllInboxProposalOutputs,
  declineInboxProposalOutput,
  getInboxItemById,
  listArchivedInboxItems,
  listInboxItems,
  listInboxProposalOutputs,
  processInboxItem,
  queueInboxProposalGeneration,
  recoverInboxItem,
  retryInboxProposalOutput,
  skipInboxProposalOutput,
  unarchiveInboxItem,
  type InboxDb,
} from "./service.js";

type InboxRouteDependencies = {
  getDb?: () => Promise<InboxDb>;
  getUserId?: (request: Request) => Promise<string>;
  queueProposalGeneration?: (params: {
    userId: string;
    inboxItemId: string;
  }) => void;
};

function getIdempotencyKey(request: Request) {
  return request.headers.get("Idempotency-Key") ?? "";
}

async function readOptionalJsonBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {} as Record<string, unknown>;
  }

  return (await readJsonRequest(request)) as Record<string, unknown>;
}

export function createInboxRoute(dependencies: InboxRouteDependencies = {}) {
  const inboxRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<InboxDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;
  const queueProposalGeneration =
    dependencies.queueProposalGeneration ??
    ((params) => {
      queueInboxProposalGeneration({
        getDb,
        userId: params.userId,
        inboxItemId: params.inboxItemId,
      });
    });

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

    const created = await createInboxItem({
      db,
      userId,
      input: body as {
        content: string;
      },
    });

    queueProposalGeneration({
      userId,
      inboxItemId: (created as { id: string }).id,
    });

    return created;
  };

  const processHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return processInboxItem({
      db,
      userId,
      input: { id },
    });
  };

  const recoverHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return recoverInboxItem({
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

  const listOutputsHandler = async (request: Request, itemId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return listInboxProposalOutputs({
      db,
      userId,
      input: {
        itemId,
      },
    });
  };

  const approveOutputHandler = async (request: Request, outputId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return approveInboxProposalOutput({
      db,
      userId,
      input: {
        outputId,
        idempotencyKey: getIdempotencyKey(request),
      },
    });
  };

  const declineOutputHandler = async (request: Request, outputId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return declineInboxProposalOutput({
      db,
      userId,
      input: {
        outputId,
        idempotencyKey: getIdempotencyKey(request),
      },
    });
  };

  const retryOutputHandler = async (request: Request, outputId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return retryInboxProposalOutput({
      db,
      userId,
      input: {
        outputId,
        idempotencyKey: getIdempotencyKey(request),
      },
    });
  };

  const skipOutputHandler = async (request: Request, outputId: string) => {
    const body = await readOptionalJsonBody(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return skipInboxProposalOutput({
      db,
      userId,
      input: {
        outputId,
        idempotencyKey: getIdempotencyKey(request),
        reason: typeof body.reason === "string" ? body.reason : undefined,
      },
    });
  };

  const approveAllHandler = async (request: Request, itemId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return approveAllInboxProposalOutputs({
      db,
      userId,
      input: {
        itemId,
        idempotencyKey: getIdempotencyKey(request),
      },
    });
  };

  const declineAllHandler = async (request: Request, itemId: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);

    return declineAllInboxProposalOutputs({
      db,
      userId,
      input: {
        itemId,
        idempotencyKey: getIdempotencyKey(request),
      },
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

  inboxRoute.post("/inbox/:id/recover", async (c) => {
    try {
      return c.json(await recoverHandler(c.req.raw, c.req.param("id")));
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

  inboxRoute.get("/inbox/:itemId/outputs", async (c) => {
    try {
      return c.json(await listOutputsHandler(c.req.raw, c.req.param("itemId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/outputs/:outputId/approve", async (c) => {
    try {
      return c.json(await approveOutputHandler(c.req.raw, c.req.param("outputId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/outputs/:outputId/decline", async (c) => {
    try {
      return c.json(await declineOutputHandler(c.req.raw, c.req.param("outputId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/outputs/:outputId/retry", async (c) => {
    try {
      return c.json(await retryOutputHandler(c.req.raw, c.req.param("outputId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/outputs/:outputId/skip", async (c) => {
    try {
      return c.json(await skipOutputHandler(c.req.raw, c.req.param("outputId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/:itemId/outputs/approve-all", async (c) => {
    try {
      return c.json(await approveAllHandler(c.req.raw, c.req.param("itemId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  inboxRoute.post("/inbox/:itemId/outputs/decline-all", async (c) => {
    try {
      return c.json(await declineAllHandler(c.req.raw, c.req.param("itemId")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return inboxRoute;
}

export const inboxRoute = createInboxRoute();
