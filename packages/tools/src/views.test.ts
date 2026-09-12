import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Filter, Label, Project, Receipt, Section, Task, TaskAdd, Title } from "./contract.ts";
import type { Clock } from "./core.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { createSchedule, type Schedule } from "./calendar/schedule.ts";
import { FakeCatalog } from "./media/catalog/adapter.ts";
import { createTitles } from "./media/titles.ts";
import { createOrganize, type Organize } from "./organize.ts";
import { createTasks, type TaskOps } from "./tasks.ts";
import { MAX_UPCOMING_DAYS, createViews, type Views } from "./views.ts";

// 2026-09-06T12:00Z is 05:00 in Los Angeles, so "today" is 2026-09-06 (a Sunday).
const clock = fixedClock("2026-09-06T12:00:00Z");
const neel: Ctx = { actor: "neel" };
const codex: Ctx = { actor: "codex", reason: "inferred from notes", evidence: ["vault:Areas/Health.md#2026-09-04"] };

let db: TestDb;
let org: Organize;
let tasks: TaskOps;
let schedule: Schedule;
let views: Views;

/** Views over a clock; the schedule half has no adapters, as a todo-only install has none. */
const viewsAt = (at: Clock): Views => createViews(db.store, at, tasks, org, createSchedule(db.store, at, { tasks }));

/** Assert a receipt is ok and hand back its record. */
function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

const ids = (list: Task[]): string[] => list.map((t) => t.id);
const mk = async (title: string, extra: Partial<TaskAdd> = {}, ctx: Ctx = neel): Promise<Task> => okRecord(await tasks.add({ title, allowDuplicate: true, ...extra }, ctx), title);
const project = async (name: string, extra: { parent?: string; labels?: string[] } = {}): Promise<Project> => okRecord(await org.project.add({ name, ...extra }, neel), name);

// The fixture set every view is read against. Titles are unique so search results are unambiguous.
let health: Project;
let work: Project;
let plan: Section;
let overdueFilter: Filter;
let rent: Task; // due 09-01
let passport: Task; // due 09-05, deadline 09-01, in_progress
let dentist: Task; // due 09-06 09:00, health/dental
let walk: Task; // due 09-06, health, @urgent, p2
let report: Task; // deadline 09-06, work, undated
let taxes: Task; // due 09-10, deadline 09-03
let book: Task; // undated, a comment mentioning Dr. Sharma
let labs: Task; // proposed, due 09-06, health
let physio: Task; // proposed, undated
let chore: Task; // done, due 09-06
let idea: Task; // cancelled, due 09-07
let trashed: Task; // deleted, due 09-06
let sprint: Task; // due 09-08, work
let far: Task; // deadline 09-08, undated
let milk: Task; // undated, notes "at the Corner Store"

before(async () => {
  db = await createTestDb();
  org = createOrganize(db.store, clock);
  tasks = createTasks(db.store, clock, org);
  schedule = createSchedule(db.store, clock, { tasks });
  views = createViews(db.store, clock, tasks, org, schedule);

  health = await project("Health", { labels: ["health"] });
  await project("Dental", { parent: "health" });
  work = await project("Work", { labels: ["work"] });
  plan = okRecord(await org.section.add({ project: "health", name: "Plan" }, neel));
  overdueFilter = okRecord(await org.filter.add({ name: "Overdue tasks", query: "overdue" }, neel));

  rent = await mk("Pay rent", { due: { date: "2026-09-01" } });
  passport = await mk("Renew passport", { due: { date: "2026-09-05" }, deadline: "2026-09-01" });
  passport = okRecord(await tasks.start(passport.id, neel));
  dentist = await mk("Call the dentist", { project: "health/dental", due: { date: "2026-09-06", time: "09:00", timezone: "America/Los_Angeles" } });
  walk = await mk("Walk in the park", { project: "health", due: { date: "2026-09-06" }, labels: ["urgent"], priority: 2 });
  report = await mk("Submit report", { project: "work", deadline: "2026-09-06" });
  taxes = await mk("File taxes", { due: { date: "2026-09-10" }, deadline: "2026-09-03" });
  book = await mk("Read a book");
  book = okRecord(await tasks.note(book.id, "Ask Dr. Sharma about the MRI", codex));
  labs = await mk("Check lab results", { project: "health", due: { date: "2026-09-06" } }, codex);
  physio = await mk("Book a physio", {}, codex);
  chore = await mk("Old chore", { due: { date: "2026-09-06" } });
  chore = okRecord(await tasks.complete(chore.id, neel));
  idea = await mk("Dropped idea", { due: { date: "2026-09-07" } });
  idea = okRecord(await tasks.cancel(idea.id, { actor: "neel", reason: "not needed" }));
  trashed = await mk("Trashed thing", { due: { date: "2026-09-06" } });
  trashed = okRecord(await tasks.delete(trashed.id, neel));
  sprint = await mk("Plan sprint", { project: "work", due: { date: "2026-09-08" } });
  far = await mk("Deadline far", { deadline: "2026-09-08" });
  milk = await mk("Buy milk", { notes: "at the Corner Store" });

  assert.equal(passport.status, "in_progress");
  assert.equal(labs.status, "proposed");
  assert.equal(physio.status, "proposed");
  assert.equal(chore.status, "done");
  assert.equal(idea.status, "cancelled");
  assert.ok(trashed.deletedAt);
});
after(() => db.drop());

// ------------------------------------------------------------------ today

test("today splits overdue, due, deadlines, and proposed for the clock's date", async () => {
  const view = await views.today();
  assert.equal(view.date, "2026-09-06");
  assert.equal(view.timezone, "America/Los_Angeles");
  assert.deepEqual(ids(view.overdue), [rent.id, passport.id], "overdue: accepted and in-progress tasks due before today, by due date");
  assert.deepEqual(ids(view.due), [dentist.id, walk.id], "due: timed task first; proposed, done, cancelled, deleted excluded");
  assert.deepEqual(ids(view.deadlines), [passport.id, taxes.id, report.id], "deadlines: today or past regardless of due, by deadline");
  assert.deepEqual(ids(view.proposed), [labs.id, physio.id], "proposed: every proposed task, dated first");
  assert.ok(!ids(view.due).includes(labs.id), "a proposed task due today is in proposed, not due");
  assert.ok(!ids(view.deadlines).includes(far.id), "a future deadline is not listed");
});

test("today takes a date, absolute or relative", async () => {
  const later = await views.today({ date: "2026-09-10" });
  assert.equal(later.date, "2026-09-10");
  assert.deepEqual(ids(later.overdue), [rent.id, passport.id, dentist.id, walk.id, sprint.id]);
  assert.deepEqual(ids(later.due), [taxes.id]);
  assert.deepEqual(ids(later.deadlines), [passport.id, taxes.id, report.id, far.id]);
  assert.deepEqual(ids(later.proposed), [labs.id, physio.id]);

  const tomorrow = await views.today({ date: "tomorrow" });
  assert.equal(tomorrow.date, "2026-09-07");
  assert.deepEqual(ids(tomorrow.overdue), [rent.id, passport.id, dentist.id, walk.id]);
  assert.deepEqual(ids(tomorrow.due), [], "the cancelled task due tomorrow is not due");
  assert.deepEqual(ids(tomorrow.deadlines), [passport.id, taxes.id, report.id]);
  assert.equal((await views.today({ date: "+4d" })).date, "2026-09-10");

  await assert.rejects(views.today({ date: "next week" }), /today: date: expected YYYY-MM-DD.*got "next week"/);
  await assert.rejects(views.today({ date: "2026-02-30" }), /today: date:/);
});

test("today's date comes from the clock's timezone, not UTC", async () => {
  const instant = "2026-09-06T23:30:00Z"; // 16:30 in Los Angeles, 05:00 on the 7th in Kolkata
  const losAngeles = viewsAt(fixedClock(instant, "America/Los_Angeles"));
  const kolkata = viewsAt(fixedClock(instant, "Asia/Kolkata"));
  const west = await losAngeles.today();
  const east = await kolkata.today();
  assert.equal(west.date, "2026-09-06");
  assert.equal(west.timezone, "America/Los_Angeles");
  assert.deepEqual(ids(west.due), [dentist.id, walk.id]);
  assert.equal(east.date, "2026-09-07");
  assert.equal(east.timezone, "Asia/Kolkata");
  assert.deepEqual(ids(east.overdue), [rent.id, passport.id, dentist.id, walk.id], "yesterday's due tasks are overdue in Kolkata");
  assert.deepEqual(ids(east.due), []);
});

test("today carries the schedule fields; with no accounts they hold only the dated tasks and the todo lists are unchanged", async () => {
  const view = await views.today();
  assert.deepEqual(Object.keys(view), ["date", "timezone", "overdue", "due", "deadlines", "proposed", "allDay", "timed", "freshness", "warnings"]);
  assert.deepEqual(view.freshness, [], "no calendar to report on");
  assert.deepEqual(view.warnings, []);
  assert.deepEqual(
    view.allDay.map((e) => (e.kind === "task" ? e.task.id : e.occurrence.id)),
    [walk.id],
    "date-only committed tasks due today; not the proposed, done, or deleted ones",
  );
  assert.deepEqual(
    view.timed.map((e) => (e.kind === "task" ? e.task.id : e.occurrence.id)),
    [dentist.id],
    "the timed task sits in the timed list",
  );
  const { allDay: _a, timed: _t, freshness: _f, warnings: _w, ...lists } = view;
  const scheduleOnly = await schedule.today();
  assert.deepEqual({ ...lists, ...scheduleOnly }, view, "the view is the todo lists plus the schedule, nothing else");
  assert.deepEqual(ids(lists.due), [dentist.id, walk.id]);
  assert.equal(view.overdue.some((t) => t.id === rent.id), true, "overdue tasks stay in overdue and are not on the day's schedule");
  assert.equal(view.allDay.some((e) => e.kind === "task" && e.task.id === rent.id), false);
});

test("week and slots are the schedule's, reachable from the views", async () => {
  const week = await views.week({ from: "2026-09-06", days: 3 });
  assert.equal(week.from, "2026-09-06");
  assert.equal(week.to, "2026-09-08");
  assert.equal(week.timezone, "America/Los_Angeles");
  assert.deepEqual(week.days.map((d) => d.date), ["2026-09-06", "2026-09-07", "2026-09-08"]);
  assert.deepEqual(week.days[0]!.timed.map((e) => (e.kind === "task" ? e.task.id : "")), [dentist.id]);
  assert.deepEqual(week.days[2]!.allDay.map((e) => (e.kind === "task" ? e.task.id : "")), [sprint.id]);
  assert.deepEqual(week.freshness, []);
  const slots = await views.slots({ duration: 60, from: "2026-09-07", to: "2026-09-07" });
  assert.deepEqual(slots, { slots: [{ start: "2026-09-07T16:00:00Z", end: "2026-09-08T01:00:00Z" }], freshness: [], warnings: [] });
  await assert.rejects(views.week({ days: 0 }), /week: days: expected an integer from 1 to 366/);
  await assert.rejects(views.slots({ duration: 0, from: "2026-09-07", to: "2026-09-07" }), /slots: duration:/);
});

// ------------------------------------------------------------------ upcoming

test("upcoming lays out one entry per day, empty days included, with overdue under the first day", async () => {
  const view = await views.upcoming(3);
  assert.equal(view.from, "2026-09-06");
  assert.equal(view.to, "2026-09-08");
  assert.deepEqual(
    view.days.map((day) => ({ date: day.date, tasks: ids(day.tasks) })),
    [
      { date: "2026-09-06", tasks: [rent.id, passport.id, dentist.id, walk.id] },
      { date: "2026-09-07", tasks: [] },
      { date: "2026-09-08", tasks: [sprint.id] },
    ],
    "overdue first (by due date), then today's timed task, then by priority; the cancelled task on the 7th is gone; the proposed task due today is not laid out",
  );
  const allListed = view.days.flatMap((day) => ids(day.tasks));
  for (const undated of [book.id, physio.id, report.id, far.id, milk.id]) assert.ok(!allListed.includes(undated), `${undated} is undated and excluded`);
  assert.ok(!allListed.includes(chore.id) && !allListed.includes(trashed.id), "done and deleted tasks are excluded");
  assert.ok(!allListed.includes(taxes.id), "a task due after the window is excluded");
  assert.ok(!allListed.includes(labs.id), "a proposed task is not upcoming, like today's overdue and due lists");
  assert.ok(ids((await views.today()).proposed).includes(labs.id), "it is in today's proposed list instead");
});

test("upcoming lays out the same statuses as today: a proposed task joins it once accepted", async () => {
  const review = await mk("Review the proposal", { due: { date: "2026-09-07" } }, codex);
  assert.equal(review.status, "proposed");
  assert.deepEqual(ids((await views.upcoming(3)).days[1]!.tasks), [], "proposed: not on its day");
  assert.ok(ids((await views.today()).proposed).includes(review.id), "only in today's proposed list");
  okRecord(await tasks.accept(review.id, neel));
  assert.deepEqual(ids((await views.upcoming(3)).days[1]!.tasks), [review.id], "accepted: on its day");
  okRecord(await tasks.start(review.id, neel));
  assert.deepEqual(ids((await views.upcoming(3)).days[1]!.tasks), [review.id], "in progress: still on its day");
  okRecord(await tasks.cancel(review.id, { actor: "neel", reason: "fixture, not needed" }));
  assert.deepEqual(ids((await views.upcoming(3)).days[1]!.tasks), []);
});

test("upcoming defaults to seven days from today and accepts a from date", async () => {
  const week = await views.upcoming();
  assert.equal(week.days.length, 7);
  assert.equal(week.from, "2026-09-06");
  assert.equal(week.to, "2026-09-12");
  assert.deepEqual(
    week.days.map((day) => day.date),
    ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"],
  );
  assert.deepEqual(ids(week.days[4]!.tasks), [taxes.id], "the 10th holds the tax task");

  const shifted = await views.upcoming(2, { from: "2026-09-08" });
  assert.equal(shifted.from, "2026-09-08");
  assert.equal(shifted.to, "2026-09-09");
  assert.deepEqual(ids(shifted.days[0]!.tasks), [rent.id, passport.id, dentist.id, walk.id, sprint.id], "everything accepted or in progress before the from date is overdue under the first day");
  assert.deepEqual(ids(shifted.days[1]!.tasks), []);
  assert.deepEqual(await views.upcoming(2, { from: "+2d" }), shifted, "relative from dates resolve against the clock's today");

  await assert.rejects(views.upcoming(0), /upcoming: days: expected an integer from 1 to 366, got 0/);
  await assert.rejects(views.upcoming(1.5), /upcoming: days:/);
  await assert.rejects(views.upcoming(MAX_UPCOMING_DAYS + 1), /upcoming: days:/);
  await assert.rejects(views.upcoming(7, { from: "soon" }), /upcoming: from: expected YYYY-MM-DD.*got "soon"/);
});

// ------------------------------------------------------------------ label

test("label lists open tasks carrying the label directly or through their project, sorted like list", async () => {
  assert.deepEqual(ids(await views.label("health")), [dentist.id, walk.id, labs.id], "a sub-project inherits the label; proposed counts as open");
  assert.deepEqual(ids(await views.label("Health")), [dentist.id, walk.id, labs.id], "names are case-insensitive");
  const healthLabel = await org.label.get("health");
  assert.ok(healthLabel);
  assert.deepEqual(ids(await views.label(healthLabel.id)), [dentist.id, walk.id, labs.id], "an id works too");
  assert.deepEqual(ids(await views.label("urgent")), [walk.id], "a label carried directly");
  assert.deepEqual(ids(await views.label("work")), [sprint.id, report.id], "dated first, undated last");
  await assert.rejects(views.label("nope"), /label: no label "nope"/);
  await assert.rejects(views.label("  "), /label: a label name or id is required/);
});

// ------------------------------------------------------------------ filter

test("filter runs a saved filter by name or id and an ad hoc query", async () => {
  assert.deepEqual(ids(await views.filter("Overdue tasks")), [rent.id, passport.id]);
  assert.deepEqual(ids(await views.filter(overdueFilter.id)), [rent.id, passport.id]);
  assert.deepEqual(ids(await views.filter("@health & today")), [dentist.id, walk.id, labs.id]);
  assert.deepEqual(ids(await views.filter("done")), [chore.id], "a query that mentions status lifts the open-only default");
  await assert.rejects(views.filter("bogus term"), /neither a saved filter nor a valid query/);
});

// ------------------------------------------------------------------ search

test("search matches title, notes, and comments case-insensitively and includes closed tasks", async () => {
  assert.deepEqual(ids(await views.search("dentist")), [dentist.id], "title");
  assert.deepEqual(ids(await views.search("DENTIST")), [dentist.id], "case-insensitive");
  assert.deepEqual(ids(await views.search("sharma")), [book.id], "a comment");
  assert.deepEqual(ids(await views.search("corner store")), [milk.id], "notes");
  assert.deepEqual(ids(await views.search("old chore")), [chore.id], "done tasks are included");
  assert.deepEqual(ids(await views.search("dropped")), [idea.id], "cancelled tasks are included");
  assert.deepEqual(ids(await views.search("trashed")), [], "deleted tasks are not");
  assert.deepEqual(ids(await views.search("a")), ids(await tasks.list({ text: "a", includeClosed: true })), "sorted like list");
  await assert.rejects(views.search("   "), /search: text is required/);
});

// ------------------------------------------------------------------ trash

test("trash lists deleted records of every kind, newest deletion first", async () => {
  const initial = await views.trash();
  assert.deepEqual(Object.keys(initial), ["tasks", "projects", "sections", "labels", "filters", "events", "calendars", "accounts", "titles"]);
  assert.deepEqual(ids(initial.tasks), [trashed.id]);
  assert.deepEqual(initial.projects, []);
  assert.deepEqual(initial.sections, []);
  assert.deepEqual(initial.labels, []);
  assert.deepEqual(initial.filters, []);
  assert.deepEqual([initial.events, initial.calendars, initial.accounts, initial.titles], [[], [], [], []]);

  // A clock that steps a minute per deletion, so "newest first" is observable.
  let tick = Date.parse("2026-09-06T13:00:00Z");
  const stepping: Clock = { now: () => new Date(tick), timezone: "America/Los_Angeles" };
  const step = () => (tick += 60_000);
  const orgLater = createOrganize(db.store, stepping);
  const tasksLater = createTasks(db.store, stepping, orgLater);
  const fake = (source: "tmdb" | "openlibrary" | "igdb") => new FakeCatalog({ source });
  const titlesLater = createTitles(db.store, stepping, { catalogs: { tmdb: fake("tmdb"), openlibrary: fake("openlibrary"), igdb: fake("igdb") } });

  const spare: Label = okRecord(await orgLater.label.add({ name: "spare" }, neel));
  step();
  okRecord(await orgLater.label.delete("spare", neel));
  step();
  okRecord(await orgLater.filter.delete("Overdue tasks", neel));
  step();
  okRecord(await orgLater.section.delete(plan.id, neel));
  step();
  okRecord(await orgLater.project.delete("work", neel, { contents: "delete" }));
  step();
  okRecord(await tasksLater.delete(book.id, neel));
  step();
  const kept = okRecord<Title>(await titlesLater.add({ medium: "game", name: "Kept Game", lookup: false }, neel));
  const olderTitle = okRecord<Title>(await titlesLater.add({ medium: "movie", name: "Older Deleted Movie", lookup: false }, neel));
  okRecord(await titlesLater.delete(olderTitle.id, neel));
  step();
  const newerTitle = okRecord<Title>(await titlesLater.add({ medium: "book", name: "Newer Deleted Book", lookup: false }, neel));
  okRecord(await titlesLater.delete(newerTitle.id, neel));

  const view = await views.trash();
  const cascaded = [report.id, sprint.id].sort();
  assert.deepEqual(ids(view.tasks), [book.id, ...cascaded, trashed.id], "newest first; the two deleted with the project tie and sort by id");
  assert.deepEqual(view.projects.map((p) => p.id), [work.id]);
  assert.deepEqual(view.sections.map((s) => s.id), [plan.id]);
  assert.deepEqual(view.labels.map((l) => l.id), [spare.id]);
  assert.deepEqual(view.filters.map((f) => f.id), [overdueFilter.id]);
  assert.deepEqual(
    view.tasks.map((t) => t.deletedAt),
    ["2026-09-06T13:05:00Z", "2026-09-06T13:04:00Z", "2026-09-06T13:04:00Z", "2026-09-06T12:00:00Z"],
  );
  assert.deepEqual(view.titles.map((t) => t.id), [newerTitle.id, olderTitle.id], "titles too, newest deletion first; there is no separate media trash");
  assert.deepEqual(view.titles.map((t) => t.deletedAt), ["2026-09-06T13:07:00Z", "2026-09-06T13:06:00Z"]);
  assert.ok(!view.titles.some((t) => t.id === kept.id), "a live title stays out");
  for (const list of [view.tasks, view.projects, view.sections, view.labels, view.filters, view.titles]) {
    for (const record of list) assert.ok(record.deletedAt, `${record.id} is deleted`);
  }
  assert.ok(!view.projects.some((p) => p.id === health.id), "live records stay out");

  // The other views no longer see what went to the trash.
  assert.deepEqual(ids(await views.label("work")), []);
  assert.deepEqual(ids(await views.search("sharma")), []);
  assert.ok(!ids((await views.upcoming(3)).days[2]!.tasks).includes(sprint.id));
});
