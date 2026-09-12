import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createDb, createPool, databaseUrl } from "./client.ts";
import { migrate } from "./migrate.ts";
import { createTestDb, fixedClock, type TestDb } from "./testing.ts";

const EXPECTED_TABLES = ["__drizzle_migrations", "accounts", "calendars", "events", "filters", "labels", "log", "projects", "receipts", "sections", "tasks", "titles"];
const EXPECTED_INDEXES = [
  "events_calendar_idx",
  "events_external_id_idx",
  "events_master_idx",
  "events_start_at_idx",
  "events_start_date_idx",
  "log_record_idx",
  "tasks_due_date_idx",
  "tasks_project_idx",
  "tasks_status_idx",
  "titles_external_id_idx",
  "titles_medium_idx",
  "titles_name_idx",
  "titles_ownership_idx",
  "titles_status_idx",
];

const tablesIn = async (pool: pg.Pool | pg.Client, schema: string) =>
  (await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = $1 order by 1", [schema])).rows.map((row) => row.table_name);

let db: TestDb;
let publicTablesBefore: string[];

before(async () => {
  const plain = createPool();
  try {
    publicTablesBefore = await tablesIn(plain, "public");
  } finally {
    await plain.end();
  }
  db = await createTestDb();
});
after(() => db.drop());

test("the migration creates every table and index in the throwaway schema, and nothing in public", async () => {
  assert.match(db.schema, /^t_[0-9a-f]{12}$/);
  assert.deepEqual(await tablesIn(db.pool, db.schema), EXPECTED_TABLES);
  const indexes = await db.pool.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = $1 and indexname like '%\\_idx' order by 1", [db.schema]);
  assert.deepEqual(indexes.rows.map((row) => row.indexname), EXPECTED_INDEXES);
  const expression = await db.pool.query<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = $1 and indexname = 'tasks_due_date_idx'", [db.schema]);
  assert.match(expression.rows[0]!.indexdef, /\("json" -> 'due'::text\) ->> 'date'::text/);
  assert.deepEqual(await tablesIn(db.pool, "public"), publicTablesBefore);
});

test("the library migration adds the titles table with its five expression indexes", async () => {
  const columns = await db.pool.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = $1 and table_name = 'titles' order by ordinal_position",
    [db.schema],
  );
  assert.deepEqual(columns.rows.map((row) => row.column_name), ["id", "version", "json", "updated_at", "deleted_at"]);
  const defs = await db.pool.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = 'titles' and indexname like '%\\_idx' order by 1", [db.schema]);
  const byName = new Map(defs.rows.map((row) => [row.indexname, row.indexdef]));
  assert.equal(byName.size, 5);
  assert.match(byName.get("titles_name_idx")!, /lower\(\("json" ->> 'name'::text\)\)/);
  assert.match(byName.get("titles_external_id_idx")!, /\("json" -> 'catalog'::text\) ->> 'externalId'::text/);
  assert.match(byName.get("titles_medium_idx")!, /"json" ->> 'medium'::text/);
  assert.match(byName.get("titles_status_idx")!, /"json" ->> 'status'::text/);
  assert.match(byName.get("titles_ownership_idx")!, /"json" ->> 'ownership'::text/);
});

test("every pooled connection has search_path set to the schema", async () => {
  const checks = await Promise.all(
    Array.from({ length: 4 }, () => db.pool.query<{ schemas: string[] }>("select current_schemas(false)::text[] as schemas")),
  );
  for (const check of checks) assert.deepEqual(check.rows[0]!.schemas, [db.schema]);
});

test("migrate is idempotent on the same schema", async () => {
  await migrate(createDb(db.pool), { schema: db.schema });
  assert.deepEqual(await tablesIn(db.pool, db.schema), EXPECTED_TABLES);
  const applied = await db.pool.query<{ n: string }>("select count(*)::text as n from __drizzle_migrations");
  assert.equal(applied.rows[0]!.n, "3");
});

test("migrate over a single client sets its search_path and migrates that schema", async () => {
  const schema = `t_${db.schema.slice(2, 8)}client`;
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await migrate(createDb(client), { schema });
    assert.deepEqual(await tablesIn(client, schema), EXPECTED_TABLES);
    const path = await client.query<{ schemas: string[] }>("select current_schemas(false)::text[] as schemas");
    assert.deepEqual(path.rows[0]!.schemas, [schema]);
  } finally {
    await client.query(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});

test("migrate without a schema option journals where search_path points, not in public", async () => {
  const schema = `t_${db.schema.slice(2, 8)}path`;
  const client = new pg.Client({ connectionString: databaseUrl(), options: `-c search_path=${schema}` });
  await client.connect();
  try {
    // The schema must exist for search_path to resolve; migrate() only creates one it is told about.
    await client.query(`create schema "${schema}"`);
    await migrate(createDb(client));
    assert.deepEqual(await tablesIn(client, schema), EXPECTED_TABLES);
    assert.deepEqual(await tablesIn(client, "public"), publicTablesBefore);
    // A second run is a no-op because it reads the same journal.
    await migrate(createDb(client));
    const applied = await client.query<{ n: string }>("select count(*)::text as n from __drizzle_migrations");
    assert.equal(applied.rows[0]!.n, "3");
  } finally {
    await client.query(`drop schema if exists "${schema}" cascade`);
    await client.end();
  }
});

test("migrate without a schema option fails plainly when search_path names no schema", async () => {
  const client = new pg.Client({ connectionString: databaseUrl(), options: "-c search_path=t_does_not_exist" });
  await client.connect();
  try {
    await assert.rejects(() => migrate(createDb(client)), /search_path names no existing schema/);
    assert.deepEqual(await tablesIn(client, "public"), publicTablesBefore);
  } finally {
    await client.end();
  }
});

test("databaseUrl prefers the argument, then the environment, then the root .env", () => {
  assert.equal(databaseUrl("postgres://x@localhost/y"), "postgres://x@localhost/y");
  const saved = process.env.LIFE_DATABASE_URL;
  try {
    delete process.env.LIFE_DATABASE_URL;
    const fromEnvFile = databaseUrl();
    assert.match(fromEnvFile, /^postgres(ql)?:\/\//);
    assert.equal(process.env.LIFE_DATABASE_URL, fromEnvFile);
  } finally {
    if (saved !== undefined) process.env.LIFE_DATABASE_URL = saved;
  }
});

test("fixedClock is frozen and defaults to Los Angeles", () => {
  const clock = fixedClock("2026-09-06T12:00:00Z");
  assert.equal(clock.now().toISOString(), "2026-09-06T12:00:00.000Z");
  assert.equal(clock.now().toISOString(), "2026-09-06T12:00:00.000Z");
  assert.equal(clock.timezone, "America/Los_Angeles");
  assert.equal(fixedClock("2026-09-06T12:00:00Z", "UTC").timezone, "UTC");
  assert.throws(() => fixedClock("not a date"), /not an instant/);
});
