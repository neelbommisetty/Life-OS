// The store: what a transaction can do with records, the log, and receipts,
// and PgStore, which does it over a pg Pool with Drizzle. Every write
// transaction takes the advisory lock so writers never interleave.

import type { Pool, PoolClient } from "pg";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  isTimedWhen,
  type Account,
  type Calendar,
  type Event,
  type Filter,
  type Label,
  type LogEntry,
  type Project,
  type RecordKind,
  type Section,
  type Task,
  type Title,
} from "./contract.ts";
import { addDays, toInstant } from "./time.ts";
import { createDb, type Db } from "./db/client.ts";
import * as schema from "./db/schema.ts";

export type Kind = "task" | "project" | "section" | "label" | "filter" | "account" | "calendar" | "event" | "title";
export type RecordOf<K extends Kind> = K extends "task"
  ? Task
  : K extends "project"
    ? Project
    : K extends "section"
      ? Section
      : K extends "label"
        ? Label
        : K extends "filter"
          ? Filter
          : K extends "account"
            ? Account
            : K extends "calendar"
              ? Calendar
              : K extends "event"
                ? Event
                : Title;

export interface Tx {
  get<K extends Kind>(kind: K, id: string): Promise<RecordOf<K> | null>;              // deleted records included
  all<K extends Kind>(kind: K, opts?: { includeDeleted?: boolean }): Promise<RecordOf<K>[]>; // default excludes deleted
  put<K extends Kind>(kind: K, record: RecordOf<K>): Promise<void>;                   // upsert by id
  appendLog(entry: Omit<LogEntry, "seq">): Promise<number>;
  history(kind: Kind, id: string): Promise<LogEntry[]>;
  allLog(): Promise<LogEntry[]>;
  getReceipt(key: string): Promise<unknown | null>;
  putReceipt(key: string, receipt: unknown, at: string): Promise<void>;
  /**
   * The non-deleted events in `calendarIds` a window needs: rows whose start
   * is before `to` and end after `from`, plus every master with a rule
   * (expanded in JS; an unbounded series cannot be range-filtered in SQL),
   * plus the exception rows of those masters. All-day rows are matched by
   * date without a zone, so the match is a superset (a day of slack after
   * `to`) and the caller makes the exact cut in the calendar's timezone.
   * Ordered by start key, then id.
   */
  eventsInRange(calendarIds: string[], fromInstant: string, toInstant: string): Promise<Event[]>;
}
export interface Store {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>; // BEGIN, advisory lock, work, COMMIT; ROLLBACK and rethrow on error
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T>;        // one client, one read-only snapshot (REPEATABLE READ), no lock
  close(): Promise<void>;
}

/** The advisory lock every write transaction takes first. */
export const WRITER_LOCK = 4242;

const TABLES = {
  task: schema.tasks,
  project: schema.projects,
  section: schema.sections,
  label: schema.labels,
  filter: schema.filters,
  account: schema.accounts,
  calendar: schema.calendars,
  event: schema.events,
  title: schema.titles,
} as const;

type RecordTable = (typeof TABLES)[Kind];
type LogRow = typeof schema.log.$inferSelect;

function toLogEntry(row: LogRow): LogEntry {
  return {
    seq: row.seq,
    at: toInstant(row.at),
    actor: row.actor,
    op: row.op,
    recordKind: row.recordKind as RecordKind,
    recordId: row.recordId,
    patch: row.patch as LogEntry["patch"],
    reason: row.reason,
    evidence: row.evidence as string[],
    key: row.key,
  };
}

const DAY_MS = 86400000;

/**
 * The SQL overlap test again in JS, for exception rows whose master fell
 * outside the calendars asked for. A floating row's `at` is a wall clock
 * spelled as UTC, up to a day away from the instant it resolves to in a
 * display zone this method does not know, so it gets a day of slack each way
 * and the caller's expansion (which knows the zone) trims it.
 */
function overlapsWindow(event: Event, from: string, to: string, fromDate: string, toDate: string): boolean {
  if (isTimedWhen(event.start) && isTimedWhen(event.end)) {
    const slack = event.start.timezone === null ? DAY_MS : 0;
    return Date.parse(event.start.at) < Date.parse(to) + slack && Date.parse(event.end.at) > Date.parse(from) - slack;
  }
  if (!isTimedWhen(event.start) && !isTimedWhen(event.end)) {
    return event.start.date <= toDate && event.end.date >= fromDate;
  }
  return false;
}

/**
 * Run `work` inside a savepoint on the transaction behind `tx`: released when
 * it resolves, rolled back to when it throws (the error is rethrown), so a
 * caller can undo one step of a transaction without giving up the rest. Only a
 * Tx over a Postgres client can do this; any other Tx is refused rather than
 * run without the isolation the caller asked for.
 */
export async function withSavepoint<T>(tx: Tx, work: () => Promise<T>): Promise<T> {
  if (!(tx instanceof PgTx)) throw new Error("withSavepoint: this Tx has no Postgres client to set a savepoint on");
  return tx.savepoint(work);
}

/** A Tx bound to one Drizzle instance, itself bound to one checked-out client. */
export class PgTx implements Tx {
  readonly db: Db;
  #savepoints = 0;

  constructor(db: Db) {
    this.db = db;
  }

  /** SAVEPOINT, work, RELEASE; ROLLBACK TO on a throw, which is rethrown. Names count up so savepoints nest. */
  async savepoint<T>(work: () => Promise<T>): Promise<T> {
    const name = `sp_${++this.#savepoints}`;
    await this.db.$client.query(`savepoint ${name}`);
    try {
      const result = await work();
      await this.db.$client.query(`release savepoint ${name}`);
      return result;
    } catch (error) {
      await this.db.$client.query(`rollback to savepoint ${name}`);
      throw error;
    }
  }

  async get<K extends Kind>(kind: K, id: string): Promise<RecordOf<K> | null> {
    const table: RecordTable = TABLES[kind];
    const rows = await this.db.select({ json: table.json }).from(table).where(eq(table.id, id)).limit(1);
    return rows.length ? (rows[0]!.json as RecordOf<K>) : null;
  }

  async all<K extends Kind>(kind: K, opts: { includeDeleted?: boolean } = {}): Promise<RecordOf<K>[]> {
    const table: RecordTable = TABLES[kind];
    const rows = await this.db
      .select({ json: table.json })
      .from(table)
      .where(opts.includeDeleted ? undefined : isNull(table.deletedAt))
      .orderBy(asc(table.updatedAt), asc(table.id));
    return rows.map((row) => row.json as RecordOf<K>);
  }

  async put<K extends Kind>(kind: K, record: RecordOf<K>): Promise<void> {
    const table: RecordTable = TABLES[kind];
    const row = {
      id: record.id,
      version: record.version,
      json: record as unknown,
      updatedAt: new Date(record.updatedAt),
      deletedAt: record.deletedAt ? new Date(record.deletedAt) : null,
    };
    await this.db
      .insert(table)
      .values(row)
      .onConflictDoUpdate({
        target: table.id,
        set: { version: row.version, json: row.json, updatedAt: row.updatedAt, deletedAt: row.deletedAt },
      });
  }

  async appendLog(entry: Omit<LogEntry, "seq">): Promise<number> {
    const rows = await this.db
      .insert(schema.log)
      .values({
        at: new Date(entry.at),
        actor: entry.actor,
        op: entry.op,
        recordKind: entry.recordKind,
        recordId: entry.recordId,
        patch: entry.patch as unknown,
        reason: entry.reason,
        evidence: entry.evidence as unknown,
        key: entry.key,
      })
      .returning({ seq: schema.log.seq });
    return rows[0]!.seq;
  }

  async history(kind: Kind, id: string): Promise<LogEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.log)
      .where(and(eq(schema.log.recordKind, kind), eq(schema.log.recordId, id)))
      .orderBy(asc(schema.log.seq));
    return rows.map(toLogEntry);
  }

  async allLog(): Promise<LogEntry[]> {
    const rows = await this.db.select().from(schema.log).orderBy(asc(schema.log.seq));
    return rows.map(toLogEntry);
  }

  async eventsInRange(calendarIds: string[], fromInstant: string, toInstant: string): Promise<Event[]> {
    if (calendarIds.length === 0) return [];
    const { json } = schema.events;
    const startAt = sql`(${json}->'start'->>'at')`;
    const endAt = sql`(${json}->'end'->>'at')`;
    const startDate = sql`(${json}->'start'->>'date')`;
    const endDate = sql`(${json}->'end'->>'date')`;
    // A zone-agnostic date window: in UTC terms an all-day event may start up
    // to 14 hours before its date, so a start on the day after `to` can still
    // overlap; an end on the day of `from` can too, an earlier one cannot.
    const fromDate = fromInstant.slice(0, 10);
    const toDate = addDays(toInstant.slice(0, 10), 1);
    // A floating row (`start.timezone` is JSON null) carries its wall clock
    // spelled as UTC, which sits within a day of its instant in any zone; the
    // window is widened by a day for those and the expansion trims the rest.
    const floating = sql`jsonb_typeof(${json}->'start'->'timezone') = 'null'`;
    const rows = await this.db
      .select({ json })
      .from(schema.events)
      .where(
        and(
          isNull(schema.events.deletedAt),
          inArray(sql`(${json}->>'calendarId')`, calendarIds),
          or(
            sql`jsonb_typeof(${json}->'repeat') = 'object'`,
            isNotNull(sql`(${json}->>'masterId')`),
            and(
              sql`${startAt}::timestamptz < ${toInstant}::timestamptz`,
              sql`${endAt}::timestamptz > ${fromInstant}::timestamptz`,
            ),
            and(
              floating,
              sql`${startAt}::timestamptz < ${toInstant}::timestamptz + interval '1 day'`,
              sql`${endAt}::timestamptz > ${fromInstant}::timestamptz - interval '1 day'`,
            ),
            and(sql`${startDate} <= ${toDate}`, sql`${endDate} >= ${fromDate}`),
          ),
        ),
      )
      .orderBy(sql`coalesce(${startAt}, ${startDate}) collate "C"`, asc(schema.events.id));
    const events = rows.map((row) => row.json as Event);
    // An exception row rides along with its master; without one in the result
    // it has to earn its place by overlapping the window on its own.
    const masters = new Set(events.filter((event) => event.repeat).map((event) => event.id));
    return events.filter(
      (event) =>
        event.masterId === null ||
        masters.has(event.masterId) ||
        overlapsWindow(event, fromInstant, toInstant, fromDate, toDate),
    );
  }

  async getReceipt(key: string): Promise<unknown | null> {
    const rows = await this.db
      .select({ receipt: schema.receipts.receipt })
      .from(schema.receipts)
      .where(eq(schema.receipts.key, key))
      .limit(1);
    return rows.length ? rows[0]!.receipt : null;
  }

  async putReceipt(key: string, receipt: unknown, at: string): Promise<void> {
    const row = { key, receipt, at: new Date(at) };
    await this.db
      .insert(schema.receipts)
      .values(row)
      .onConflictDoUpdate({ target: schema.receipts.key, set: { receipt: row.receipt, at: row.at } });
  }
}

export class PgStore implements Store {
  readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let broken = false;
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(${WRITER_LOCK})`);
      const result = await work(new PgTx(createDb(client)));
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        broken = true; // The connection is unusable; drop it from the pool.
      }
      throw error;
    } finally {
      client.release(broken || undefined);
    }
  }

  /**
   * One read-only transaction at REPEATABLE READ, so every query `work` runs
   * sees the same snapshot even when a writer commits in between. No advisory
   * lock: reads never wait on writers.
   */
  async read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let broken = false;
    try {
      await client.query("begin isolation level repeatable read read only");
      const result = await work(new PgTx(createDb(client)));
      await client.query("commit");
      return result;
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        broken = true; // The connection is unusable; drop it from the pool.
      }
      throw error;
    } finally {
      client.release(broken || undefined);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
