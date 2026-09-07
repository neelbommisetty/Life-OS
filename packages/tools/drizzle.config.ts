import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";

// drizzle-kit is only used to generate migration SQL from src/db/schema.ts.
// It needs the database URL only for `drizzle-kit push`/`studio`, which we do not use.
function databaseUrl(): string {
  if (process.env.LIFE_DATABASE_URL) return process.env.LIFE_DATABASE_URL;
  try {
    const line = readFileSync(new URL("../../.env", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith("LIFE_DATABASE_URL="));
    return line ? line.slice("LIFE_DATABASE_URL=".length).trim() : "";
  } catch {
    return "";
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: databaseUrl() },
});
