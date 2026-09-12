import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { FakeAdapter, type CalendarAdapter, type ProviderCalendar } from "./calendar/adapter.ts";
import { CredentialStore } from "./calendar/credentials.ts";
import { GoogleAdapter } from "./calendar/google/index.ts";
import type { ScheduleEntry } from "./calendar/schedule.ts";
import type { Account, Ctx, Event, Receipt, Title } from "./contract.ts";
import { createPool, databaseUrl } from "./db/client.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { FakeCatalog, readEnv } from "./media/catalog/adapter.ts";
import { IgdbAdapter } from "./media/catalog/igdb.ts";
import { normalizeRegion } from "./media/catalog/links.ts";
import { OpenLibraryAdapter } from "./media/catalog/openlibrary.ts";
import { TmdbAdapter } from "./media/catalog/tmdb.ts";
import { PgStore } from "./store.ts";
import { defaultTimezone } from "./time.ts";
import { Tools, systemClock } from "./tools.ts";

const clock = fixedClock("2026-09-06T12:00:00Z");
const neel: Ctx = { actor: "neel" };

let db: TestDb;
let tools: Tools;
before(async () => {
  db = await createTestDb();
  tools = new Tools(db.store, clock);
});
after(() => db.drop());

/** Assert a receipt is ok and hand back its record. */
function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

const tablesIn = async (pool: pg.Pool, schema: string): Promise<string[]> =>
  (await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = $1 order by 1", [schema])).rows.map((row) => row.table_name);

/** A URL whose every connection has search_path set to the throwaway schema, so open() never sees public. */
const testSchemaUrl = (): string => `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${db.schema}`;

/** The fake as a real adapter behaves: `connect` leaves the credential under the provisional id for `account.add` to adopt. */
function connecting(inner: FakeAdapter, files: CredentialStore): CalendarAdapter {
  return {
    provider: "google",
    async connect(opts) {
      const result = await inner.connect(opts);
      await files.write(result.credentialId, { identity: result.identity, refreshToken: `refresh-token-${result.credentialId}`, scopes: result.scopes, obtainedAt: "2026-09-06T12:00:00Z" });
      return result;
    },
    listCalendars: (accountId) => inner.listCalendars(accountId),
    syncPage: (accountId, calendar, cursor, since) => inner.syncPage(accountId, calendar, cursor, since),
    create: (accountId, calendar, event, lifeId) => inner.create(accountId, calendar, event, lifeId),
    update: (accountId, calendar, providerId, patch, etag) => inner.update(accountId, calendar, providerId, patch, etag),
    delete: (accountId, calendar, providerId) => inner.delete(accountId, calendar, providerId),
    respond: (accountId, calendar, providerId, response) => inner.respond(accountId, calendar, providerId, response),
    move: (accountId, from, to, providerId) => inner.move(accountId, from, to, providerId),
    instances: (accountId, calendar, masterId) => inner.instances(accountId, calendar, masterId),
    instanceId: (masterId, originalStart) => inner.instanceId(masterId, originalStart),
  };
}

const titles = (entries: ScheduleEntry[]): string[] => entries.map((e) => (e.kind === "event" ? `E:${e.occurrence.title}` : `T:${e.task.title}`));

const isConnectionRefused = (error: unknown): boolean => {
  const errors = error instanceof AggregateError ? error.errors : [error];
  return errors.some((e) => e instanceof Error && ("code" in e ? e.code === "ECONNREFUSED" : /ECONNREFUSED/.test(e.message)));
};

test("the constructor wires every operation group and the views over one store and clock", async () => {
  assert.equal(tools.store, db.store);
  assert.equal(tools.clock, clock);

  const health = okRecord(await tools.project.add({ name: "Health", labels: ["health"] }, neel));
  const plan = okRecord(await tools.section.add({ project: "health", name: "Plan" }, neel));
  const task = okRecord(await tools.task.add({ title: "Book the dentist", project: "health", section: "Plan", due: { date: "2026-09-06" } }, neel));
  assert.equal(task.projectId, health.id);
  assert.equal(task.sectionId, plan.id);
  assert.equal(task.status, "accepted");

  const label = await tools.label.get("health");
  assert.ok(label, "the project's label was registered on the fly");
  okRecord(await tools.filter.add({ name: "Today", query: "today" }, neel));

  assert.deepEqual((await tools.views.filter("Today")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.today()).due.map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.label("health")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.views.search("DENTIST")).map((t) => t.id), [task.id]);
  assert.deepEqual((await tools.task.history(task.id)).map((e) => e.op), ["task.add"]);
  assert.deepEqual((await tools.project.tree()).map((node) => node.project.slug), ["inbox", "health"]);
});

test("export returns every collection, deleted rows included, and the whole log", async () => {
  const scrap = okRecord(await tools.task.add({ title: "Scrap this", allowDuplicate: true }, neel));
  const deletedTask = okRecord(await tools.task.delete(scrap.id, neel));
  const spare = okRecord(await tools.label.add({ name: "spare" }, neel));
  okRecord(await tools.label.delete("spare", neel));
  const oldFilter = okRecord(await tools.filter.add({ name: "Old filter", query: "overdue" }, neel));
  okRecord(await tools.filter.delete("Old filter", neel));
  const gone = okRecord(await tools.project.add({ name: "Gone" }, neel));
  const goneSection = okRecord(await tools.section.add({ project: "gone", name: "Was here" }, neel));
  okRecord(await tools.project.delete("gone", neel, { contents: "delete" }));

  const out = await tools.export();
  assert.equal(out.exportedAt, "2026-09-06T12:00:00Z");
  assert.deepEqual(Object.keys(out), ["exportedAt", "projects", "sections", "labels", "filters", "tasks", "accounts", "calendars", "events", "titles", "log"]);
  assert.deepEqual([out.accounts, out.calendars, out.events, out.titles], [[], [], [], []], "no account or title yet: the calendar and library collections are empty, not missing");

  const find = <T extends { id: string; deletedAt: string | null }>(list: T[], id: string): T => {
    const record = list.find((r) => r.id === id);
    assert.ok(record, `${id} is exported`);
    return record;
  };
  assert.ok(find(out.tasks, deletedTask.id).deletedAt, "a deleted task is exported with its deletedAt");
  assert.ok(find(out.labels, spare.id).deletedAt);
  assert.ok(find(out.filters, oldFilter.id).deletedAt);
  assert.ok(find(out.projects, gone.id).deletedAt);
  assert.ok(find(out.sections, goneSection.id).deletedAt);
  assert.ok(out.projects.some((p) => p.system), "the Inbox is exported");
  assert.ok(out.tasks.some((t) => t.title === "Book the dentist" && !t.deletedAt), "live rows too");

  const everything = await db.store.read(async (tx) => ({
    projects: (await tx.all("project", { includeDeleted: true })).length,
    sections: (await tx.all("section", { includeDeleted: true })).length,
    labels: (await tx.all("label", { includeDeleted: true })).length,
    filters: (await tx.all("filter", { includeDeleted: true })).length,
    tasks: (await tx.all("task", { includeDeleted: true })).length,
    log: await tx.allLog(),
  }));
  assert.equal(out.projects.length, everything.projects);
  assert.equal(out.sections.length, everything.sections);
  assert.equal(out.labels.length, everything.labels);
  assert.equal(out.filters.length, everything.filters);
  assert.equal(out.tasks.length, everything.tasks);
  assert.deepEqual(out.log, everything.log, "the log is exported whole, in sequence");
  assert.ok(out.log.length >= 10);

  // With a frozen clock every createdAt is equal, so the createdAt-then-id order reduces to id order.
  for (const list of [out.projects, out.sections, out.labels, out.filters, out.tasks]) {
    const listed = list.map((r) => r.id);
    assert.deepEqual(listed, [...listed].sort(), "each collection is in a stable order");
  }
});

test("the default clock is the wall clock in the default timezone, the default adapter is Google, and the default credentials are the repository's", () => {
  const plain = new Tools(db.store);
  assert.equal(plain.clock.timezone, defaultTimezone());
  assert.ok(Math.abs(plain.clock.now().getTime() - Date.now()) < 5000);
  assert.equal(systemClock().timezone, defaultTimezone());
  assert.ok(plain.adapters.google instanceof GoogleAdapter, "the Google adapter is wired by default (it reads its OAuth client from the environment on first use, not here)");
  assert.equal(plain.adapters.google?.provider, "google");
  assert.ok(plain.credentials instanceof CredentialStore);
  assert.match(plain.credentials.dir, /\.local[\\/]google[\\/]?$/);
  assert.ok(plain.catalogs.tmdb instanceof TmdbAdapter, "the real catalogs are wired by default (each reads its key on first use, not here)");
  assert.ok(plain.catalogs.openlibrary instanceof OpenLibraryAdapter);
  assert.ok(plain.catalogs.igdb instanceof IgdbAdapter);
  assert.equal(plain.region, normalizeRegion(readEnv(process.env, "LIFE_REGION")), "LIFE_REGION when set, else US");
  assert.match(plain.region, /^[A-Z]{2}$/);
  assert.equal(new Tools(db.store, clock, { region: "gb" }).region, "GB", "a given region is normalized");
});

test("open connects to the given url, skips migration when told, works, and closes once", async () => {
  const plain = createPool();
  let publicBefore: string[];
  try {
    publicBefore = await tablesIn(plain, "public");
  } finally {
    await plain.end();
  }

  const opened = await Tools.open({ url: testSchemaUrl(), migrate: false, clock });
  try {
    assert.ok(opened.store instanceof PgStore);
    assert.equal(opened.clock, clock);
    const task = okRecord(await opened.task.add({ title: "Added through open()", allowDuplicate: true }, neel));
    const stored = await db.store.read((tx) => tx.get("task", task.id));
    assert.deepEqual(stored, task, "open() wrote into the schema its url points at");
    assert.deepEqual((await opened.views.search("through open")).map((t) => t.id), [task.id]);
    assert.equal((await opened.export()).tasks.some((t) => t.id === task.id), true);
  } finally {
    await opened.close();
  }
  await opened.close(); // idempotent
  await assert.rejects(opened.task.list(), /pool|end/i, "a closed Tools has no connections");

  const again = createPool();
  try {
    assert.deepEqual(await tablesIn(again, "public"), publicBefore, "nothing touched the public schema");
  } finally {
    await again.end();
  }
});

test("open rejects when the database is unreachable", async () => {
  const unreachable = "postgres://life:life@127.0.0.1:1/life";
  await assert.rejects(Tools.open({ url: unreachable, clock }), isConnectionRefused, "migrate: true connects eagerly and surfaces the failure");

  const lazy = await Tools.open({ url: unreachable, migrate: false, clock });
  try {
    await assert.rejects(lazy.task.list(), isConnectionRefused, "migrate: false connects on first use");
  } finally {
    await lazy.close();
  }
});

test("the facade wires accounts, calendars, events, and the schedule over the adapters it was opened with; export carries the new kinds and never a credential", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "life-tools-"));
  const credentials = new CredentialStore(join(tempRoot, ".local", "google"));
  const fake = new FakeAdapter({ clock });
  const personal: ProviderCalendar = { id: "neel@gmail.com", name: "Personal", color: "#0b8043", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false };
  const cal = new Tools(db.store, clock, { adapters: { google: connecting(fake, credentials) }, credentials });
  try {
    assert.equal(cal.credentials, credentials);
    assert.equal(cal.adapters.google?.provider, "google");

    // Todo-only until an account exists: the schedule fields are there, the todo lists are what they were.
    const before = await cal.views.today({ date: "2026-09-06" });
    assert.deepEqual(before.freshness, []);
    assert.deepEqual(before.warnings, []);
    assert.deepEqual(titles(before.allDay), ["T:Book the dentist"]);
    assert.deepEqual(titles(before.timed), []);
    assert.deepEqual(before.due.map((t) => t.id), (await tools.views.today({ date: "2026-09-06" })).due.map((t) => t.id), "the same lists a Tools without the fake sees");
    assert.equal(fake.calls.length, 0, "no account, nothing asked of the provider");

    fake.connectAs("neel@gmail.com");
    fake.seed("neel@gmail.com", personal, [
      { id: "standup", title: "Standup", start: { at: "2026-09-06T16:00:00Z", timezone: "America/Los_Angeles" }, end: { at: "2026-09-06T16:30:00Z", timezone: "America/Los_Angeles" } },
    ]);
    const added = await cal.account.add({ provider: "google", open: () => undefined }, neel);
    const account = okRecord<Account>(added, "account.add");
    assert.equal(account.identity, "neel@gmail.com");
    assert.equal(account.primary, true);
    assert.ok(added.ok && added.sync && added.sync.calendars.every((c) => c.outcome === "synced"), JSON.stringify(added));
    assert.deepEqual(await readdir(credentials.dir), [`${account.id}.json`], "the credential was adopted under the account id");

    const calendars = await cal.calendar.list();
    assert.deepEqual(calendars.map((c) => c.name), ["Personal"]);
    assert.equal(await cal.calendar.get(`neel@gmail.com/Personal`).then((c) => c?.id), calendars[0]!.id);

    const event = okRecord<Event>(await cal.event.add({ title: "Dentist", start: { at: "2026-09-06T17:00:00Z", timezone: "America/Los_Angeles" } }, neel), "event.add");
    assert.equal(event.calendarId, calendars[0]!.id);
    assert.equal(fake.callsTo("create").length, 1, "the write went through the adapter");
    assert.equal(event.external.id, fake.events(account.id).at(-1)!.external.id, "the readback is what was stored");

    const today = await cal.views.today({ date: "2026-09-06" });
    assert.deepEqual(titles(today.allDay), ["T:Book the dentist"]);
    assert.deepEqual(titles(today.timed), ["E:Standup", "E:Dentist"]);
    assert.deepEqual(today.due.map((t) => t.id), before.due.map((t) => t.id), "the todo lists did not change");
    assert.deepEqual(Object.keys(today), ["date", "timezone", "overdue", "due", "deadlines", "proposed", "allDay", "timed", "freshness", "warnings"]);
    assert.equal(today.freshness.length, 1);
    assert.equal(today.freshness[0]!.name, "Personal");
    assert.deepEqual(today.warnings, []);

    const week = await cal.views.week({ from: "2026-09-06", days: 2 });
    assert.equal(week.days.length, 2);
    assert.deepEqual(titles(week.days[0]!.timed), ["E:Standup", "E:Dentist"]);
    const slots = await cal.views.slots({ duration: 30, from: "2026-09-07", to: "2026-09-07" });
    assert.deepEqual(slots.slots, [{ start: "2026-09-07T16:00:00Z", end: "2026-09-08T01:00:00Z" }]);

    okRecord(await cal.event.delete(event.id, neel), "event.delete");
    const trash = await cal.views.trash();
    assert.deepEqual(Object.keys(trash), ["tasks", "projects", "sections", "labels", "filters", "events", "calendars", "accounts", "titles"]);
    assert.deepEqual(trash.events.map((e) => e.id), [event.id]);
    assert.deepEqual(trash.calendars, []);
    assert.deepEqual(trash.accounts, []);

    const out = await cal.export();
    assert.deepEqual(out.accounts.map((a) => a.id), [account.id]);
    assert.deepEqual(out.calendars.map((c) => c.id), [calendars[0]!.id]);
    assert.ok(out.events.some((e) => e.id === event.id && e.deletedAt !== null), "deleted events are exported too");
    assert.ok(out.log.some((entry) => entry.op === "event.sync" && entry.actor === "import:google"), "sync entries are in the log");
    const dumped = JSON.stringify(out);
    assert.ok(!dumped.includes("refresh-token-") && !dumped.includes("refreshToken"), "a credential never leaves its file");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("the facade wires the title operations and the library views over the catalogs it was opened with; export and trash carry titles", async () => {
  const tmdb = new FakeCatalog({ source: "tmdb" });
  const openlibrary = new FakeCatalog({ source: "openlibrary" });
  const igdb = new FakeCatalog({ source: "igdb" });
  tmdb.seed("movie", [
    {
      externalId: "27205",
      name: "Inception",
      year: 2010,
      creators: ["Christopher Nolan"],
      availability: [
        { kind: "stream", name: "Netflix", url: "https://netflix.example/27205", region: "US", price: null, constructed: false },
        { kind: "rent", name: "Apple TV", url: "https://tv.apple.example/27205", region: "US", price: { amount: 3.99, currency: "USD" }, constructed: false },
        { kind: "rent", name: "Amazon", url: "https://amazon.example/27205", region: "GB", price: { amount: 2.49, currency: "GBP" }, constructed: false },
      ],
    },
  ]);
  const lib = new Tools(db.store, clock, { catalogs: { tmdb, openlibrary, igdb }, region: "US" });
  assert.equal(lib.catalogs.tmdb, tmdb);
  assert.equal(lib.region, "US");

  const added = await lib.title.add({ medium: "movie", name: "inception", want: true, priority: "now" }, neel);
  const inception = okRecord<Title>(added, "title.add");
  assert.equal(inception.name, "Inception", "the catalog name is adopted");
  assert.deepEqual(inception.aliases, [], "a spelling that differs only by case is not an alias");
  assert.equal(inception.catalog?.externalId, "27205");
  assert.equal(inception.status, "backlog");
  assert.deepEqual(tmdb.callsTo("availability").map((call) => call.region), ["US"], "availability was asked for the facade's region");
  assert.deepEqual(inception.facts?.availability.map((row) => row.name), ["Netflix", "Apple TV"], "the GB row was never pulled");

  const movies = lib.title.scoped("movie");
  okRecord<Title>(await movies.start("Inception", {}, neel), "start by name");
  assert.deepEqual((await lib.media.now("movie")).map((row) => row.id), [inception.id]);
  assert.deepEqual((await lib.media.backlog()).map((row) => row.id), [], "started: no longer backlog");
  const buy = await lib.media.buy("movie");
  assert.deepEqual(buy, [], "active titles are not to buy");
  assert.deepEqual((await lib.media.search("nolan")).map((row) => row.id), [inception.id], "creators from the pull are searchable");
  assert.deepEqual((await lib.media.time({ medium: "movie" })).total.minutes, {});
  assert.deepEqual(await lib.title.where("Inception"), inception.facts?.availability);
  assert.equal(await lib.media.series(inception.id), null);

  const book = okRecord<Title>(await lib.title.add({ medium: "book", name: "Scrap Book", lookup: false }, neel), "book add");
  okRecord<Title>(await lib.title.delete(book.id, neel), "delete book");
  const trash = await lib.views.trash();
  assert.deepEqual(Object.keys(trash), ["tasks", "projects", "sections", "labels", "filters", "events", "calendars", "accounts", "titles"]);
  assert.deepEqual(trash.titles.map((t) => t.id), [book.id]);
  assert.ok(trash.titles[0]!.deletedAt);

  const out = await lib.export();
  assert.deepEqual(out.titles.map((t) => t.id).sort(), [inception.id, book.id].sort(), "live and deleted titles alike");
  assert.ok(out.titles.find((t) => t.id === book.id)?.deletedAt, "a deleted title keeps its deletedAt");
  assert.ok(out.log.some((entry) => entry.op === "title.add" && entry.recordId === inception.id), "title writes are in the shared log");
  assert.ok(out.log.some((entry) => entry.op === "title.start" && entry.recordId === inception.id));
  const stored = await db.store.read((tx) => tx.all("title", { includeDeleted: true }));
  assert.equal(out.titles.length, stored.length);

  // A Tools over the same store without catalogs still reads what this one wrote; the library views are on every facade.
  assert.deepEqual((await tools.media.now()).map((row) => row.id), [inception.id]);
  assert.equal((await tools.title.get(inception.id))?.name, "Inception");
});
