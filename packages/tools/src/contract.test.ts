import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ID_PREFIXES,
  accountSchema,
  accountUpdateSchema,
  calendarSchema,
  calendarUpdateSchema,
  ctxSchema,
  endsAfterStart,
  eventAddSchema,
  eventPatchSchema,
  eventSchema,
  eventUpdateSchema,
  eventWriteSchema,
  filterSchema,
  issuesOf,
  projectSchema,
  recordId,
  taskAddSchema,
  taskSchema,
  type Account,
  type Calendar,
  type Event,
  type Task,
} from "./contract.ts";

const now = "2026-09-06T12:00:00Z";
const origin = { actor: "neel", at: now, evidence: [] };
const task: Task = {
  id: "t_abcdefghij",
  title: "Schedule six-month dental cleaning",
  notes: "",
  projectId: "p_abcdefghij",
  order: 0,
  status: "accepted",
  executor: "neel",
  due: { date: "2026-10-21" },
  deadline: null,
  labels: ["health"],
  comments: [],
  occurrences: [],
  origin,
  external: [],
  completedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

test("a well-formed task validates and the bad ones say why", () => {
  assert.equal(taskSchema.safeParse(task).success, true);
  const cases: [Partial<Task> | Record<string, unknown>, RegExp][] = [
    [{ id: "p_abcdefghij" }, /task id/],
    [{ due: { date: "2026-10-21", time: "09:00" } }, /timezone/],
    [{ due: { date: "2026-13-01" } }, /YYYY-MM-DD/],
    [{ repeat: "FREQ=WEEKLY;BYDAY=MO", due: null }, /repeating task needs a due date/],
    [{ repeat: "FREQ=HOURLY" }, /Unsupported FREQ/],
    [{ executor: "someone" }, /Executor/],
    [{ labels: ["Health"] }, /lowercase/],
    [{ priority: 5 }, /priority/],
    [{ parentId: "p_abcdefghij" }, /task id/],
    [{ bogus: true }, /Unrecognized/],
  ];
  for (const [patch, expected] of cases) {
    const result = taskSchema.safeParse({ ...task, ...patch });
    assert.equal(result.success, false, JSON.stringify(patch));
    if (!result.success) assert.match(issuesOf(result.error).join("\n"), expected);
  }
});

test("add input accepts references and rejects closed statuses", () => {
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", project: "inbox" }).success, true);
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", project: "health/dental", section: "Booking" }).success, true);
  assert.equal(taskAddSchema.safeParse({ title: "Buy milk", status: "done" }).success, false);
  assert.equal(taskAddSchema.safeParse({ title: " " }).success, false);
});

test("projects, filters and contexts validate their own rules", () => {
  const project = {
    id: "p_abcdefghij",
    name: "Health",
    slug: "health",
    parentId: null,
    layout: "list",
    order: 0,
    labels: ["health"],
    archived: false,
    system: false,
    origin,
    external: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.equal(projectSchema.safeParse({ ...project, slug: "Health Area" }).success, false);
  const filter = { id: "f_abcdefghij", name: "Health today", query: "today & @health", order: 0, origin, version: 1, createdAt: now, updatedAt: now, deletedAt: null };
  assert.equal(filterSchema.safeParse(filter).success, true);
  const broken = filterSchema.safeParse({ ...filter, query: "next week" });
  assert.equal(broken.success, false);
  if (!broken.success) assert.match(issuesOf(broken.error).join(), /Unknown filter term/);
  assert.equal(ctxSchema.safeParse({ actor: "codex", evidence: ["vault:Areas/Health.md"] }).success, true);
  assert.equal(ctxSchema.safeParse({ actor: "somebody" }).success, false);
  assert.equal(ctxSchema.safeParse({}).success, false);
});

test("a ctx key may carry ordinary punctuation but no control characters", () => {
  assert.equal(ctxSchema.safeParse({ actor: "neel", key: "vault:Areas/Health.md#2026-09-04 (retry 2)" }).success, true);
  const bad = ctxSchema.safeParse({ actor: "neel", key: `a${String.fromCodePoint(0x1f)}0` });
  assert.equal(bad.success, false);
  if (bad.success) throw new Error("unreachable");
  assert.deepEqual(issuesOf(bad.error), ["key: No control characters"]);
});

// ------------------------------------------------------------------ calendar records

const account: Account = {
  id: "a_abcdefghij",
  provider: "google",
  identity: "neel@gmail.com",
  label: null,
  primary: true,
  status: "connected",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
  syncedAt: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const calendar: Calendar = {
  id: "c_abcdefghij",
  accountId: "a_abcdefghij",
  name: "Personal",
  color: null,
  timezone: "America/Los_Angeles",
  labels: ["health"],
  writable: true,
  hidden: false,
  primaryOfAccount: true,
  order: 0,
  external: { id: "neel@gmail.com", syncToken: null },
  syncedAt: null,
  syncError: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const event: Event = {
  id: "e_abcdefghij",
  calendarId: "c_abcdefghij",
  accountId: "a_abcdefghij",
  title: "Dentist",
  notes: null,
  location: null,
  start: { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" },
  end: { at: "2026-09-10T17:00:00Z", timezone: "America/Los_Angeles" },
  repeat: null,
  masterId: null,
  originalStart: null,
  status: "confirmed",
  busy: true,
  organizer: null,
  attendees: [],
  myResponse: null,
  conferencing: null,
  reminders: null,
  origin,
  external: { provider: "google", id: "g1", etag: "e1", iCalUID: "g1@google.com", updatedAt: now },
  version: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

/** Assert each patch makes `schema` reject `base`, and the issue text matches. */
function rejects<T extends object>(schema: { safeParse(v: unknown): { success: boolean; error?: unknown } }, base: T, cases: [Record<string, unknown>, RegExp][]): void {
  for (const [patch, expected] of cases) {
    const result = schema.safeParse({ ...base, ...patch });
    assert.equal(result.success, false, `should reject ${JSON.stringify(patch)}`);
    if (!result.success) assert.match(issuesOf(result.error as Parameters<typeof issuesOf>[0]).join("\n"), expected, JSON.stringify(patch));
  }
}

test("the calendar kinds have id prefixes and recordId knows them", () => {
  assert.deepEqual([ID_PREFIXES.account, ID_PREFIXES.calendar, ID_PREFIXES.event], ["a", "c", "e"]);
  for (const id of ["a_abcdefghij", "c_abcdefghij", "e_abcdefghij", "t_abcdefghij"]) assert.equal(recordId.safeParse(id).success, true, id);
  assert.equal(recordId.safeParse("v_abcdefghij").success, false, "v_ is reserved, not a record");
  assert.equal(recordId.safeParse("e_ABCDEFGHIJ").success, false);
});

test("an account validates and the bad ones say why", () => {
  assert.equal(accountSchema.safeParse(account).success, true);
  assert.equal(accountSchema.safeParse({ ...account, label: "Work", status: "needs_reauth", syncedAt: now }).success, true);
  rejects(accountSchema, account, [
    [{ id: "c_abcdefghij" }, /id: Not a account id/],
    [{ provider: "icloud" }, /provider/],
    [{ status: "paused" }, /status/],
    [{ identity: " " }, /identity/],
    [{ scopes: "calendar" }, /scopes/],
    [{ syncedAt: "yesterday" }, /syncedAt/],
    [{ refreshToken: "secret" }, /Unrecognized/],
  ]);
});

test("a calendar validates and the bad ones say why", () => {
  assert.equal(calendarSchema.safeParse(calendar).success, true);
  assert.equal(calendarSchema.safeParse({ ...calendar, color: "#ff0000", external: { id: "x", syncToken: "tok" }, syncError: "410 Gone" }).success, true);
  rejects(calendarSchema, calendar, [
    [{ id: "a_abcdefghij" }, /id: Not a calendar id/],
    [{ accountId: "c_abcdefghij" }, /accountId/],
    [{ timezone: "Mars/Olympus" }, /Unknown timezone/],
    [{ labels: ["Health"] }, /labels.0: Use lowercase/],
    [{ external: { id: "x" } }, /external.syncToken/],
    [{ external: { id: "x", syncToken: null, extra: 1 } }, /Unrecognized/],
    [{ order: -1 }, /order/],
    [{ name: "" }, /name: Required/],
  ]);
});

test("an event validates timed, all-day, master, and exception shapes", () => {
  assert.equal(eventSchema.safeParse(event).success, true);
  const allDay = { ...event, start: { date: "2026-09-10" }, end: { date: "2026-09-11" }, busy: false };
  assert.equal(eventSchema.safeParse(allDay).success, true, "all-day");
  assert.equal(eventSchema.safeParse({ ...event, start: { at: "2026-09-10T16:00:00Z", timezone: null }, end: { at: "2026-09-10T17:00:00Z", timezone: null } }).success, true, "floating");
  const master = { ...event, repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=TH", exdates: ["2026-09-17T16:00:00Z"] } };
  assert.equal(eventSchema.safeParse(master).success, true, "master");
  const exception = {
    ...event,
    id: "e_exceptn001",
    masterId: "e_abcdefghij",
    originalStart: { at: "2026-09-24T16:00:00Z", timezone: "America/Los_Angeles" },
    start: { at: "2026-09-24T17:00:00Z", timezone: "America/Los_Angeles" },
    end: { at: "2026-09-24T18:00:00Z", timezone: "America/Los_Angeles" },
  };
  assert.equal(eventSchema.safeParse(exception).success, true, "exception row");
  const cancelled = { ...exception, status: "cancelled" };
  assert.equal(eventSchema.safeParse(cancelled).success, true, "cancelled occurrence");
  const invited = {
    ...event,
    organizer: { email: "boss@example.com", name: "Boss", self: false },
    attendees: [
      { email: "boss@example.com", name: "Boss", response: "accepted", self: false, optional: false },
      { email: "neel@gmail.com", name: null, response: "needsAction", self: true, optional: false },
    ],
    myResponse: "needsAction",
    conferencing: { kind: "meet", url: "https://meet.google.com/abc-defg-hij" },
    reminders: [{ method: "popup", minutes: 10 }],
  };
  assert.equal(eventSchema.safeParse(invited).success, true, "invitation");
});

test("an event's cross-field rules reject what the brief forbids", () => {
  rejects(eventSchema, event, [
    [{ id: "t_abcdefghij" }, /id: Not a event id/],
    [{ end: { date: "2026-09-11" } }, /end: Start and end must both be timed or both be dates/],
    [{ end: { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" } }, /end: End must be after start/],
    [{ end: { at: "2026-09-10T15:00:00Z", timezone: "America/Los_Angeles" } }, /end: End must be after start/],
    [{ start: { date: "2026-09-10" }, end: { date: "2026-09-10" } }, /end: End date must be after the start date \(it is exclusive\)/],
    [{ start: { date: "2026-09-10" }, end: { date: "2026-09-09" } }, /exclusive/],
    [{ start: { at: "2026-09-10T16:00:00Z", timezone: "Mars/Olympus" } }, /start.timezone: Unknown timezone/],
    [{ start: { at: "2026-09-10 16:00", timezone: null } }, /start/],
    [{ start: { date: "2026-13-01" }, end: { date: "2026-13-02" } }, /YYYY-MM-DD/],
    [{ masterId: "e_master0001", originalStart: { at: "2026-09-10T16:00:00Z", timezone: null }, repeat: { rrule: "FREQ=DAILY", exdates: [] } }, /repeat: Only a master carries a rule/],
    [{ masterId: "e_master0001" }, /originalStart: masterId and originalStart go together/],
    [{ originalStart: { at: "2026-09-10T16:00:00Z", timezone: null } }, /masterId: masterId and originalStart go together/],
    [{ masterId: "c_master0001", originalStart: { date: "2026-09-10" } }, /masterId: Not a event id/],
    [{ repeat: { rrule: "every thursday", exdates: [] } }, /repeat.rrule: Not an RRULE/],
    [{ repeat: { rrule: "FREQ=DAILY", exdates: ["tomorrow"] } }, /repeat.exdates.0/],
    [{ repeat: { rrule: "FREQ=DAILY" } }, /repeat.exdates/],
    [{ status: "maybe" }, /status/],
    [{ attendees: [{ email: "a@b.c", name: null, response: "yes", self: false, optional: false }] }, /attendees.0.response/],
    [{ attendees: [{ email: "a@b.c", name: null, response: "accepted", self: false }] }, /attendees.0.optional/],
    [{ myResponse: "yes" }, /myResponse/],
    [{ organizer: { email: "a@b.c", self: true } }, /organizer.name/],
    [{ conferencing: { kind: "meet" } }, /conferencing.url/],
    [{ reminders: [{ method: "popup", minutes: -5 }] }, /reminders.0.minutes/],
    [{ external: { provider: "icloud", id: "g1", etag: "e1", iCalUID: "u", updatedAt: now } }, /external.provider/],
    [{ external: { provider: "google", id: "g1", iCalUID: "u", updatedAt: now } }, /external.etag/],
    [{ title: " " }, /title: Required/],
    [{ location: "" }, /location/],
    [{ notes: undefined }, /notes/],
    [{ allDay: true }, /Unrecognized/],
  ]);
  assert.equal(endsAfterStart({ date: "2026-09-10" }, { at: "2026-09-11T00:00:00Z", timezone: null }), false, "mixed kinds never order");
});

test("event inputs accept what the CLI sends and reject contradictions", () => {
  const start = { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" };
  assert.equal(eventAddSchema.safeParse({ title: "Dentist", start }).success, true, "title and start suffice");
  assert.equal(eventAddSchema.safeParse({ title: "Dentist", start, duration: 30, calendar: "neel@gmail.com/Personal", repeat: "FREQ=WEEKLY;BYDAY=TH", busy: false, notes: "bring card", location: "12 Main St" }).success, true);
  assert.equal(eventAddSchema.safeParse({ title: "Trip", start: { date: "2026-09-10" }, end: { date: "2026-09-13" } }).success, true, "all-day span");
  assert.equal(eventAddSchema.safeParse({ title: "Trip", start: { date: "2026-09-10" }, duration: 3 }).success, true, "all-day duration in days");
  rejects(eventAddSchema, { title: "Dentist", start }, [
    [{ end: { at: "2026-09-10T17:00:00Z", timezone: null }, duration: 30 }, /duration: Give end or duration, not both/],
    [{ end: { date: "2026-09-11" } }, /end: Start and end must both be timed/],
    [{ end: { at: "2026-09-10T16:00:00Z", timezone: null } }, /end: End must be after start/],
    [{ duration: 0 }, /duration/],
    [{ repeat: "weekly" }, /repeat: Not an RRULE/],
    [{ start: { at: "2026-09-10T16:00:00Z" } }, /start/],
    [{ project: "inbox" }, /Unrecognized/],
  ]);

  assert.equal(eventUpdateSchema.safeParse({}).success, true, "an empty update is the operation's call, not the schema's");
  assert.equal(eventUpdateSchema.safeParse({ notes: null, location: null, repeat: null }).success, true, "null clears");
  assert.equal(eventUpdateSchema.safeParse({ start, status: "tentative", busy: true }).success, true, "a start alone is fine");
  rejects(eventUpdateSchema, {}, [
    [{ start, end: { date: "2026-09-11" } }, /end: Start and end must both be timed/],
    [{ start, end: { at: "2026-09-10T15:00:00Z", timezone: null } }, /end: End must be after start/],
    [{ end: { at: "2026-09-10T17:00:00Z", timezone: null }, duration: 15 }, /duration: Give end or duration/],
    [{ title: null }, /title/],
    [{ status: "cancelled", calendar: "x" }, /Unrecognized/],
  ]);

  const write = { title: "Dentist", notes: null, location: null, start, end: { at: "2026-09-10T17:00:00Z", timezone: "America/Los_Angeles" }, repeat: null, busy: true, status: "confirmed" };
  assert.equal(eventWriteSchema.safeParse(write).success, true);
  assert.equal(eventWriteSchema.safeParse({ ...write, repeat: { rrule: "FREQ=DAILY;COUNT=3", exdates: [] } }).success, true);
  rejects(eventWriteSchema, write, [
    [{ end: start }, /end: End must be after start/],
    [{ notes: undefined }, /notes/],
    [{ attendees: [] }, /Unrecognized/],
  ]);
  assert.equal(eventPatchSchema.safeParse({ title: "Dentist (moved)" }).success, true);
  assert.equal(eventPatchSchema.safeParse({ repeat: null, notes: null }).success, true);
  rejects(eventPatchSchema, {}, [
    [{ start, end: start }, /end: End must be after start/],
    [{ repeat: "FREQ=DAILY" }, /repeat/],
  ]);

  assert.equal(accountUpdateSchema.safeParse({ label: null }).success, true);
  assert.equal(accountUpdateSchema.safeParse({ label: "Work" }).success, true);
  assert.equal(accountUpdateSchema.safeParse({ primary: true }).success, false, "primary has its own operation");
  assert.equal(calendarUpdateSchema.safeParse({ labels: ["health"], hidden: true, color: null }).success, true);
  assert.equal(calendarUpdateSchema.safeParse({ labels: ["Health"] }).success, false);
  assert.equal(calendarUpdateSchema.safeParse({ name: "Renamed" }).success, false, "the name is the provider's");
});
