import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { Tools, type ToolsOptions } from "../tools.ts";
import { createPool, createDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { createApi } from "./app.ts";
import type { DiagnosticsOptions } from "./diagnostics.ts";

/** Real HTTP, isolated database supplied by the caller, injected providers. */
export async function serveTestApi(options: ToolsOptions & DiagnosticsOptions) {
  const token = "test-only-api-token-not-a-real-secret";
  let opened: Promise<Tools> | undefined;
  const app = createApi({
    token,
    tools: () => opened ??= Tools.open({ ...options, migrate: false }),
    migrate: async () => { const pool = createPool(options.url); try { await migrate(createDb(pool)); } finally { await pool.end(); } },
    diagnostics: options,
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { app, url, token, async close() {
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); if ("closeIdleConnections" in server) server.closeIdleConnections(); });
    await opened?.then((tools) => tools.close()).catch(() => {});
  } };
}
