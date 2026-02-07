import { Hono } from "hono";
import { getDbClient } from "../common/db.js";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { handleRouteError } from "../common/http.js";
import {
  getRecentNotes,
  getRecentProjects,
  getUpcomingTasks,
  type HomeDb,
} from "./service.js";

type HomeRouteDependencies = {
  getDb?: () => Promise<HomeDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createHomeRoute(dependencies: HomeRouteDependencies = {}) {
  const homeRoute = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<HomeDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  const recentProjectsHandler = async (request: Request) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getRecentProjects({ db, userId });
  };

  const upcomingTasksHandler = async (request: Request) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getUpcomingTasks({ db, userId });
  };

  const recentNotesHandler = async (request: Request) => {
    const [db, userId] = await Promise.all([getDb(), getUserId(request)]);
    return getRecentNotes({ db, userId });
  };

  homeRoute.get("/home/recent-projects", async (c) => {
    try {
      return c.json(await recentProjectsHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  homeRoute.get("/api/home/recent-projects", async (c) => {
    try {
      return c.json(await recentProjectsHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  homeRoute.get("/home/upcoming-tasks", async (c) => {
    try {
      return c.json(await upcomingTasksHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  homeRoute.get("/api/home/upcoming-tasks", async (c) => {
    try {
      return c.json(await upcomingTasksHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  homeRoute.get("/home/recent-notes", async (c) => {
    try {
      return c.json(await recentNotesHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  homeRoute.get("/api/home/recent-notes", async (c) => {
    try {
      return c.json(await recentNotesHandler(c.req.raw));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return homeRoute;
}

export const homeRoute = createHomeRoute();
