// Apply the generated migrations in drizzle/ to the public schema, or to a
// named schema (tests use a throwaway one). Always runs on one connection so
// that `search_path` and the migration transaction see the same session.

import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, isPool, type Db } from "./client.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type MigrateOptions = {
  /** The schema to migrate into. Default "public". Created if missing. */
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
  const migrationsSchema = schema ?? "public";
  if (schema) {
    await db.execute(sql`create schema if not exists ${sql.identifier(schema)}`);
    await db.execute(sql`set search_path to ${sql.identifier(schema)}`);
  }
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema });
}
