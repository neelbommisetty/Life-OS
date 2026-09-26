import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { databaseUrl } from "../db/client.ts";
import { Tools } from "../tools.ts";
import { FakeCatalog } from "../media/catalog/adapter.ts";
import { createApi } from "./app.ts";
import { createClient } from "./client.ts";
import { ApiError } from "./protocol.ts";
import { GROUPS, OPERATIONS } from "./operations.ts";
import { serveTestApi } from "./testing.ts";
import { z } from "@hono/zod-openapi";

const token = "test-api-token-12345678901234567890";
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const clock = fixedClock("2026-09-17T19:00:00Z");
const ctx = { actor: "neel", reason: "API integration test", evidence: [] };

function mockApi() {
  let opened = 0;
  const fake: Record<string, unknown> = { clock, region: "US" };
  for (const [name, methods] of Object.entries(GROUPS)) {
    const group: Record<string, unknown> = {};
    for (const method of Object.keys(methods)) group[method] = async (...args: unknown[]) => ({ operation: `${name}.${method}`, args });
    if (name === "title.catalog") (fake.title as Record<string, unknown>).catalog = group;
    else fake[name] = group;
  }
  (fake.title as Record<string, unknown>).scoped = () => fake.title;
  const app = createApi({ token, tools: async () => { opened++; return fake as unknown as Tools; }, migrate: async () => {} });
  return { app, opened: () => opened };
}

async function post(app: ReturnType<typeof createApi>, operation: string, args: unknown[], extra = {}) {
  return app.request(`/v1/${operation}`, { method: "POST", headers: auth, body: JSON.stringify({ args, ...extra }) });
}

test("Hono authenticates before accessing data and rejects malformed requests and unknown operations", async () => {
  const { app, opened } = mockApi();
  for (const headers of [{}, { authorization: "Bearer wrong" }]) {
    const result = await app.request("/v1/task.list", { method: "POST", headers, body: '{"args":[]}' });
    assert.equal(result.status, 401);
    assert.equal((await result.json() as any).error.code, "unauthorized");
  }
  assert.equal(opened(), 0);
  for (const [operation, args, extra] of [
    ["task.get", [], {}], ["task.get", [1], {}], ["task.list", [], { timezone: "Mars/Olympus" }],
    ["task.list", [], { medium: "book" }], ["task.add", [{}, null], {}], ["task.list", ["bad"], {}],
    ["task.list", [{}, {}], {}], ["task.list", [], { db: "postgres://evil" }],
  ] as const) assert.equal((await post(app, operation, [...args], extra)).status, 400, operation);
  const malformed = await app.request("/v1/task.list", { method: "POST", headers: auth, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await post(app, "store.transaction", [])).status, 404);
  assert.equal((await post(app, "__proto__.constructor", [])).status, 404);
  assert.equal((await app.request("/v1/task.list", { headers: auth })).status, 404);
  assert.equal(opened(), 0);
});

test("every registered domain method is reachable over HTTP and the OpenAPI lists the complete surface", async () => {
  const { app } = mockApi();
  const response = await app.request("/openapi.json", { headers: auth });
  assert.equal(response.status, 200);
  const doc = await response.json() as { paths: Record<string, unknown> };
  assert.deepEqual(Object.keys(doc.paths).sort(), [...OPERATIONS.keys()].map((name) => `/v1/${name}`).sort());
  // Witness dispatch for every method, including methods without CLI commands.
  for (const [group, methods] of Object.entries(GROUPS)) for (const [method, shape] of Object.entries(methods)) {
    const args = shape.map((schema: z.ZodType) => {
      if (schema.isOptional()) return null;
      if (schema.safeParse("ref").success) return "ref";
      if (schema.safeParse(1).success) return 1;
      if (schema.safeParse([]).success) return [];
      return {};
    });
    const operation = `${group}.${method}`;
    const result = await post(app, operation, args);
    assert.equal(result.status, 200, operation);
    const body = await result.json() as any;
    assert.equal(body.result.operation, operation);
    assert.deepEqual(body.result.args, args); // JSON restores omitted slots as null.
  }
});

test("server exceptions use structured errors and do not expose stack or database credentials", async () => {
  const app = createApi({ token, tools: async () => { throw Object.assign(new Error("postgres://user:secret@host/database"), { code: "ECONNREFUSED" }); }, migrate: async () => { throw new TypeError("secret implementation detail"); } });
  const db = await post(app, "task.list", []);
  assert.equal(db.status, 503);
  assert.doesNotMatch(await db.text(), /secret|postgres:\/\//);
  const internal = await post(app, "system.migrate", []);
  assert.equal(internal.status, 500);
  assert.doesNotMatch(await internal.text(), /secret|TypeError|stack/);
});

const tmdb = new FakeCatalog({ source: "tmdb" });
let db: TestDb;
let api: Awaited<ReturnType<typeof serveTestApi>>;
before(async () => {
  db = await createTestDb();
  const url = `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${db.schema}`;
  api = await serveTestApi({ url, clock, catalogs: { tmdb, igdb: new FakeCatalog({ source: "igdb" }), openlibrary: new FakeCatalog({ source: "openlibrary" }) } });
});
after(async () => { await api?.close(); await db?.drop(); });

function client() { return createClient({ url: api.url, token: api.token }); }

test("independent HTTP clients share authoritative state, receipts, history and concurrency checks", async () => {
  const cli = client(), other = client();
  const key = { ...ctx, key: "api-shared-create" };
  const [first, replay] = await Promise.all([cli.task.add({ title: "Shared API task" }, key), other.task.add({ title: "Shared API task" }, key)]);
  assert.ok(first.ok && replay.ok);
  assert.deepEqual(first, replay);
  assert.deepEqual(await other.task.get(first.id), first.record);
  const [a, b] = await Promise.all([
    cli.task.update(first.id, { title: "Updated by CLI" }, { ...ctx, ifVersion: first.version }),
    other.task.update(first.id, { title: "Updated by another interface" }, { ...ctx, ifVersion: first.version }),
  ]);
  assert.equal([a, b].filter((receipt) => receipt.ok).length, 1);
  assert.equal((await other.task.history(first.id)).length, 2);
  const rejected = await other.task.add({ title: "Missing actor" }, {} as typeof ctx);
  assert.equal(rejected.ok, false);
  const dump = await cli.export();
  assert.equal(dump.tasks.filter((task) => task.id === first.id).length, 1);
  assert.ok((await other.indexes()).projects.some((project) => project.id === first.record.projectId));
  assert.ok(!JSON.stringify(dump).includes("refreshToken"));
});

test("batch atomicity, dry-run imports and explicit clearing survive the HTTP boundary", async () => {
  const tools = client();
  const added = await tools.task.add({ title: "Batch API task", due: { date: "2026-09-18" } }, ctx);
  assert.ok(added.ok);
  const batch = await tools.task.batch([
    { op: "update", id: added.id, input: { title: "Should roll back" } },
    { op: "update", id: "t_0000000000", input: { title: "Missing" } },
  ], ctx, { atomic: true });
  assert.ok(batch.some((receipt) => !receipt.ok));
  assert.equal((await tools.task.get(added.id))!.title, "Batch API task");
  const cleared = await tools.task.reschedule(added.id, null, ctx);
  assert.ok(cleared.ok);
  assert.equal(cleared.record.due, null);
  const imported = await tools.task.import([{ title: "Dry import via API" }], ctx, { dryRun: true });
  assert.equal(imported.dryRun, true);
  assert.equal((await tools.task.list({ text: "Dry import via API" })).length, 0);
  assert.deepEqual(await tools.views.upcoming(undefined, { from: "2026-09-17" }), await tools.views.upcoming(7, { from: "2026-09-17" }));
});

test("scoped titles and caller timezone are preserved without changing shared server settings", async () => {
  const tools = client();
  const movie = await tools.title.scoped("movie").add({ medium: "movie", name: "API title", lookup: false }, ctx);
  const book = await tools.title.scoped("book").add({ medium: "book", name: "API title", lookup: false }, ctx);
  assert.ok(movie.ok && book.ok);
  assert.equal((await tools.title.scoped("movie").get("API title"))!.id, movie.id);
  assert.equal((await tools.title.scoped("book").get("API title"))!.id, book.id);
  const tokyo = createClient({ url: api.url, token: api.token, timezone: "Asia/Tokyo" });
  assert.equal((await tokyo.views.today({ fresh: false })).date, "2026-09-18");
  assert.equal((await tools.views.today({ fresh: false })).date, "2026-09-17");
});

test("client reports unavailable/auth failures and never automatically retries a write", async () => {
  let requests = 0;
  const tools = createClient({ url: "http://127.0.0.1:1", token, fetch: async () => { requests++; throw new Error("lost response"); } });
  await assert.rejects(tools.task.add({ title: "Unknown outcome" }, ctx), (error: unknown) => error instanceof ApiError && error.code === "api_unavailable" && /may have completed/.test(error.message));
  assert.equal(requests, 1);
  const wrong = createClient({ url: api.url, token: "wrong" });
  await assert.rejects(wrong.task.list(), (error: unknown) => error instanceof ApiError && error.code === "unauthorized");
  assert.throws(() => createClient({ url: "http://example.com", token }), /HTTPS/);
  assert.throws(() => createClient({ url: "https://user:password@example.com", token }), /credentials/);
});

test("API account connection sessions deliver consent URLs, receipts, failures and idempotent pending retries", async () => {
  let opened = 0;
  let finish: (() => void) | undefined;
  const backend = { clock, region: "US", account: { add: async (input: { open(url: string): void }) => {
    opened++;
    input.open("https://accounts.example/consent");
    await new Promise<void>((resolve) => { finish = resolve; });
    return { ok: false, outcome: "rejected", issues: ["Fake provider rejected sign-in"] };
  } } } as unknown as Tools;
  const app = createApi({ token, tools: async () => backend, migrate: async () => {} });
  const args = [{ provider: "google" }, { ...ctx, key: "same-sign-in" }];
  const first = await (await post(app, "account.add", args)).json() as any;
  assert.equal(first.result.status, "pending");
  assert.equal(first.result.url, "https://accounts.example/consent");
  const replay = await (await post(app, "account.add", args)).json() as any;
  assert.equal(replay.result.id, first.result.id);
  assert.equal(opened, 1);
  finish!();
  const done = await (await post(app, "account.connection", [first.result.id])).json() as any;
  assert.equal(done.result.status, "complete");
  assert.equal(done.result.receipt.ok, false);
  assert.equal((await post(app, "account.connection", ["missing"])).status, 404);
  assert.equal((await post(app, "account.add", [{ provider: "google" }, {}])).status, 400);
});


test("catalog smoke operations resolve and fetch availability through the API without writing library records", async () => {
  tmdb.seed("movie", [{ externalId: "api-fixture", name: "Catalog API fixture", year: 2026 }]);
  const tools = client();
  const before = (await tools.export()).titles.length;
  const resolved = await tools.catalog.resolve("movie", "Catalog API fixture", { year: 2026 });
  assert.equal(resolved.outcome, "linked");
  assert.deepEqual(await tools.catalog.availability("movie", "api-fixture"), { outcome: "ok", availability: [] });
  const missing = await tools.catalog.availability("movie", "missing");
  assert.equal(missing.outcome, "failed");
  if (missing.outcome === "failed") assert.equal(typeof missing.error, "string");
  assert.equal((await tools.export()).titles.length, before);
});
