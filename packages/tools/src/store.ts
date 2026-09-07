// The store: what a transaction can do with records, the log, and receipts,
// and PgStore, which does it over a pg Pool with Drizzle. Every write
// transaction takes the advisory lock so writers never interleave.

import type { Pool, PoolClient } from "pg";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Filter, Label, LogEntry, Project, RecordKind, Section, Task } from "./contract.ts";
import { toInstant } from "./time.ts";
import { createDb, type Db } from "./db/client.ts";
import * as schema from "./db/schema.ts";

export type Kind = "task" | "project" | "section" | "label" | "filter";
export type RecordOf<K extends Kind> = K extends "task" ? Task : K extends "project" ? Project : K extends "section" ? Section : K extends "label" ? Label : Filter;

export interface Tx {
  get<K extends Kind>(kind: K, id: string): Promise<RecordOf<K> | null>;              // deleted records included
  all<K extends Kind>(kind: K, opts?: { includeDeleted?: boolean }): Promise<RecordOf<K>[]>; // default excludes deleted
  put<K extends Kind>(kind: K, record: RecordOf<K>): Promise<void>;                   // upsert by id
  appendLog(entry: Omit<LogEntry, "seq">): Promise<number>;
  history(kind: Kind, id: string): Promise<LogEntry[]>;
  allLog(): Promise<LogEntry[]>;
  getReceipt(key: string): Promise<unknown | null>;
  putReceipt(key: string, receipt: unknown, at: string): Promise<void>;
}
export interface Store {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>; // BEGIN, advisory lock, work, COMMIT; ROLLBACK and rethrow on error
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T>;        // one client, no transaction, no lock
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

/** A Tx bound to one Drizzle instance, itself bound to one checked-out client. */
export class PgTx implements Tx {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
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

  async read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      return await work(new PgTx(createDb(client)));
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
