import type { AccountAddInput, AccountAddReceipt } from "../calendar/accounts.ts";
import type { Ctx, Medium } from "../contract.ts";
import type { TitleOps } from "../media/titles.ts";
import { ApiError, type ApiFailure, type Connection, type ToolsClient } from "./protocol.ts";
export { ApiError } from "./protocol.ts";
export type { ToolsClient } from "./protocol.ts";

export type ClientOptions = {
  url: string;
  token: string;
  timezone?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/** A browser/Node compatible client. Only HTTP crosses the backend boundary.
 * Mutations are never retried automatically: a lost response may have committed.
 */
export function createClient(options: ClientOptions): ToolsClient {
  const base = new URL(options.url);
  if (base.username || base.password || base.search || base.hash) throw new Error("API URL must not include credentials, query, or fragment");
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("API URL must use HTTP or HTTPS");
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) throw new Error("Remote API connections require HTTPS");
  const request = options.fetch ?? globalThis.fetch;
  async function call<T>(operation: string, args: unknown[], medium?: Medium): Promise<T> {
    let response: Response;
    try {
      response = await request(`${base.href.replace(/\/$/, "")}/v1/${operation}`, {
        method: "POST", redirect: "error",
        headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
        body: JSON.stringify({ args, ...(options.timezone ? { timezone: options.timezone } : {}), ...(medium ? { medium } : {}) }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      });
    } catch {
      throw new ApiError({ code: "api_unavailable", message: "Life-OS API could not be reached or the response was lost. A write may have completed; read back its state or retry with the same idempotency key. Start the server with `bun run api` and check LIFE_API_URL." });
    }
    let body: { ok: boolean; result?: T; error?: ApiFailure };
    try { body = await response.json() as typeof body; } catch {
      throw new ApiError({ code: "api_unavailable", message: `API returned a non-JSON response (${response.status}); a write may have completed.` });
    }
    if (!response.ok || !body.ok) throw new ApiError(body.error ?? { code: "internal", message: `API request failed (${response.status})` });
    return body.result as T;
  }
  // Adapt the existing typed domain interface without importing backend code.
  // The server's explicit operation registry is the authority on callable names.
  function group(path: string, medium?: Medium): unknown {
    return new Proxy({}, { get(_target, method) {
      if (typeof method !== "string" || method === "then") return undefined;
      if (path === "title" && method === "scoped") return (scope: Medium) => group(path, scope);
      if (path === "title" && method === "catalog") return group("title.catalog", medium);
      return (...args: unknown[]) => call(`${path}.${method}`, args, medium);
    } });
  }
  async function addAccount(input: AccountAddInput, ctx: Ctx): Promise<AccountAddReceipt> {
    const { open, ...wireInput } = input;
    let connection = await call<Connection>("account.add", [wireInput, ctx]);
    let opened = false;
    const deadline = Date.now() + (input.timeoutMs ?? 180_000) + 60_000;
    while (true) {
      if (connection.url && !opened) { open(connection.url); opened = true; }
      if (connection.status === "complete") return connection.receipt!;
      if (connection.status === "failed") throw new ApiError(connection.error!);
      if (Date.now() > deadline) throw new ApiError({ code: "api_unavailable", message: `Sign-in is still pending (${connection.id}). Query account.connection with this id before starting another sign-in.` });
      await new Promise((resolve) => setTimeout(resolve, 250));
      connection = await call<Connection>("account.connection", [connection.id]);
    }
  }
  return {
    task: group("task"), project: group("project"), section: group("section"), label: group("label"), filter: group("filter"),
    calendar: group("calendar"), event: group("event"), views: group("views"), title: group("title") as TitleOps, media: group("media"),
    account: new Proxy(group("account") as ToolsClient["account"], { get(target, key) { return key === "add" ? addAccount : Reflect.get(target, key); } }),
    catalog: group("catalog"),
    export: () => call("export", []), indexes: () => call("display.indexes", []), info: () => call("system.info", []),
    doctor: (opts) => call("system.doctor", [opts]), migrate: () => call("system.migrate", []), close: async () => {},
  } as ToolsClient;
}
