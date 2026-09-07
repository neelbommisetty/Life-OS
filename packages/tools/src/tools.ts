// The Tools facade: one object that holds the store and the clock and wires
// the task, project, section, label, filter operations and the views over
// them. `Tools.open()` connects to the database (and migrates it unless told
// not to); the constructor takes any Store, which is what tests and embedders
// use. `export()` dumps everything, deleted rows and the log included.

import type { Filter, Label, LogEntry, Project, Section, Task } from "./contract.ts";
import { nowIso, type Clock } from "./core.ts";
import { createDb, createPool } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";
import { createOrganize, type FilterOps, type LabelOps, type ProjectOps, type SectionOps } from "./organize.ts";
import { PgStore, type Store } from "./store.ts";
import { createTasks, type TaskOps } from "./tasks.ts";
import { defaultTimezone } from "./time.ts";
import { createViews, type Views } from "./views.ts";

export type ToolsOptions = {
  /** The database URL; default LIFE_DATABASE_URL (loading the repository root .env when unset). */
  url?: string;
  /** Default: the wall clock in LIFE_TZ or the machine's timezone. */
  clock?: Clock;
  /** Apply pending migrations to the public schema before use. Default true. */
  migrate?: boolean;
};

/** Everything in the database, deleted rows and the log included; each collection by createdAt then id. */
export type ExportResult = {
  exportedAt: string;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  filters: Filter[];
  tasks: Task[];
  log: LogEntry[];
};

/** The wall clock, in LIFE_TZ or the machine's timezone. */
export function systemClock(): Clock {
  return { now: () => new Date(), timezone: defaultTimezone() };
}

const byCreation = <T extends { id: string; createdAt: string }>(records: T[]): T[] =>
  [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export class Tools {
  readonly store: Store;
  readonly clock: Clock;
  readonly task: TaskOps;
  readonly project: ProjectOps;
  readonly section: SectionOps;
  readonly label: LabelOps;
  readonly filter: FilterOps;
  readonly views: Views;
  #closed = false;

  /** Connect to the database at `url` (default LIFE_DATABASE_URL), migrate it unless `migrate` is false, and wire the operations. */
  static async open(options: ToolsOptions = {}): Promise<Tools> {
    const pool = createPool(options.url);
    if (options.migrate !== false) {
      try {
        await migrate(createDb(pool));
      } catch (error) {
        await pool.end().catch(() => undefined);
        throw error;
      }
    }
    return new Tools(new PgStore(pool), options.clock);
  }

  constructor(store: Store, clock: Clock = systemClock()) {
    this.store = store;
    this.clock = clock;
    const organize = createOrganize(store, clock);
    this.project = organize.project;
    this.section = organize.section;
    this.label = organize.label;
    this.filter = organize.filter;
    this.task = createTasks(store, clock, organize);
    this.views = createViews(store, clock, this.task, organize);
  }

  /** Release the database connections. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.store.close();
  }

  /** Everything, deleted included, plus the whole log, from one read. */
  async export(): Promise<ExportResult> {
    const exportedAt = nowIso(this.clock);
    return this.store.read(async (tx) => ({
      exportedAt,
      projects: byCreation(await tx.all("project", { includeDeleted: true })),
      sections: byCreation(await tx.all("section", { includeDeleted: true })),
      labels: byCreation(await tx.all("label", { includeDeleted: true })),
      filters: byCreation(await tx.all("filter", { includeDeleted: true })),
      tasks: byCreation(await tx.all("task", { includeDeleted: true })),
      log: await tx.allLog(),
    }));
  }
}
