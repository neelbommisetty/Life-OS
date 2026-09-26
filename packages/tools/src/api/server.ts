import { OAuthCallback } from "./oauth-callback.ts";
import { GoogleAdapter } from "../calendar/google/index.ts";
import { CredentialStore } from "../calendar/credentials.ts";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { Tools } from "../tools.ts";
import { createPool, createDb } from "../db/client.ts";
import { migrate } from "../db/migrate.ts";
import { createApi } from "./app.ts";
import { serverToken } from "./config.ts";

try { process.loadEnvFile(fileURLToPath(new URL("../../../../.env", import.meta.url))); } catch {}
const token = await serverToken(process.env);
const hostname = process.env.LIFE_API_HOST ?? "127.0.0.1";
const port = Number(process.env.LIFE_API_PORT ?? 4319);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid LIFE_API_PORT");
const callback = process.env.LIFE_GOOGLE_REDIRECT_URI ? new OAuthCallback(process.env.LIFE_GOOGLE_REDIRECT_URI) : undefined;
const credentials = new CredentialStore();
const adapters = { google: new GoogleAdapter({ credentials, callback }) };
let opened: Promise<Tools> | undefined;
const tools = () => opened ??= Tools.open({ migrate: false, credentials, adapters }).catch((error: unknown) => { opened = undefined; throw error; });
const app = createApi({
  token, tools, oauthCallback: callback,
  migrate: async () => { const pool = createPool(); try { await migrate(createDb(pool)); } finally { await pool.end(); } },
  diagnostics: { env: process.env },
  allowedOrigins: (process.env.LIFE_API_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
});
const server = serve({ fetch: app.fetch, hostname, port }, () => console.log(`Life-OS API listening on http://${hostname}:${port}`));
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  if (closing) return;
  closing = true;
  callback?.close();
  server.close(() => { void opened?.then((value) => value.close()).catch(() => {}); });
});
