import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Account, Calendar, Ctx, Receipt, Task, TaskAdd } from "../contract.ts";
import { mutate, newId, okMutation } from "../core.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { createOrganize, type Organize } from "../organize.ts";
import { createTasks, type TaskOps } from "../tasks.ts";
import { FakeAdapter, ProviderUnavailable, type ProviderCalendar, type SeedEvent } from "./adapter.ts";
import { createSchedule, maxAgeFromEnv, type Schedule, type ScheduleEntry } from "./schedule.ts";
import { syncAccount, type Adapters } from "./sync.ts";

// 2026-09-09T12:00Z is 05:00 in Los Angeles, a Wednesday; LA is UTC-7 in September.
const NOW = "2026-09-09T12:00:00Z";
const LA = "America/Los_Angeles";
const clock = fixedClock(NOW);
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", reason: "inferred", evidence: ["vault:Areas/Health.md#2026-09-04"] };

const personalCal: ProviderCalendar = { id: "neel@gmail.com", name: "Personal", color: "#0b8043", timezone: LA, writable: true, primary: true, hidden: false };
const holidaysCal: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };

const timed = (id: string, title: string, start: string, end: string, extra: Partial<SeedEvent> = {}): SeedEvent => ({
  id,
  title,
  start: { at: start, timezone: LA },
  end: { at: end, timezone: LA },
  ...extra,
});

let db: TestDb;
let org: Organize;
let tasks: TaskOps;
let fake: FakeAdapter;
let account: Account;
let personal: Calendar;
let holidays: Calendar;

function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

const mk = async (title: string, extra: Partial<TaskAdd> = {}, ctx: Ctx = neel): Promise<Task> => okRecord(await tasks.add({ title, allowDuplicate: true, ...extra }, ctx), title);
const scheduleAt = (iso = NOW, adapters: Adapters = { google: fake }): Schedule => createSchedule(db.store, fixedClock(iso), { tasks, adapters });
const titles = (entries: ScheduleEntry[]): string[] => entries.map((e) => (e.kind === "event" ? `E:${e.occurrence.title}` : `T:${e.task.title}`));
const pages = (): number => fake.callsTo("syncPage").length;
const rowByExternal = async (externalId: string) => {
  const found = (await db.store.read((tx) => tx.all("event"))).find((e) => e.external.id === externalId);
  assert.ok(found, `no row for provider id ${externalId}`);
  return found;
};

before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
  tasks = createTasks(db.store, clock, org);
  fake = new FakeAdapter({ clock });

  await mk("Call the dentist", { due: { date: "2026-09-09", time: "10:30", timezone: LA } }); // 17:30Z
  await mk("Walk in the park", { due: { date: "2026-09-09" } });
  await mk("Pay rent", { due: { date: "2026-09-01" } }); // overdue: today's `overdue` list, not the schedule
  await mk("Follow up on labs", { due: { date: "2026-09-09" } }, codex); // proposed
  const chore = await mk("Take out the bins", { due: { date: "2026-09-09" } });
  okRecord(await tasks.complete(chore.id, neel));
  const trashed = await mk("Old errand", { due: { date: "2026-09-09" } });
  okRecord(await tasks.delete(trashed.id, neel));
  await mk("Plan sprint", { due: { date: "2026-09-10", time: "09:00", timezone: LA } }); // 16:00Z
  await mk("File taxes", { due: { date: "2026-09-16" } });
});
after(() => db.drop());

test("with no accounts the schedule is todo-only: dated tasks placed, no freshness, no warnings, nothing asked of a provider", async () => {
  const schedule = scheduleAt();
  const today = await schedule.today();
  assert.deepEqual(titles(today.allDay), ["T:Walk in the park"]);
  assert.deepEqual(titles(today.timed), ["T:Call the dentist"]);
  assert.deepEqual(today.freshness, []);
  assert.deepEqual(today.warnings, []);

  const week = await schedule.week({ days: 8 });
  assert.equal(week.from, "2026-09-09");
  assert.equal(week.to, "2026-09-16");
  assert.equal(week.timezone, LA);
  assert.deepEqual(titles(week.days[1]!.timed), ["T:Plan sprint"]);
  assert.deepEqual(titles(week.days[7]!.allDay), ["T:File taxes"]);
  assert.ok(!week.days.some((day) => titles(day.allDay).concat(titles(day.timed)).some((t) => /rent|labs|bins|errand/.test(t))), "overdue, proposed, done, and deleted tasks are not on the schedule");

  const slots = await schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09" });
  assert.deepEqual(slots, { slots: [{ start: "2026-09-09T16:00:00Z", end: "2026-09-10T01:00:00Z" }], freshness: [], warnings: [] });
  assert.equal(fake.calls.length, 0);
});

test("the copy is synced once, as account.add would, before the views read it", async () => {
  const id = newId("account");
  account = okRecord(
    await mutate(db.store, clock, "account", "account.add", neel, async (_tx, _c, now) =>
      okMutation("created", null, { id, provider: "google", identity: "neel@gmail.com", label: null, primary: true, status: "connected", scopes: [], syncedAt: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null }),
    ),
  );
  fake.seed(account.id, personalCal, [
    timed("yoga", "Yoga", "2026-09-02T14:00:00Z", "2026-09-02T15:00:00Z", { repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=WE", exdates: [] } }), // 07:00 LA Wednesdays
    timed("standup", "Standup", "2026-09-09T16:00:00Z", "2026-09-09T16:30:00Z"),
    timed("lunch", "Lunch", "2026-09-09T19:00:00Z", "2026-09-09T20:00:00Z", { busy: false }),
    timed("declined", "Declined sync", "2026-09-09T21:00:00Z", "2026-09-09T22:00:00Z", {
      myResponse: "declined",
      attendees: [{ email: "neel@gmail.com", name: null, response: "declined", self: true, optional: false }],
    }),
    timed("cancelled", "Cancelled review", "2026-09-09T22:00:00Z", "2026-09-09T23:00:00Z", { status: "cancelled" }),
    { id: "offsite", title: "Offsite", start: { date: "2026-09-09" }, end: { date: "2026-09-11" } },
    timed("conference", "Conference", "2026-09-10T20:00:00Z", "2026-09-11T17:00:00Z"), // 13:00 Thu to 10:00 Fri LA
    { id: "focus", title: "Focus day", start: { date: "2026-09-14" }, end: { date: "2026-09-15" }, busy: true },
  ]);
  fake.seed(account.id, holidaysCal, [{ id: "holiday", title: "Holiday", start: { date: "2026-09-09" }, end: { date: "2026-09-10" } }]);
  const report = await syncAccount(db.store, clock, fake, account.id);
  assert.ok(report.calendars.every((c) => c.outcome === "synced"), JSON.stringify(report));
  const calendars = (await db.store.read((tx) => tx.all("calendar"))).sort((a, b) => a.order - b.order);
  assert.equal(calendars.length, 2);
  [personal, holidays] = calendars as [Calendar, Calendar];
  assert.equal(personal.name, "Personal");
  assert.equal(holidays.hidden, true);
});

test("today merges events and dated tasks: all-day events then date tasks, timed by start; declined dropped, cancelled kept, hidden excluded", async () => {
  const before = pages();
  const today = await scheduleAt().today();
  assert.deepEqual(titles(today.allDay), ["E:Offsite", "T:Walk in the park"]);
  assert.deepEqual(titles(today.timed), ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Lunch", "E:Cancelled review"]);

  const yoga = today.timed[0]!;
  assert.equal(yoga.kind, "event");
  if (yoga.kind !== "event") throw new Error("unreachable");
  assert.equal(yoga.occurrence.occurrenceId, `${(await rowByExternal("yoga")).id}@2026-09-09T14:00:00Z`, "the weekly series is expanded to this Wednesday");
  const cancelled = today.timed[4]!;
  assert.equal(cancelled.kind === "event" && cancelled.occurrence.status, "cancelled");

  assert.deepEqual(today.freshness, [{ calendarId: personal.id, name: "Personal", syncedAt: NOW, ageSeconds: 0, refreshed: false, error: null }]);
  assert.deepEqual(today.warnings, []);
  assert.equal(pages(), before, "a fresh copy is not refreshed");
});

test("includeHidden brings the hidden calendar's events and freshness in", async () => {
  const today = await scheduleAt().today({ includeHidden: true });
  assert.ok(titles(today.allDay).includes("E:Holiday"));
  assert.deepEqual(titles(today.allDay).slice(-1), ["T:Walk in the park"], "date-only tasks still come after every all-day event");
  assert.deepEqual(
    today.freshness.map((f) => f.name),
    ["Personal", "Holidays"],
  );
});

test("week lays every day out, puts multi-day events on each day they cover, and does not carry overdue tasks", async () => {
  const week = await scheduleAt().week({ from: "2026-09-09", days: 8 });
  assert.equal(week.days.length, 8);
  assert.deepEqual(
    week.days.map((day) => day.date),
    ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"],
  );
  const byDate = Object.fromEntries(week.days.map((day) => [day.date, { allDay: titles(day.allDay), timed: titles(day.timed) }]));
  assert.deepEqual(byDate["2026-09-09"], { allDay: ["E:Offsite", "T:Walk in the park"], timed: ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Lunch", "E:Cancelled review"] });
  assert.deepEqual(byDate["2026-09-10"], { allDay: ["E:Offsite"], timed: ["T:Plan sprint", "E:Conference"] }, "the all-day span covers its second day; the exclusive end date does not count");
  assert.deepEqual(byDate["2026-09-11"], { allDay: [], timed: ["E:Conference"] }, "a timed event that runs past midnight shows on the next day too");
  assert.deepEqual(byDate["2026-09-12"], { allDay: [], timed: [] });
  assert.deepEqual(byDate["2026-09-14"], { allDay: ["E:Focus day"], timed: [] });
  assert.deepEqual(byDate["2026-09-16"], { allDay: ["T:File taxes"], timed: ["E:Yoga"] });
  assert.ok(!JSON.stringify(byDate).includes("Pay rent"));

  await assert.rejects(scheduleAt().week({ days: 0 }), /week: days/);
  await assert.rejects(scheduleAt().week({ from: "someday" }), /week: from/);
});

test("slots: busy time splits the working hours, free events do not, declined and cancelled ones are not busy", async () => {
  const result = await scheduleAt().slots({ duration: 60, from: "2026-09-09", to: "2026-09-11" });
  assert.deepEqual(result.slots, [
    { start: "2026-09-09T16:30:00Z", end: "2026-09-10T01:00:00Z" }, // after the standup; lunch is free time, the declined and cancelled ones do not block
    { start: "2026-09-10T16:00:00Z", end: "2026-09-10T20:00:00Z" }, // until the conference starts
    { start: "2026-09-11T17:00:00Z", end: "2026-09-12T01:00:00Z" }, // after the conference ends
  ]);
  assert.deepEqual(
    result.freshness.map((f) => f.name),
    ["Personal"],
  );
  assert.deepEqual(result.warnings, []);
});

test("slots: hours and weekdays clip, an all-day busy event blocks its day, a named hidden calendar counts, bad input throws", async () => {
  const schedule = scheduleAt();
  const hours = await schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09", hours: { start: "13:00", end: "15:00" } });
  assert.deepEqual(hours.slots, [{ start: "2026-09-09T20:00:00Z", end: "2026-09-09T22:00:00Z" }]);

  const weekend = await schedule.slots({ duration: 60, from: "2026-09-12", to: "2026-09-13" });
  assert.deepEqual(weekend.slots, [], "Saturday and Sunday are outside the default days");
  const saturday = await schedule.slots({ duration: 60, from: "2026-09-12", to: "2026-09-13", hours: { start: "09:00", end: "18:00", days: [6] } });
  assert.deepEqual(saturday.slots, [{ start: "2026-09-12T16:00:00Z", end: "2026-09-13T01:00:00Z" }]);

  const focus = await schedule.slots({ duration: 30, from: "2026-09-14", to: "2026-09-14" });
  assert.deepEqual(focus.slots, [], "an all-day event marked busy blocks the whole day");

  const tooLong = await schedule.slots({ duration: 600, from: "2026-09-09", to: "2026-09-09" });
  assert.deepEqual(tooLong.slots, [], "eight and a half free hours do not fit ten");

  const named = await schedule.slots({ duration: 60, from: "2026-09-10", to: "2026-09-10", calendars: ["Holidays"] });
  assert.deepEqual(named.slots, [{ start: "2026-09-10T16:00:00Z", end: "2026-09-11T01:00:00Z" }], "only the named calendar's events count, hidden or not");
  assert.deepEqual(
    named.freshness.map((f) => f.calendarId),
    [holidays.id],
  );
  const byPath = await schedule.slots({ duration: 60, from: "2026-09-10", to: "2026-09-10", calendars: ["neel@gmail.com/Personal"] });
  assert.deepEqual(byPath.slots, [{ start: "2026-09-10T16:00:00Z", end: "2026-09-10T20:00:00Z" }]);

  await assert.rejects(schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09", calendars: ["Nope"] }), /slots: no calendar "Nope"/);
  await assert.rejects(schedule.slots({ duration: 0, from: "2026-09-09", to: "2026-09-09" }), /slots: duration/);
  await assert.rejects(schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09", hours: { start: "9am", end: "18:00" } }), /slots: hours.start/);
  await assert.rejects(schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09", hours: { start: "18:00", end: "09:00" } }), /slots: hours.end/);
  await assert.rejects(schedule.slots({ duration: 60, from: "2026-09-09", to: "2026-09-09", hours: { start: "09:00", end: "18:00", days: [7] } }), /slots: hours.days/);
  await assert.rejects(schedule.slots({ duration: 60, from: "2026-09-10", to: "2026-09-09" }), /slots: to/);
  await assert.rejects(schedule.slots({ duration: 60, from: "whenever" }), /slots: from/);
});

test("slots: a from in the past is clipped to now, and a stale copy is refreshed first and says so", async () => {
  const before = pages();
  const schedule = scheduleAt("2026-09-09T17:00:00Z"); // 10:00 LA, five hours after the last sync
  const result = await schedule.slots({ duration: 60, from: "2026-09-01", to: "2026-09-09" });
  assert.deepEqual(result.slots, [{ start: "2026-09-09T17:00:00Z", end: "2026-09-10T01:00:00Z" }], "nothing before now; the standup already ended");
  assert.deepEqual(result.freshness, [{ calendarId: personal.id, name: "Personal", syncedAt: "2026-09-09T17:00:00Z", ageSeconds: 0, refreshed: true, error: null }]);
  assert.deepEqual(result.warnings, []);
  assert.equal(pages() - before, 1, "the stale calendar was pulled once; the hidden one was not in scope");

  const later = await schedule.slots({ duration: 60, from: "2026-09-09 11:00", to: "2026-09-09" });
  assert.deepEqual(later.slots, [{ start: "2026-09-09T18:00:00Z", end: "2026-09-10T01:00:00Z" }], "a wall-clock from is read in the display zone");
  const defaults = await schedule.slots({ duration: 60 });
  assert.equal(defaults.slots[0]!.start, "2026-09-09T17:00:00Z");
  assert.equal(defaults.slots.at(-1)!.end, "2026-09-16T01:00:00Z", "from defaults to today and to to a week out");
});

test("a failed refresh still answers from the copy and reports it in warnings and freshness[].error", async () => {
  fake.failNext(new ProviderUnavailable("down", 503));
  const today = await scheduleAt("2026-09-09T17:10:00Z").today();
  assert.deepEqual(titles(today.timed), ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Lunch", "E:Cancelled review"], "the copy still answers");
  assert.deepEqual(today.freshness, [{ calendarId: personal.id, name: "Personal", syncedAt: "2026-09-09T17:00:00Z", ageSeconds: 600, refreshed: false, error: "ProviderUnavailable: down" }]);
  assert.equal(today.warnings.length, 1);
  assert.match(today.warnings[0]!, /Calendar "Personal" .* could not be refreshed: ProviderUnavailable: down\. Answering from the copy synced at 2026-09-09T17:00:00Z/);

  const noAdapter = await scheduleAt("2026-09-09T17:10:00Z", {}).week({ days: 1 });
  assert.equal(noAdapter.freshness[0]!.error, "No google adapter is configured");
  assert.match(noAdapter.warnings[0]!, /No google adapter is configured/);
  assert.deepEqual(titles(noAdapter.days[0]!.allDay), ["E:Offsite", "T:Walk in the park"]);
});

test("LIFE_CAL_MAX_AGE sets the threshold, fresh: false skips the refresh, and a later refresh clears the recorded error", async () => {
  assert.equal(maxAgeFromEnv({}), 300);
  assert.equal(maxAgeFromEnv({ LIFE_CAL_MAX_AGE: "abc" }), 300);
  assert.equal(maxAgeFromEnv({ LIFE_CAL_MAX_AGE: "0" }), 0);
  assert.equal(maxAgeFromEnv({ LIFE_CAL_MAX_AGE: "1200" }), 1200);

  const schedule = scheduleAt("2026-09-09T17:20:00Z");
  process.env.LIFE_CAL_MAX_AGE = "3600";
  try {
    const before = pages();
    const today = await schedule.today();
    assert.equal(pages(), before, "twenty minutes is under an hour");
    assert.deepEqual(today.freshness, [{ calendarId: personal.id, name: "Personal", syncedAt: "2026-09-09T17:00:00Z", ageSeconds: 1200, refreshed: false, error: "ProviderUnavailable: down" }], "the last sync's failure is still reported until a sync succeeds");
    assert.deepEqual(today.warnings, [], "but nothing failed this time");
  } finally {
    delete process.env.LIFE_CAL_MAX_AGE;
  }

  const before = pages();
  const stale = await schedule.today({ fresh: false });
  assert.equal(pages(), before, "fresh: false never asks the provider");
  assert.equal(stale.freshness[0]!.refreshed, false);

  const refreshed = await schedule.today();
  assert.equal(pages(), before + 1);
  assert.deepEqual(refreshed.freshness, [{ calendarId: personal.id, name: "Personal", syncedAt: "2026-09-09T17:20:00Z", ageSeconds: 0, refreshed: true, error: null }]);
  assert.deepEqual(refreshed.warnings, []);
});

test("a stale calendar whose account needs re-authorization is reported as unrefreshed, not silently answered from an old copy", async () => {
  const id = newId("account");
  okRecord(
    await mutate(db.store, clock, "account", "account.add", neel, async (_tx, _c, now) =>
      okMutation("created", null, { id, provider: "google", identity: "work@example.com", label: null, primary: false, status: "connected", scopes: [], syncedAt: null, version: 1, createdAt: now, updatedAt: now, deletedAt: null }),
    ),
  );
  fake.seed(id, { id: "work@example.com", name: "Work", color: null, timezone: LA, writable: true, primary: true, hidden: false }, [timed("review", "Design review", "2026-09-09T20:00:00Z", "2026-09-09T21:00:00Z")]);
  await syncAccount(db.store, clock, fake, id);
  okRecord(
    await mutate(db.store, clock, "account", "account.update", neel, async (tx, _c, now) => {
      const current = (await tx.get("account", id))!;
      return okMutation("updated", current, { ...current, status: "needs_reauth", version: current.version + 1, updatedAt: now });
    }),
  );

  const before = pages();
  const today = await scheduleAt("2026-09-09T17:30:00Z").today();
  assert.equal(pages(), before + 1, "only the connected account's calendar was pulled");
  assert.ok(titles(today.timed).includes("E:Design review"), "the copy still answers");
  const work = today.freshness.find((f) => f.name === "Work");
  assert.ok(work);
  assert.equal(work.refreshed, false);
  assert.equal(work.syncedAt, NOW);
  assert.match(work.error ?? "", /work@example\.com needs re-authorization/);
  assert.equal(today.warnings.length, 1);
  assert.match(today.warnings[0]!, /Calendar "Work" .* needs re-authorization/);
  assert.equal(today.freshness.find((f) => f.name === "Personal")!.error, null);

  const stale = await scheduleAt("2026-09-09T17:30:00Z").today({ fresh: false });
  assert.equal(stale.freshness.find((f) => f.name === "Work")!.error, null, "with fresh: false nothing was asked for, so nothing failed");
});

test("a floating event happens at its wall clock in the display zone: week places it, slots block it, and another zone reads the same clock", async () => {
  // Stored as 10:00Z with no zone (time.ts): 10:00 wherever Neel is. Read as an instant it would be 03:00 in Los Angeles, outside working hours.
  fake.seed(account.id, personalCal, [
    { id: "pages", title: "Morning pages", start: { at: "2026-09-12T10:00:00Z", timezone: null }, end: { at: "2026-09-12T11:00:00Z", timezone: null }, busy: true },
    { id: "latenight", title: "Late call", start: { at: "2026-09-12T23:30:00Z", timezone: null }, end: { at: "2026-09-13T00:30:00Z", timezone: null }, busy: true },
  ]);
  const report = await syncAccount(db.store, clock, fake, account.id);
  assert.deepEqual(report.calendars.find((c) => c.calendarId === personal.id), { calendarId: personal.id, outcome: "synced", created: 2, updated: 0, deleted: 0 });

  const la = await scheduleAt().week({ from: "2026-09-12", days: 2 });
  assert.deepEqual(titles(la.days[0]!.timed), ["E:Morning pages", "E:Late call"], "both on Saturday, ordered by their wall clocks");
  assert.deepEqual(titles(la.days[1]!.timed), ["E:Late call"], "a floating event past midnight touches the next day too");
  const pages = la.days[0]!.timed[0]!;
  assert.ok(pages.kind === "event");
  assert.deepEqual(pages.occurrence.start, { at: "2026-09-12T10:00:00Z", timezone: null }, "the occurrence keeps the floating encoding");
  assert.equal(pages.occurrence.occurrenceId, `${(await rowByExternal("pages")).id}@2026-09-12T10:00:00Z`);

  const saturday = await scheduleAt().slots({ duration: 60, from: "2026-09-12", to: "2026-09-12", hours: { start: "09:00", end: "18:00", days: [6] } });
  assert.deepEqual(saturday.slots, [
    { start: "2026-09-12T16:00:00Z", end: "2026-09-12T17:00:00Z" }, // 09:00 to 10:00 LA
    { start: "2026-09-12T18:00:00Z", end: "2026-09-13T01:00:00Z" }, // 11:00 to 18:00 LA
  ], "10:00 to 11:00 Los Angeles is busy, not 03:00 to 04:00");

  // Read in Kolkata the same rows sit at 10:00 and 23:30 there: the same days, the same clocks.
  const kolkata = createSchedule(db.store, fixedClock(NOW, "Asia/Kolkata"), { tasks, adapters: { google: fake } });
  const india = await kolkata.week({ from: "2026-09-12", days: 2 });
  assert.deepEqual(titles(india.days[0]!.timed), ["E:Morning pages", "E:Late call"]);
  assert.deepEqual(titles(india.days[1]!.timed), ["E:Late call"]);
  const indiaSlots = await kolkata.slots({ duration: 60, from: "2026-09-12", to: "2026-09-12", hours: { start: "09:00", end: "12:00", days: [6] } });
  assert.deepEqual(indiaSlots.slots, [{ start: "2026-09-12T03:30:00Z", end: "2026-09-12T04:30:00Z" }, { start: "2026-09-12T05:30:00Z", end: "2026-09-12T06:30:00Z" }], "09:00 to 10:00 and 11:00 to 12:00 Kolkata");
});
