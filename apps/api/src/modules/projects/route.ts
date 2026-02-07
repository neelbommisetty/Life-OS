import { Hono } from "hono";
import { getDbClient } from "../common/db.js";
import { resolveUserIdFromRequest } from "../common/auth.js";
import {
  handleRouteError,
  parseBooleanQuery,
  readJsonRequest,
} from "../common/http.js";
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectById,
  getProjectWithItems,
  listProjects,
  unarchiveProject,
  updateProject,
  type ProjectsDb,
} from "./service.js";

type ProjectsRouteDependencies = {
  getDb?: () => Promise<ProjectsDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createProjectsRoute(
  dependencies: ProjectsRouteDependencies = {},
) {
  const projectsRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<ProjectsDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  const listHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      search: url.searchParams.get("search") ?? undefined,
      includeArchived:
        parseBooleanQuery(url.searchParams.get("includeArchived") ?? undefined) ??
        false,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listProjects({ db, userId, input });
  };

  const getByIdHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getProjectById({ db, userId, input: { id } });
  };

  const getWithItemsHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getProjectWithItems({ db, userId, input: { id } });
  };

  const createHandler = async (request: Request) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return createProject({
      db,
      userId,
      input: body as {
        name: string;
        description?: string;
        aiInstructions?: string;
      },
    });
  };

  const updateHandler = async (request: Request, id: string) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return updateProject({
      db,
      userId,
      input: {
        ...(body as Record<string, unknown>),
        id,
      } as {
        id: string;
        name?: string;
        description?: string;
        aiInstructions?: string;
      },
    });
  };

  const archiveHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return archiveProject({ db, userId, input: { id } });
  };

  const unarchiveHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return unarchiveProject({ db, userId, input: { id } });
  };

  const deleteHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return deleteProject({ db, userId, input: { id } });
  };

  projectsRoute.get("/projects", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.get("/api/projects", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.get("/projects/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.get("/api/projects/:id", async (c) => {
    try {
      return c.json(await getByIdHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.get("/projects/:id/items", async (c) => {
    try {
      return c.json(await getWithItemsHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.get("/api/projects/:id/items", async (c) => {
    try {
      return c.json(await getWithItemsHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/projects", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/api/projects", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.patch("/projects/:id", async (c) => {
    try {
      return c.json(await updateHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.patch("/api/projects/:id", async (c) => {
    try {
      return c.json(await updateHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/projects/:id/archive", async (c) => {
    try {
      return c.json(await archiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/api/projects/:id/archive", async (c) => {
    try {
      return c.json(await archiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/projects/:id/unarchive", async (c) => {
    try {
      return c.json(await unarchiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.post("/api/projects/:id/unarchive", async (c) => {
    try {
      return c.json(await unarchiveHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.delete("/projects/:id", async (c) => {
    try {
      return c.json(await deleteHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  projectsRoute.delete("/api/projects/:id", async (c) => {
    try {
      return c.json(await deleteHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return projectsRoute;
}

export const projectsRoute = createProjectsRoute();
