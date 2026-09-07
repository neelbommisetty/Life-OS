import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createDb, createPool, databaseUrl } from "./client.ts";
import { migrate } from "./migrate.ts";
import { createTestDb, fixedClock, type TestDb } from "./testing.ts";

const EXPECTED_TABLES = ["__drizzle_migrations", "filters", "labels", "log", "projects", "receipts", "sections", "tasks"];
const EXPECTED_INDEXES = ["log_record_idx", "tasks_due_date_idx", "tasks_project_idx", "tasks_status_idx"];

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
  assert.equal(applied.rows[0]!.n, "1");
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
