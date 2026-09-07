// Test helpers: a throwaway Postgres schema with the migrations applied, and a
// fixed clock. Tests never touch the public schema.

import { randomBytes } from "node:crypto";
import pg from "pg";
import type { Pool } from "pg";
import type { Clock } from "../core.ts";
import { PgStore } from "../store.ts";
import { createDb, createPool, databaseUrl } from "./client.ts";
import { migrate } from "./migrate.ts";

export type TestDb = {
  store: PgStore;
  pool: Pool;
  schema: string;
  /** End the pool and drop the schema with everything in it. */
  drop(): Promise<void>;
};

/**
 * A schema named t_<random hex> on the configured database, migrated, with a
 * pool whose every connection has search_path set to it.
 */
export async function createTestDb(): Promise<TestDb> {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const url = databaseUrl();
  const pool = createPool(url, { options: `-c search_path=${schema}` });
  try {
    await migrate(createDb(pool), { schema });
  } catch (error) {
    await pool.end();
    throw error;
  }
  const store = new PgStore(pool);
  let dropped = false;
  return {
    store,
    pool,
    schema,
    async drop() {
      if (dropped) return;
      dropped = true;
      try {
        await pool.end();
      } catch {
        // Already ended by store.close(); the schema still needs dropping.
      }
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(`drop schema if exists "${schema}" cascade`);
      } finally {
        await client.end();
      }
    },
  };
}

/** A clock frozen at `iso`, in `timezone`. */
export function fixedClock(iso: string, timezone = "America/Los_Angeles"): Clock {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`fixedClock: not an instant: ${iso}`);
  return { now: () => new Date(at.getTime()), timezone };
}
