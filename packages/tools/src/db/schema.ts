// The storage shape: one table per record kind, each a JSON row plus a few
// indexed columns, plus the append-only log and the idempotency receipts.
// Tables are unqualified (no pgSchema) so the connection's search_path decides
// where they live; tests point it at a throwaway schema.

import { sql } from "drizzle-orm";
import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Fresh column builders for a record table; a factory so no builder is shared between tables. */
function recordColumns() {
  return {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    json: jsonb("json").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  };
}

export const tasks = pgTable("tasks", recordColumns(), (t) => [
  index("tasks_status_idx").on(sql`(${t.json}->>'status')`),
  index("tasks_project_idx").on(sql`(${t.json}->>'projectId')`),
  index("tasks_due_date_idx").on(sql`(${t.json}->'due'->>'date')`),
]);

export const projects = pgTable("projects", recordColumns());
export const sections = pgTable("sections", recordColumns());
export const labels = pgTable("labels", recordColumns());
export const filters = pgTable("filters", recordColumns());

export const accounts = pgTable("accounts", recordColumns());
export const calendars = pgTable("calendars", recordColumns());
export const events = pgTable("events", recordColumns(), (t) => [
  index("events_calendar_idx").on(sql`(${t.json}->>'calendarId')`),
  index("events_master_idx").on(sql`(${t.json}->>'masterId')`),
  index("events_start_at_idx").on(sql`(${t.json}->'start'->>'at')`),
  index("events_start_date_idx").on(sql`(${t.json}->'start'->>'date')`),
  index("events_external_id_idx").on(sql`(${t.json}->'external'->>'id')`),
]);

export const titles = pgTable("titles", recordColumns(), (t) => [
  index("titles_medium_idx").on(sql`(${t.json}->>'medium')`),
  index("titles_status_idx").on(sql`(${t.json}->>'status')`),
  index("titles_ownership_idx").on(sql`(${t.json}->>'ownership')`),
  index("titles_name_idx").on(sql`(lower(${t.json}->>'name'))`),
  index("titles_external_id_idx").on(sql`(${t.json}->'catalog'->>'externalId')`),
]);

export const log = pgTable(
  "log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    actor: text("actor").notNull(),
    op: text("op").notNull(),
    recordKind: text("record_kind").notNull(),
    recordId: text("record_id").notNull(),
    patch: jsonb("patch").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence").notNull(),
    key: text("key"),
  },
  (t) => [index("log_record_idx").on(t.recordKind, t.recordId, t.seq)],
);

export const receipts = pgTable("receipts", {
  key: text("key").primaryKey(),
  receipt: jsonb("receipt").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});
