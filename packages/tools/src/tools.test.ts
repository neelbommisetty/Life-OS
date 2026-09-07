import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { Ctx, Receipt } from "./contract.ts";
import { createPool, databaseUrl } from "./db/client.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { PgStore } from "./store.ts";
import { defaultTimezone } from "./time.ts";
import { Tools, systemClock } from "./tools.ts";

const clock = fixedClock("2026-09-06T12:00:00Z");
const neel: Ctx = { actor: "neel" };

let db: TestDb;
let tools: Tools;
before(async () => {
  db = await createTestDb();
  tools = new Tools(db.store, clock);
});
after(() => db.drop());

/** Assert a receipt is ok and hand back its record. */
function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

const tablesIn = async (pool: pg.Pool, schema: string): Promise<string[]> =>
  (await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = $1 order by 1", [schema])).rows.map((row) => row.table_name);

/** A URL whose every connection has search_path set to the throwaway schema, so open() never sees public. */
const testSchemaUrl = (): string => `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${db.schema}`;

const isConnectionRefused = (error: unknown): boolean => {
  const errors = error instanceof AggregateError ? error.errors : [error];
  return errors.some((e) => e instanceof Error && ("code" in e ? e.code === "ECONNREFUSED" : /ECONNREFUSED/.test(e.message)));
};

test("the constructor wires every operation group and the views over one store and clock", async () => {
  assert.equal(tools.store, db.store);
  assert.equal(tools.clock, clock);

  const health = okRecord(await tools.project.add({ name: "Health", labels: ["health"] }, neel));
  const plan = okRecord(await tools.section.add({ project: "health", name: "Plan" }, neel));
  const task = okRecord(await tools.task.add({ title: "Book the dentist", project: "health", section: "Plan", due: { date: "2026-09-06" } }, neel));
  assert.equal(task.projectId, health.id);
  assert.equal(task.sectionId, plan.id);
  assert.equal(task.status, "accepted");

  const label = await tools.label.get("health");
  assert.ok(label, "the project's label was registered on the fly");
  okRecord(await tools.filter.add({ name: "Today", query: "today" }, neel));

  assert.deepEqual((await tools.views.filter("Today")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.today()).due.map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.label("health")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.search("DENTIST")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.task.history(task.id)).map((e) => e.op), ["task.add"]);
  assert.deepEqual((await tools.project.tree()).map((node) => node.project.slug), ["inbox", "health"]);
});

test("export returns every collection, deleted rows included, and the whole log", async () => {
  const scrap = okRecord(await tools.task.add({ title: "Scrap this", allowDuplicate: true }, neel));
  const deletedTask = okRecord(await tools.task.delete(scrap.id, neel));
  const spare = okRecord(await tools.label.add({ name: "spare" }, neel));
  okRecord(await tools.label.delete("spare", neel));
  const oldFilter = okRecord(await tools.filter.add({ name: "Old filter", query: "overdue" }, neel));
  okRecord(await tools.filter.delete("Old filter", neel));
  const gone = okRecord(await tools.project.add({ name: "Gone" }, neel));
  const goneSection = okRecord(await tools.section.add({ project: "gone", name: "Was here" }, neel));
  okRecord(await tools.project.delete("gone", neel, { contents: "delete" }));

  const out = await tools.export();
  assert.equal(out.exportedAt, "2026-09-06T12:00:00Z");
  assert.deepEqual(Object.keys(out), ["exportedAt", "projects", "sections", "labels", "filters", "tasks", "log"]);

  const find = <T extends { id: string; deletedAt: string | null }>(list: T[], id: string): T => {
    const record = list.find((r) => r.id === id);
    assert.ok(record, `${id} is exported`);
    return record;
  };
  assert.ok(find(out.tasks, deletedTask.id).deletedAt, "a deleted task is exported with its deletedAt");
  assert.ok(find(out.labels, spare.id).deletedAt);
  assert.ok(find(out.filters, oldFilter.id).deletedAt);
  assert.ok(find(out.projects, gone.id).deletedAt);
  assert.ok(find(out.sections, goneSection.id).deletedAt);
  assert.ok(out.projects.some((p) => p.system), "the Inbox is exported");
  assert.ok(out.tasks.some((t) => t.title === "Book the dentist" && !t.deletedAt), "live rows too");

  const everything = await db.store.read(async (tx) => ({
    projects: (await tx.all("project", { includeDeleted: true })).length,
    sections: (await tx.all("section", { includeDeleted: true })).length,
    labels: (await tx.all("label", { includeDeleted: true })).length,
    filters: (await tx.all("filter", { includeDeleted: true })).length,
    tasks: (await tx.all("task", { includeDeleted: true })).length,
    log: await tx.allLog(),
  }));
  assert.equal(out.projects.length, everything.projects);
  assert.equal(out.sections.length, everything.sections);
  assert.equal(out.labels.length, everything.labels);
  assert.equal(out.filters.length, everything.filters);
  assert.equal(out.tasks.length, everything.tasks);
  assert.deepEqual(out.log, everything.log, "the log is exported whole, in sequence");
  assert.ok(out.log.length >= 10);

  // With a frozen clock every createdAt is equal, so the createdAt-then-id order reduces to id order.
  for (const list of [out.projects, out.sections, out.labels, out.filters, out.tasks]) {
    const listed = list.map((r) => r.id);
    assert.deepEqual(listed, [...listed].sort(), "each collection is in a stable order");
  }
});

test("the default clock is the wall clock in the default timezone", () => {
  const plain = new Tools(db.store);
  assert.equal(plain.clock.timezone, defaultTimezone());
  assert.ok(Math.abs(plain.clock.now().getTime() - Date.now()) < 5000);
  assert.equal(systemClock().timezone, defaultTimezone());
});

test("open connects to the given url, skips migration when told, works, and closes once", async () => {
  const plain = createPool();
  let publicBefore: string[];
  try {
    publicBefore = await tablesIn(plain, "public");
  } finally {
    await plain.end();
  }

  const opened = await Tools.open({ url: testSchemaUrl(), migrate: false, clock });
  try {
    assert.ok(opened.store instanceof PgStore);
    assert.equal(opened.clock, clock);
    const task = okRecord(await opened.task.add({ title: "Added through open()", allowDuplicate: true }, neel));
    const stored = await db.store.read((tx) => tx.get("task", task.id));
    assert.deepEqual(stored, task, "open() wrote into the schema its url points at");
    assert.deepEqual((await opened.views.search("through open")).map((t) => t.id), [task.id]);
    assert.equal((await opened.export()).tasks.some((t) => t.id === task.id), true);
  } finally {
    await opened.close();
  }
  await opened.close(); // idempotent
  await assert.rejects(opened.task.list(), /pool|end/i, "a closed Tools has no connections");

  const again = createPool();
  try {
    assert.deepEqual(await tablesIn(again, "public"), publicBefore, "nothing touched the public schema");
  } finally {
    await again.end();
  }
});

test("open rejects when the database is unreachable", async () => {
  const unreachable = "postgres://life:life@127.0.0.1:1/life";
  await assert.rejects(Tools.open({ url: unreachable, clock }), isConnectionRefused, "migrate: true connects eagerly and surfaces the failure");

  const lazy = await Tools.open({ url: unreachable, migrate: false, clock });
  try {
    await assert.rejects(lazy.task.list(), isConnectionRefused, "migrate: false connects on first use");
  } finally {
    await lazy.close();
  }
});
