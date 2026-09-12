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
  entryId,
  entryInputSchema,
  entryPatchSchema,
  entrySchema,
  on,
  rating,
  taskAddSchema,
  taskSchema,
  titleAddSchema,
  titleId,
  titleListSchema,
  titleSchema,
  titleUpdateSchema,
  type Account,
  type Calendar,
  type Entry,
  type Event,
  type Task,
  type Title,
} from "./contract.ts";
import { finalize } from "./media/derive.ts";

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

// ------------------------------------------------------------------ library records

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "n_abcdefghij",
    type: "note",
    on: { date: "2026-09-07", precision: "day" },
    at: now,
    actor: "neel",
    text: "a thought",
    progress: null,
    format: null,
    rating: null,
    minutes: null,
    spend: null,
    where: null,
    evidence: [],
    ...overrides,
  };
}

/** A valid title over `entries`, its derived fields computed by finalize. */
function title(entries: Entry[], overrides: Partial<Title> = {}): Title {
  return finalize({
    id: "m_abcdefghij",
    medium: "book",
    name: "Skyward",
    aliases: ["Skyward (Sanderson)"],
    year: 2018,
    creators: ["Brandon Sanderson"],
    cover: "https://covers.openlibrary.org/b/id/1-L.jpg",
    length: { pages: 513, hours: 15.5 },
    facts: null,
    catalog: { source: "openlibrary", externalId: "OL17930368W", pulledAt: now },
    edited: [],
    series: { name: "Skyward", position: 1 },
    status: "curious",
    ownership: "none",
    ownershipDetail: null,
    priority: "soon",
    moodFit: ["immersive"],
    timeFit: "long",
    notes: null,
    detail: { format: "audiobook", platform: null, where: null },
    rating: null,
    review: null,
    liked: false,
    entries,
    origin,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  });
}

test("the title kind has the m prefix, recordId knows it, and entry ids are their own regex", () => {
  assert.equal(ID_PREFIXES.title, "m");
  assert.equal(recordId.safeParse("m_abcdefghij").success, true);
  assert.equal(titleId.safeParse("m_abcdefghij").success, true);
  assert.equal(titleId.safeParse("t_abcdefghij").success, false);
  assert.equal(recordId.safeParse("n_abcdefghij").success, false, "an entry is not a record");
  assert.equal(recordId.safeParse("ml_abcdefghij").success, false, "ml_ is reserved for lists");
  assert.equal(entryId.safeParse("n_abcdefghij").success, true);
  assert.equal(entryId.safeParse("n_ABCDEFGHIJ").success, false);
  assert.equal(entryId.safeParse("m_abcdefghij").success, false);
  assert.equal(entryId.safeParse("n_abcdefghi").success, false);
});

test("an On is spelled at its precision's grain and a week is a Monday", () => {
  for (const good of [
    { date: "2026-09-07", precision: "day" },
    { date: "2026-09-07", precision: "week" },
    { date: "2026-09", precision: "month" },
    { date: "2026", precision: "year" },
    { date: null, precision: "unknown" },
  ]) assert.equal(on.safeParse(good).success, true, JSON.stringify(good));
  rejects(on, { date: "2026-09-07", precision: "day" }, [
    [{ date: "2026-09-09", precision: "week" }, /date: A week's date is the Monday of its ISO week/],
    [{ date: "2026-09-31" }, /date: Use YYYY-MM-DD for a day/],
    [{ date: "2026-9", precision: "month" }, /date: Use YYYY-MM for a month/],
    [{ date: "2026-09-07", precision: "month" }, /date: Use YYYY-MM/],
    [{ date: "26", precision: "year" }, /date: Use YYYY for a year/],
    [{ date: null }, /date: A day needs a date/],
    [{ date: "2026-09-07", precision: "unknown" }, /date: An unknown date carries no date/],
    [{ precision: "approx" }, /precision/],
    [{ approx: true }, /Unrecognized/],
  ]);
  assert.equal(rating.safeParse(4.5).success, true);
  assert.equal(rating.safeParse(0.5).success, true);
  for (const bad of [0, 4.25, 5.5, -1, "4"]) {
    const result = rating.safeParse(bad);
    assert.equal(result.success, false, String(bad));
    if (!result.success) assert.match(issuesOf(result.error).join(), /Use half stars from 0.5 to 5/);
  }
});

test("an entry validates and its facet rules say why not", () => {
  assert.equal(entrySchema.safeParse(entry()).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "finish", rating: 4.5, text: "a review", format: "audiobook", minutes: 90 })).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "drop", rating: 1, text: "not fun anymore" })).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "buy", text: null, where: "Steam", spend: { amount: 59.99, currency: "USD", kind: "purchase" } })).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "return", text: null })).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "start", text: null, progress: "2 hours in", minutes: 120 })).success, true);
  assert.equal(entrySchema.safeParse(entry({ type: "finish", text: null, on: { date: null, precision: "unknown" } })).success, true, "a finish years ago");
  rejects(entrySchema, entry(), [
    [{ id: "m_abcdefghij" }, /id: Not an entry id/],
    [{ type: "rewatch" }, /type/],
    [{ rating: 4 }, /rating: Only a finish or drop carries a rating/],
    [{ type: "start", rating: 4 }, /rating: Only a finish or drop/],
    [{ type: "finish", rating: 4.25 }, /rating: Use half stars/],
    [{ type: "drop", text: null }, /text: A drop needs its reason as text/],
    [{ type: "buy", minutes: 30 }, /minutes: Only a progress-facet entry carries minutes/],
    [{ minutes: 0 }, /minutes/],
    [{ type: "finish", spend: { amount: 10, currency: "USD", kind: "rental" } }, /spend: Only buy, borrow, return, or service carries spend/],
    [{ type: "buy", spend: { amount: 10, currency: "usd", kind: "purchase" } }, /spend.currency: Use a three-letter currency code/],
    [{ type: "buy", spend: { amount: 10, currency: "USD" } }, /spend.kind/],
    [{ type: "buy", spend: { amount: -1, currency: "USD", kind: "purchase" } }, /spend.amount/],
    [{ type: "return", where: "Steam" }, /where: Only buy, borrow, or service carries where/],
    [{ type: "finish", where: "couch" }, /where: Only buy/],
    [{ on: { date: "2026-09-09", precision: "week" } }, /on.date: A week's date is the Monday/],
    [{ text: "" }, /text: Required/],
    [{ format: "paperback" }, /format/],
    [{ actor: "somebody" }, /actor/],
    [{ review: "x" }, /Unrecognized/],
  ]);
});

test("a title validates with its derived fields and rejects stale ones, bad detail, and duplicate entry ids", () => {
  const entries = [
    entry({ id: "n_0000000001", type: "want", text: null, on: { date: "2026-08", precision: "month" } }),
    entry({ id: "n_0000000002", type: "buy", text: null, where: "Audible", spend: { amount: 14.95, currency: "USD", kind: "purchase" }, on: { date: "2026-08-03", precision: "day" } }),
    entry({ id: "n_0000000003", type: "start", text: null, format: "audiobook", on: { date: "2026-08-10", precision: "week" } }),
    entry({ id: "n_0000000004", type: "finish", text: "loved it", rating: 4.5, on: { date: "2026-08-31", precision: "week" } }),
  ];
  const record = title(entries);
  assert.equal(record.status, "done");
  assert.equal(record.ownership, "owned");
  assert.equal(titleSchema.safeParse(record).success, true);
  assert.equal(titleSchema.safeParse(title([])).success, true, "a bare curious title");
  const game = title([], { medium: "game", detail: { format: null, platform: "Switch", where: null }, length: { hours: 40 } });
  assert.equal(titleSchema.safeParse(game).success, true);
  const movie = title([], { medium: "movie", detail: { format: null, platform: null, where: "Netflix" }, length: { minutes: 116 } });
  assert.equal(titleSchema.safeParse(movie).success, true);
  rejects(titleSchema, record, [
    [{ id: "t_abcdefghij" }, /id: Not a title id/],
    [{ medium: "music" }, /medium/],
    [{ status: "active" }, /status: Stale derived field: entries derive "done"/],
    [{ ownership: "none" }, /ownership: Stale derived field/],
    [{ ownershipDetail: null }, /ownershipDetail: Stale derived field/],
    [{ rating: 5 }, /rating: Stale derived field: entries derive 4.5/],
    [{ review: "changed" }, /review: Stale derived field/],
    [{ entries: [...entries, entry({ id: "n_0000000004", type: "note" })] }, /entries.4.id: Duplicate entry id n_0000000004/],
    [{ detail: { format: "audiobook", platform: "Switch", where: null } }, /detail.platform: A book has no platform/],
    [{ detail: { format: "audiobook", platform: null, where: "couch" } }, /detail.where: A book has no where/],
    [{ medium: "game", detail: { format: "kindle", platform: null, where: null } }, /detail.format: A game has no format/],
    [{ medium: "show", detail: { format: null, platform: "TV", where: null } }, /detail.platform: A show has no platform/],
    [{ detail: { format: "audiobook" } }, /detail.platform/],
    [{ edited: ["synopsis"] }, /edited.0/],
    [{ catalog: { source: "goodreads", externalId: "1", pulledAt: now } }, /catalog.source/],
    [{ catalog: { source: "tmdb", externalId: "1" } }, /catalog.pulledAt/],
    [{ length: { pages: 0 } }, /length.pages/],
    [{ length: { chapters: 10 } }, /Unrecognized/],
    [{ series: { name: "Skyward" } }, /series.position/],
    [{ priority: "someday" }, /priority/],
    [{ moodFit: ["cozy"] }, /moodFit.0/],
    [{ timeFit: "epic" }, /timeFit/],
    [{ year: 0 }, /year/],
    [{ liked: "yes" }, /liked/],
    [{ facts: { synopsis: "x" } }, /facts\./],
    [{ dropReason: "x" }, /Unrecognized/],
  ]);
  const facts = {
    synopsis: "A girl wants to be a pilot.",
    genres: ["Science fiction"],
    people: [{ role: "author", name: "Brandon Sanderson" }],
    released: "2018-11-06",
    runtime: null,
    pages: 513,
    episodes: null,
    playtime: null,
    series: { name: "Skyward", position: 1, entries: [{ externalId: "OL1W", name: "Skyward", position: 1, released: "2018" }, { externalId: "OL2W", name: "Starsight", position: 2, released: null }] },
    platforms: [],
    formats: ["audiobook", "kindle", "physical"],
    language: "eng",
    links: [{ label: "Open Library", url: "https://openlibrary.org/works/OL17930368W" }],
    availability: [{ kind: "listen", name: "Audible", url: "https://www.audible.com/search?keywords=Skyward", region: "US", price: null, constructed: true }],
    sourceRating: { value: 4.3, scale: 5, count: 1200 },
  };
  assert.equal(titleSchema.safeParse({ ...record, facts }).success, true, "a full facts block");
  rejects(titleSchema, { ...record, facts }, [
    [{ facts: { ...facts, availability: [{ ...facts.availability[0], region: "usa" }] } }, /facts.availability.0.region: Use a two-letter region code/],
    [{ facts: { ...facts, availability: [{ ...facts.availability[0], kind: "watch" }] } }, /facts.availability.0.kind/],
    [{ facts: { ...facts, availability: [{ kind: "buy", name: "Steam", url: "https://s", region: "US", price: null }] } }, /facts.availability.0.constructed/],
    [{ facts: { ...facts, sourceRating: { value: 4.3, scale: 0, count: null } } }, /facts.sourceRating.scale/],
    [{ facts: { ...facts, episodes: { seasons: 2 } } }, /facts.episodes.episodes/],
  ]);
});

test("library inputs accept what the CLI sends and reject the rest", () => {
  assert.equal(titleAddSchema.safeParse({ medium: "game", name: "Aniimo" }).success, true, "a mention");
  assert.equal(titleAddSchema.safeParse({ medium: "game", name: "Fire Emblem: Fortune's Weave", want: true, priority: "soon", year: 2026 }).success, true);
  assert.equal(titleAddSchema.safeParse({ medium: "book", name: "Starsight", started: true, detail: { format: "audiobook" } }).success, true);
  assert.equal(
    titleAddSchema.safeParse({ medium: "movie", name: "Arrival", seenBefore: true, finished: { on: { date: "2026-09-11", precision: "day" }, rating: 5, liked: true, text: "still a 5" }, catalog: "329865", lookup: false, allowDuplicate: true }).success,
    true,
  );
  assert.equal(titleAddSchema.safeParse({ medium: "movie", name: "Arrival", seenBefore: { date: "2016", precision: "year" }, want: true, started: true }).success, true, "want and started together append both");
  rejects(titleAddSchema, { medium: "book", name: "Starsight" }, [
    [{ medium: "audiobook" }, /medium/],
    [{ name: " " }, /name: Required/],
    [{ started: { rating: 4.25 } }, /started/],
    [{ finished: "yes" }, /finished/],
    [{ seenBefore: "?" }, /seenBefore/],
    [{ detail: { format: "paperback" } }, /detail.format/],
    [{ moodFit: ["cozy"] }, /moodFit.0/],
    [{ status: "backlog" }, /Unrecognized/],
    [{ entries: [] }, /Unrecognized/],
  ]);

  assert.equal(titleUpdateSchema.safeParse({}).success, true, "an empty update is the operation's call");
  assert.equal(titleUpdateSchema.safeParse({ name: "Skyward", aliases: [], year: null, creators: ["B. Sanderson"], cover: null, length: null, series: { name: "Skyward", position: 1 }, priority: null, moodFit: ["comfort"], timeFit: null, notes: null, detail: { format: null } }).success, true);
  rejects(titleUpdateSchema, {}, [
    [{ status: "done" }, /Unrecognized/],
    [{ rating: 5 }, /Unrecognized/],
    [{ liked: true }, /Unrecognized/],
    [{ name: null }, /name/],
    [{ series: { name: "x" } }, /series.position/],
    [{ length: { pages: -1 } }, /length.pages/],
  ]);

  assert.equal(titleListSchema.safeParse({}).success, true);
  assert.equal(titleListSchema.safeParse({ medium: "book", status: ["backlog", "active"], ownership: ["owned"], priority: "now", moodFit: "low-energy", timeFit: "short", format: "kindle", text: "sky", includeDeleted: true, full: true }).success, true);
  rejects(titleListSchema, {}, [
    [{ status: [] }, /status/],
    [{ status: "backlog" }, /status/],
    [{ ownership: ["mine"] }, /ownership.0/],
    [{ text: "" }, /text/],
    [{ limit: 5 }, /Unrecognized/],
  ]);

  assert.equal(entryInputSchema.safeParse({}).success, true);
  assert.equal(entryInputSchema.safeParse({ on: { date: "2026-09-07", precision: "week" }, text: "note", progress: "S2E4", format: "kindle", rating: 4, liked: true, minutes: 45, spend: { amount: 5, currency: "USD", kind: "iap" }, where: "eShop", evidence: ["chat:2026-09-12"] }).success, true);
  rejects(entryInputSchema, {}, [
    [{ text: null }, /text/],
    [{ on: "2026-09-07" }, /on/],
    [{ rating: 3.3 }, /rating/],
    [{ minutes: 0 }, /minutes/],
    [{ type: "finish" }, /Unrecognized/],
  ]);

  assert.equal(entryPatchSchema.safeParse({ type: "finish" }).success, true);
  assert.equal(entryPatchSchema.safeParse({ on: { date: null, precision: "unknown" }, text: null, rating: null, minutes: null, spend: null, where: null, format: null, progress: null }).success, true, "null clears");
  rejects(entryPatchSchema, { type: "finish" }, [
    [{ on: null }, /on/],
    [{ type: null }, /type/],
    [{ liked: true }, /Unrecognized/],
  ]);
  const empty = entryPatchSchema.safeParse({});
  assert.equal(empty.success, false);
  if (!empty.success) assert.deepEqual(issuesOf(empty.error), ["input: Nothing to amend"]);
});
