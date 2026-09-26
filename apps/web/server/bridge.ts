import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

// The website is an HTTP client, never a database/provider client. Only the
// operations used by the todo slice are exposed by its same-origin bridge.
const operations = new Set([
  "task.list",
  "task.get",
  "task.add",
  "task.update",
  "task.move",
  "task.complete",
  "task.uncomplete",
  "task.delete",
  "task.restore",
  "task.accept",
  "task.start",
  "task.note",
  "project.tree",
  "project.add",
  "project.update",
  "project.archive",
  "section.add",
  "section.update",
  "label.list",
  "label.add",
  "filter.list",
  "filter.add",
  "filter.run",
  "views.label",
  "views.search",
]);
export type BridgeOptions = {
  url: string;
  token: string;
  origins: string[];
  fetch?: typeof fetch;
};
export function createBridge(options: BridgeOptions) {
  const upstream = new URL(options.url);
  if (
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    !["http:", "https:"].includes(upstream.protocol) ||
    (upstream.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(upstream.hostname))
  ) {
    throw new Error(
      "LIFE_API_URL must be an HTTPS URL or a loopback HTTP URL without credentials, query, or fragment.",
    );
  }
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (
      !options.origins.some((value) => new URL(value).host === host) ||
      !origin ||
      !options.origins.includes(origin) ||
      (c.req.header("sec-fetch-site") &&
        c.req.header("sec-fetch-site") !== "same-origin")
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: "unauthorized",
            message: "Open Life-OS from its local website address.",
          },
        },
        403,
      );
    }
    if (!c.req.header("content-type")?.startsWith("application/json"))
      return c.json(
        {
          ok: false,
          error: { code: "invalid_request", message: "JSON required." },
        },
        415,
      );
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 1_048_576 }));
  app.post("/api/v1/:operation", async (c) => {
    const operation = c.req.param("operation");
    if (!operations.has(operation))
      return c.json(
        {
          ok: false,
          error: { code: "not_found", message: "Unknown todo operation." },
        },
        404,
      );
    if (!options.token)
      return c.json(
        {
          ok: false,
          error: {
            code: "api_unavailable",
            message: "Start the Life-OS API, then restart the website.",
          },
        },
        503,
      );
    try {
      const response = await (options.fetch ?? fetch)(
        `${upstream.href.replace(/\/$/, "")}/v1/${operation}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.token}`,
          },
          body: await c.req.text(),
        },
      );
      return new Response(response.body, {
        status: response.status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    } catch {
      return c.json(
        {
          ok: false,
          error: {
            code: "api_unavailable",
            message:
              "The API is unavailable. A change may have saved; refresh before trying again.",
          },
        },
        503,
      );
    }
  });
  return app;
}
