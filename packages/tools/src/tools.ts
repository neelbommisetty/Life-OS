// The Tools facade: one object that holds the store and the clock and wires
// the task, project, section, label, filter, account, calendar, event, and
// title operations and the views over them. `Tools.open()` connects to the
// database (and migrates it unless told not to); the constructor takes any
// Store, which is what tests and embedders use. The calendar talks to its
// providers through the adapters the facade was opened with, the Google
// adapter by default; the library looks works up through the catalogs it was
// opened with, one real adapter per source by default, each reading its key
// lazily; tests pass a FakeAdapter and FakeCatalogs. `export()` dumps
// everything, deleted rows and the log included; credentials live in files and
// are never part of it.

import { createAccounts, type AccountOps, type CalendarOps } from "./calendar/accounts.ts";
import { CredentialStore } from "./calendar/credentials.ts";
import { createEvents, type EventOps } from "./calendar/events.ts";
import { GoogleAdapter } from "./calendar/google/index.ts";
import { createSchedule } from "./calendar/schedule.ts";
import type { Adapters } from "./calendar/sync.ts";
import type { Account, Calendar, Event, Filter, Label, LogEntry, Project, Section, Task, Title } from "./contract.ts";
import { nowIso, type Clock } from "./core.ts";
import { createDb, createPool } from "./db/client.ts";
import { migrate } from "./db/migrate.ts";
import { readEnv } from "./media/catalog/adapter.ts";
import { defaultCatalogs, type Catalogs } from "./media/catalog/index.ts";
import { normalizeRegion } from "./media/catalog/links.ts";
import { createTitles, type TitleOps } from "./media/titles.ts";
import { createMediaViews, type MediaViews } from "./media/views.ts";
import { createOrganize, type FilterOps, type LabelOps, type ProjectOps, type SectionOps } from "./organize.ts";
import { PgStore, type Store } from "./store.ts";
import { createTasks, type TaskOps } from "./tasks.ts";
import { defaultTimezone } from "./time.ts";
import { createViews, type Views } from "./views.ts";

/** What the calendar and the library need from outside the database: the provider adapters, where refresh tokens live, the catalogs, and the region. */
export type ToolsDeps = {
  /** By provider; default `{ google: new GoogleAdapter(...) }` over `credentials`. Tests pass a FakeAdapter. */
  adapters?: Adapters;
  /** The credential files; default `.local/google/` at the repository root. */
  credentials?: CredentialStore;
  /** By source; default `defaultCatalogs()`, one real adapter each, reading its variables on first use. Tests pass FakeCatalogs. */
  catalogs?: Catalogs;
  /** Neel's region for availability; default LIFE_REGION from the environment (the root .env loaded when unset), else `US`. */
  region?: string;
};

export type ToolsOptions = ToolsDeps & {
  /** The database URL; default LIFE_DATABASE_URL (loading the repository root .env when unset). */
  url?: string;
  /** Default: the wall clock in LIFE_TZ or the machine's timezone. */
  clock?: Clock;
  /** Apply pending migrations to the public schema before use. Default true. */
  migrate?: boolean;
};

/** Everything in the database, deleted rows and the log included; each collection by createdAt then id. Never a credential. */
export type ExportResult = {
  exportedAt: string;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  filters: Filter[];
  tasks: Task[];
  accounts: Account[];
  calendars: Calendar[];
  events: Event[];
  titles: Title[];
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
  readonly adapters: Adapters;
  readonly credentials: CredentialStore;
  readonly catalogs: Catalogs;
  /** The normalized region availability is asked for. */
  readonly region: string;
  readonly task: TaskOps;
  readonly project: ProjectOps;
  readonly section: SectionOps;
  readonly label: LabelOps;
  readonly filter: FilterOps;
  readonly account: AccountOps;
  readonly calendar: CalendarOps;
  readonly event: EventOps;
  readonly title: TitleOps;
  readonly views: Views;
  readonly media: MediaViews;
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
    return new Tools(new PgStore(pool), options.clock, { adapters: options.adapters, credentials: options.credentials, catalogs: options.catalogs, region: options.region });
  }

  constructor(store: Store, clock: Clock = systemClock(), deps: ToolsDeps = {}) {
    this.store = store;
    this.clock = clock;
    this.credentials = deps.credentials ?? new CredentialStore();
    // The Google adapter reads its OAuth client from the environment on first use, never at construction.
    this.adapters = deps.adapters ?? { google: new GoogleAdapter({ credentials: this.credentials, clock }) };
    const organize = createOrganize(store, clock);
    this.project = organize.project;
    this.section = organize.section;
    this.label = organize.label;
    this.filter = organize.filter;
    this.task = createTasks(store, clock, organize);
    const accounts = createAccounts(store, clock, { adapters: this.adapters, credentials: this.credentials });
    this.account = accounts.account;
    this.calendar = accounts.calendar;
    this.event = createEvents(store, clock, this.adapters);
    const schedule = createSchedule(store, clock, { tasks: this.task, adapters: this.adapters });
    this.views = createViews(store, clock, this.task, organize, schedule);
    // The real catalogs read their keys on first use, never at construction; the region is read once, here.
    this.catalogs = deps.catalogs ?? defaultCatalogs({ clock });
    this.region = normalizeRegion(deps.region ?? readEnv(process.env, "LIFE_REGION"));
    this.title = createTitles(store, clock, { catalogs: this.catalogs, region: this.region });
    this.media = createMediaViews(store, clock, this.title);
  }

  /** Release the database connections. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.store.close();
  }

  /** Everything, deleted included, plus the whole log, from one read. Credentials are files, never exported. */
  async export(): Promise<ExportResult> {
    const exportedAt = nowIso(this.clock);
    return this.store.read(async (tx) => ({
      exportedAt,
      projects: byCreation(await tx.all("project", { includeDeleted: true })),
      sections: byCreation(await tx.all("section", { includeDeleted: true })),
      labels: byCreation(await tx.all("label", { includeDeleted: true })),
      filters: byCreation(await tx.all("filter", { includeDeleted: true })),
      tasks: byCreation(await tx.all("task", { includeDeleted: true })),
      accounts: byCreation(await tx.all("account", { includeDeleted: true })),
      calendars: byCreation(await tx.all("calendar", { includeDeleted: true })),
      events: byCreation(await tx.all("event", { includeDeleted: true })),
      titles: byCreation(await tx.all("title", { includeDeleted: true })),
      log: await tx.allLog(),
    }));
  }
}
