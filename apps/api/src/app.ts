import { Hono } from "hono";
import { initializeAIServices } from "@life-os/ai";
import { authRoute } from "./routes/auth.js";
import { statusRoute } from "./routes/status.js";
import { homeRoute } from "./modules/home/route.js";
import { projectsRoute } from "./modules/projects/route.js";
import { notesRoute } from "./modules/notes/route.js";
import { tasksRoute } from "./modules/tasks/route.js";
import { chatRoute } from "./modules/chat/route.js";
import { analyticsRoute } from "./modules/analytics/route.js";
import { resolveUserIdFromRequest } from "./modules/common/auth.js";
import { toApiError, toErrorBody } from "./modules/common/errors.js";

try {
  initializeAIServices();
} catch (error) {
  console.error(
    "[api] failed to initialize AI services:",
    error instanceof Error ? error.message : String(error),
  );
}

export const app = new Hono();

const PUBLIC_PATHS = new Set(["/", "/status", "/api/status"]);

function isPublicPath(path: string) {
  if (PUBLIC_PATHS.has(path)) {
    return true;
  }

  if (path === "/api/auth" || path.startsWith("/api/auth/")) {
    return true;
  }

  return false;
}

app.get("/", (c) =>
  c.json({
    message: "Life-OS API is awake and mildly over-caffeinated.",
  }),
);

app.use("*", async (c, next) => {
  if (isPublicPath(c.req.path)) {
    await next();
    return;
  }

  try {
    await resolveUserIdFromRequest(c.req.raw);
    await next();
  } catch (error) {
    const apiError = toApiError(error);
    return c.json(toErrorBody(apiError), apiError.status);
  }
});

app.route("/", authRoute);
app.route("/", statusRoute);
app.route("/", homeRoute);
app.route("/", projectsRoute);
app.route("/", notesRoute);
app.route("/", tasksRoute);
app.route("/", chatRoute);
app.route("/", analyticsRoute);

export default app;
