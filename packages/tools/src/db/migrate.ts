// Apply the generated migrations in drizzle/ to the public schema, or to a
// named schema (tests use a throwaway one). Always runs on one connection so
// that `search_path` and the migration transaction see the same session.

import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, isPool, type Db } from "./client.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type MigrateOptions = {
  /** The schema to migrate into. Default: wherever the connection's search_path resolves (public unless the URL says otherwise). Created if missing. */
  schema?: string;
};

export async function migrate(db: Db, options: MigrateOptions = {}): Promise<void> {
  const client = db.$client;
  if (isPool(client)) {
    const one = await client.connect();
    try {
      await migrateOn(createDb(one), options.schema);
      // Do not leak a changed search_path into a pooled connection.
      if (options.schema) await one.query("reset search_path");
    } finally {
      one.release();
    }
    return;
  }
  await migrateOn(db, options.schema);
}

async function migrateOn(db: Db, schema: string | undefined): Promise<void> {
  if (schema) {
    await db.execute(sql`create schema if not exists ${sql.identifier(schema)}`);
    await db.execute(sql`set search_path to ${sql.identifier(schema)}`);
  }
  // The journal lives next to the tables. Tables are unqualified, so they land
  // wherever search_path points; the journal must follow, or a connection
  // whose URL sets search_path would record the migration as applied in
  // public while creating nothing there.
  const migrationsSchema = schema ?? (await currentSchema(db));
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema });
}

/** The schema unqualified tables go to on this connection; throws when search_path names no existing schema. */
async function currentSchema(db: Db): Promise<string> {
  const result = await db.execute<{ schema: string | null }>(sql`select current_schema() as schema`);
  const found = result.rows[0]?.schema;
  if (!found) throw new Error("migrate: search_path names no existing schema; create it first or pass { schema }");
  return found;
}
