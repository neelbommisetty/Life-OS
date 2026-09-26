import { randomUUID } from "node:crypto";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { ProviderRejected, ProviderUnavailable } from "../calendar/adapter.ts";
import { NeedsReauth } from "../calendar/google/oauth.ts";
import { ctxSchema, medium as mediumSchema, type Medium } from "../contract.ts";
import { CatalogUnavailable, CatalogUnconfigured, HttpError } from "../media/catalog/adapter.ts";
import { resolve, resolveAvailability } from "../media/lookup.ts";
import { Tools } from "../tools.ts";
import { isValidTimezone } from "../time.ts";
import { OPERATIONS, parseArgs } from "./operations.ts";
import { diagnosticsSetup, runDoctor, type DiagnosticsOptions } from "./diagnostics.ts";
import { isDatabaseError, isInternalError, messageOf } from "./errors.ts";
import { ApiError, type ApiFailure, type Connection } from "./protocol.ts";

import type { OAuthCallback } from "./oauth-callback.ts";

export type ApiOptions = {
  oauthCallback?: OAuthCallback;
  token: string;
  /** Server-owned configuration. Never accepted in a request body. */
  tools: () => Promise<Tools>;
  migrate: () => Promise<void>;
  diagnostics?: DiagnosticsOptions;
  allowedOrigins?: string[];
};

function failure(error: unknown): ApiFailure {
  if (error instanceof ApiError) return { code: error.code, message: error.message, ...(error.issues ? { issues: error.issues } : {}) };
  if (error instanceof z.ZodError) return { code: "invalid_request", message: "Invalid API arguments", issues: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  if (isDatabaseError(error)) return { code: "db_unavailable", message: "The API server cannot access its database. Run life doctor and check the server configuration." };
  if (error instanceof ProviderUnavailable) return { code: "provider_unavailable", message: messageOf(error) };
  if (error instanceof ProviderRejected) return { code: "provider_rejected", message: messageOf(error) };
  if (error instanceof NeedsReauth) return { code: "needs_reauth", message: messageOf(error) };
  if (error instanceof CatalogUnavailable) return { code: "catalog_unavailable", message: messageOf(error) };
  if (error instanceof CatalogUnconfigured) return { code: "catalog_unconfigured", message: `${error.variable} is not configured on the API server` };
  if (error instanceof HttpError) return { code: "rejected", message: messageOf(error) };
  if (isInternalError(error)) return { code: "internal", message: "Internal API error" };
  return { code: "rejected", message: messageOf(error) };
}

const envelope = z.object({ ok: z.literal(true), result: z.unknown() });
const errorEnvelope = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string(), issues: z.array(z.string()).optional() }) });
const accountInput = z.strictObject({ provider: z.literal("google"), label: z.string().nullable().optional(), timeoutMs: z.number().int().min(100).max(180_000).optional() });
const doctorInput = z.strictObject({ online: z.boolean().optional(), actor: z.string().optional() });

/** Hono owns routing, auth, CORS, request limits and OpenAPI generation. */
export function createApi(options: ApiOptions) {
  if (!options.token || options.token.length < 32) throw new Error("API token must contain at least 32 characters");
  const connectionKeys = new Map<string, string>();
  const sessions = new Map<string, { connection: Connection; expiresAt: number }>();
  const app = new OpenAPIHono({ defaultHook: (result, c) => {
    if (!result.success) return c.json({ ok: false as const, error: failure(result.error) }, 400);
  } });
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  app.use("*", cors({ origin: options.allowedOrigins ?? [], allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"] }));
  if (options.oauthCallback) app.get("/oauth/google/callback", (c) => {
    const result = options.oauthCallback!.receive(new URL(c.req.url));
    return c.text(result.message, result.ok ? 200 : 400);
  });
  app.use("*", bearerAuth({ token: options.token }));
  app.use("*", bodyLimit({ maxSize: 10 * 1024 * 1024, onError: (c) => c.json({ ok: false, error: { code: "invalid_request", message: "Request exceeds 10 MB" } }, 413) }));
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer" });
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: error.status === 401 ? "unauthorized" : "invalid_request", message: error.status === 401 ? "API bearer token required" : "Invalid HTTP request" } }, error.status);
    }
    const detail = failure(error);
    const status = detail.code === "internal" ? 500 : detail.code.endsWith("unavailable") ? 503 : detail.code === "not_found" ? 404 : 400;
    return c.json({ ok: false, error: detail }, status);
  });
  app.notFound((c) => c.json({ ok: false, error: { code: "not_found", message: "Unknown API operation" } }, 404));

  async function dispatch(operation: string, args: unknown[], timezone?: string, medium?: Medium): Promise<unknown> {
    if (operation === "system.doctor") {
      const input = doctorInput.parse(args[0] ?? {});
      return runDoctor(diagnosticsSetup(options.diagnostics ?? {}, { ...input, timezone }));
    }
    if (operation === "system.migrate") { await options.migrate(); return { migrated: true }; }
    if (operation === "account.connection") {
      const entry = sessions.get(args[0] as string);
      if (!entry || Date.now() > entry.expiresAt) throw new ApiError({ code: "not_found", message: "Connection session expired or unknown; check account.list before starting again" });
      return entry.connection;
    }
    const base = await options.tools();
    // Per-request timezone; server time and shared connections remain authoritative.
    const tools = timezone && timezone !== base.clock.timezone
      ? new Tools(base.store, { now: () => base.clock.now(), timezone }, { adapters: base.adapters, credentials: base.credentials, catalogs: base.catalogs, region: base.region })
      : base;
    if (operation === "system.info") return { version: "1", timezone: tools.clock.timezone, region: tools.region };
    if (operation === "export") return tools.export();
    if (operation === "catalog.resolve" || operation === "catalog.availability") {
      const medium = mediumSchema.parse(args[0]);
      const text = z.string().min(1).max(4000).parse(args[1]);
      const opts = z.strictObject({ year: z.number().int().min(1).max(9999).optional(), externalId: z.string().min(1).max(200).optional() }).parse(args[2] ?? {});
      const deps = { catalogs: tools.catalogs, region: tools.region, ...opts };
      const result = operation === "catalog.resolve" ? await resolve(medium, text, deps) : await resolveAvailability(medium, text, deps);
      return result.outcome === "failed" ? { ...result, error: result.error.message } : result;
    }
    if (operation === "display.indexes") return tools.store.read(async (tx) => ({
      projects: await tx.all("project", { includeDeleted: true }), calendars: await tx.all("calendar", { includeDeleted: true }), accounts: await tx.all("account", { includeDeleted: true }),
    }));
    if (operation === "account.add") {
      const input = accountInput.parse(args[0]);
      const ctx = ctxSchema.parse(args[1]);
      for (const [id, entry] of sessions) if (entry.expiresAt < Date.now()) {
        sessions.delete(id);
        for (const [key, sessionId] of connectionKeys) if (sessionId === id) connectionKeys.delete(key);
      }
      if (ctx.key) {
        const existing = connectionKeys.get(ctx.key);
        if (existing) return sessions.get(existing)!.connection;
      }
      if (sessions.size >= 32) throw new ApiError({ code: "rejected", message: "Too many connection sessions; wait for existing sessions to expire" });
      const connection: Connection = { id: randomUUID(), status: "pending" };
      sessions.set(connection.id, { connection, expiresAt: Date.now() + 15 * 60_000 });
      if (ctx.key) connectionKeys.set(ctx.key, connection.id);
      // Do not hold the HTTP connection while a person signs in. The provider
      // validates OAuth state and PKCE; credentials never cross this API.
      void tools.account.add({ ...input, open: (url) => { connection.url = url; } }, ctx).then(
        (receipt) => { connection.status = "complete"; connection.receipt = receipt;  },
        (error: unknown) => { connection.status = "failed"; connection.error = failure(error);  },
      );
      return connection;
    }
    const parts = operation.split(".");
    let target: unknown = tools;
    for (const part of parts.slice(0, -1)) {
      target = (target as Record<string, unknown>)[part];
      if (part === "title" && medium) target = tools.title.scoped(medium);
    }
    const method = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[parts.at(-1)!]!;
    return method.apply(target, args);
  }

  for (const [operation, shape] of OPERATIONS) {
    // Optional positional slots accept null on the wire. parseArgs restores
    // undefined before invoking domain methods, keeping nullable fields intact.
    const args = z.tuple(shape.map((item) => item.isOptional() ? item.nullable() : item) as [z.ZodType, ...z.ZodType[]]);
    const request = z.strictObject({ args, timezone: z.string().refine(isValidTimezone, "Expected an IANA timezone").optional(), medium: mediumSchema.optional() });
    app.openapi(createRoute({
      method: "post", path: `/v1/${operation}`, operationId: operation.replaceAll(".", "_"), security: [{ bearerAuth: [] }],
      summary: operation, description: "Arguments follow the shared tools method signature. Domain validation returns receipts including rejections, duplicate candidates, and needs. Optional argument slots may be null. medium scopes title operations.",
      request: { body: { required: true, content: { "application/json": { schema: request } } } },
      responses: {
        200: { description: "Operation result (inspect domain receipt.ok for writes)", content: { "application/json": { schema: envelope } } },
        400: { description: "Invalid arguments or rejected operation", content: { "application/json": { schema: errorEnvelope } } },
        401: { description: "Missing or invalid bearer token", content: { "application/json": { schema: errorEnvelope } } },
        503: { description: "Backend or provider unavailable", content: { "application/json": { schema: errorEnvelope } } },
      },
    }), async (c) => {
      const body = c.req.valid("json");
      if (body.medium && !operation.startsWith("title.")) throw new ApiError({ code: "invalid_request", message: "medium only applies to title operations" });
      const result = await dispatch(operation, parseArgs(operation, body.args), body.timezone, body.medium);
      return c.json({ ok: true as const, result }, 200);
    });
  }
  app.doc31("/openapi.json", { openapi: "3.1.0", info: { title: "Life-OS API", version: "1.0.0" } });
  return app;
}
