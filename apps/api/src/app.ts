import { Hono } from "hono";
import { initializeAIServices } from "@life-os/ai";
import { createLogger } from "@life-os/logger";
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

const appLogger = createLogger("api");
const httpLogger = createLogger("api:http");
const REQUEST_ID_HEADER = "x-request-id";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getRequestId(request: Request) {
  const headerValue = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (headerValue) {
    return headerValue;
  }

  return crypto.randomUUID();
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",", 1);
    return firstIp?.trim();
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim();
}

try {
  initializeAIServices();
} catch (error) {
  appLogger.error("Failed to initialize AI services", {
    error: getErrorMessage(error),
  });
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

app.use("*", async (c, next) => {
  const requestId = getRequestId(c.req.raw);
  const start = Date.now();
  const requestUrl = new URL(c.req.url);

  httpLogger.info("Incoming request", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    query: requestUrl.search || undefined,
    ip: getClientIp(c.req.raw),
    userAgent: c.req.header("user-agent") ?? undefined,
  });

  try {
    await next();
  } catch (error) {
    httpLogger.error("Unhandled request error", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      durationMs: Date.now() - start,
      error: getErrorMessage(error),
    });
    throw error;
  } finally {
    if (!c.res.headers.has(REQUEST_ID_HEADER)) {
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
    }

    const context = {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    };

    if (c.res.status >= 500) {
      httpLogger.error("Request completed with server error", context);
    } else if (c.res.status >= 400) {
      httpLogger.warn("Request completed with client error", context);
    } else {
      httpLogger.info("Request completed", context);
    }
  }
});

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

app.get("/", (c) =>
  c.json({
    message: "Life-OS API is awake and mildly over-caffeinated.",
  }),
);

app.route("/", authRoute);
app.route("/", statusRoute);
app.route("/", homeRoute);
app.route("/", projectsRoute);
app.route("/", notesRoute);
app.route("/", tasksRoute);
app.route("/", chatRoute);
app.route("/", analyticsRoute);

export default app;
