import { Hono } from "hono";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { handleRouteError, readJsonRequest } from "../common/http.js";
import {
  createTask,
  deleteTask,
  listArchivedTasks,
  listTasks,
  updateTask,
  type TasksDb,
} from "./service.js";

type TasksRouteDependencies = {
  getDb?: () => Promise<TasksDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createTasksRoute(dependencies: TasksRouteDependencies = {}) {
  const tasksRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<TasksDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  const listHandler = async (request: Request) => {
    const url = new URL(request.url);
    const input = {
      search: url.searchParams.get("search") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    };

    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listTasks({
      db,
      userId,
      input: input as {
        search?: string;
        status?: "TODO" | "IN_PROGRESS" | "DONE";
        projectId?: string;
      },
    });
  };

  const listArchivedHandler = async (request: Request) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return listArchivedTasks({ db, userId });
  };

  const createHandler = async (request: Request) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return createTask({
      db,
      userId,
      input: body as {
        title: string;
        description?: string;
        status?: "TODO" | "IN_PROGRESS" | "DONE";
        priority?: "LOW" | "MEDIUM" | "HIGH";
        dueDate?: string | null;
        projectId?: string;
      },
    });
  };

  const updateHandler = async (request: Request, id: string) => {
    const body = await readJsonRequest(request);
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return updateTask({
      db,
      userId,
      input: {
        ...(body as Record<string, unknown>),
        id,
      } as {
        id: string;
        title?: string;
        description?: string;
        status?: "TODO" | "IN_PROGRESS" | "DONE";
        priority?: "LOW" | "MEDIUM" | "HIGH";
        dueDate?: string | null;
      },
    });
  };

  const deleteHandler = async (request: Request, id: string) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return deleteTask({ db, userId, input: { id } });
  };
  tasksRoute.get("/tasks", async (c) => {
    try {
      return c.json(await listHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  tasksRoute.get("/tasks/archived", async (c) => {
    try {
      return c.json(await listArchivedHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  tasksRoute.post("/tasks", async (c) => {
    try {
      return c.json(await createHandler(c.req.raw), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  tasksRoute.patch("/tasks/:id", async (c) => {
    try {
      return c.json(await updateHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  tasksRoute.delete("/tasks/:id", async (c) => {
    try {
      return c.json(await deleteHandler(c.req.raw, c.req.param("id")));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
  return tasksRoute;
}

export const tasksRoute = createTasksRoute();
