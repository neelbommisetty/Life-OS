// The pg Pool, the one environment setting, and Drizzle instances over a pool
// or a single checked-out client.

import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Pool, PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { NodePgClient } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";

export type { NodePgClient };

/** A Drizzle instance bound to whatever client it was created from (a Pool, a PoolClient, or a Client). */
export type Db = NodePgDatabase<typeof schema> & { $client: NodePgClient };

const ENV_FILE = fileURLToPath(new URL("../../../../.env", import.meta.url));

/**
 * The database URL: the argument if given, else LIFE_DATABASE_URL, loading the
 * repository root .env first when the variable is unset.
 */
export function databaseUrl(url?: string): string {
  if (url) return url;
  if (!process.env.LIFE_DATABASE_URL) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      // No .env; fall through to the error below.
    }
  }
  const found = process.env.LIFE_DATABASE_URL;
  if (!found) {
    throw new Error(`LIFE_DATABASE_URL is not set. Put it in ${ENV_FILE} or in the environment.`);
  }
  return found;
}

/** A pool for the database at `url` (default: LIFE_DATABASE_URL). Extra pg options are passed through. */
export function createPool(url?: string, config: Omit<PoolConfig, "connectionString"> = {}): Pool {
  const pool = new pg.Pool({ ...config, connectionString: databaseUrl(url) });
  // An idle client dropping its connection emits "error" on the pool; without a
  // listener that would crash the process instead of the next checkout failing.
  pool.on("error", (error) => {
    console.error("pg pool: idle client error:", error.message);
  });
  return pool;
}

/** A Drizzle instance over a pool or a single client. */
export function createDb(client: NodePgClient): Db {
  return drizzle({ client, schema });
}

/** True when a Drizzle client is a Pool rather than a single connection. */
export function isPool(client: NodePgClient): client is Pool {
  return client instanceof pg.Pool;
}
