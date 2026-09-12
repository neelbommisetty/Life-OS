// The contract: what a task, project, section, label, filter, account,
// calendar, event, and title are, what the operations accept, and what every
// mutation returns. Everything is validated here before anything is written,
// regardless of who is calling.

import { z } from "zod";
import { isValidDate, isValidTimezone } from "./time.ts";
import { parseRule } from "./recurrence.ts";
import { parseFilter } from "./filter.ts";
import { onIssue } from "./media/on.ts";
import { derive } from "./media/derive.ts";

export const ID_PREFIXES = {
  task: "t",
  project: "p",
  section: "s",
  label: "l",
  filter: "f",
  account: "a",
  calendar: "c",
  event: "e",
  title: "m",
} as const;
export type RecordKind = keyof typeof ID_PREFIXES;

export const recordId = z.string().regex(/^[tpslfacem]_[a-z0-9]{10}$/, "Not a Life-OS id");
const idOf = (kind: RecordKind) =>
  z.string().regex(new RegExp(`^${ID_PREFIXES[kind]}_[a-z0-9]{10}$`), `Not a ${kind} id`);
export const taskId = idOf("task");
export const projectId = idOf("project");
export const sectionId = idOf("section");
export const labelId = idOf("label");
export const filterId = idOf("filter");
export const accountId = idOf("account");
export const calendarId = idOf("calendar");
export const eventId = idOf("event");
export const titleId = idOf("title");
/** A diary entry's id: `n_` plus ten characters. Entries live inside a title, so this is not a record id. */
export const entryId = z.string().regex(/^n_[a-z0-9]{10}$/, "Not an entry id");

export const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "Use lowercase letters, digits, dots, dashes");
export const text = z.string().trim().min(1, "Required").max(4000);
export const longText = z.string().max(20000);
export const isoDate = z.string().refine(isValidDate, "Use YYYY-MM-DD");
export const timestamp = z.iso.datetime({ offset: true });
export const timezone = z.string().refine(isValidTimezone, "Unknown timezone");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const color = z.string().trim().min(1).max(32);
export const order = z.number().int().min(0);
export const actor = z
  .string()
  .regex(
    /^(neel|codex|agent:[a-z0-9._-]+|import:[a-z0-9._-]+)$/,
    "Actor must be neel, codex, agent:<name>, or import:<provider>",
  );
export const executor = z
  .string()
  .regex(/^(neel|agent:[a-z0-9._-]+)$/, "Executor must be neel or agent:<name>");
export const rrule = z.string().superRefine((value, ctx) => {
  const parsed = parseRule(value);
  if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.error });
});
export const filterQuery = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .superRefine((value, ctx) => {
    const parsed = parseFilter(value);
    if (!parsed.ok) ctx.addIssue({ code: "custom", message: parsed.error });
  });

export const taskStatus = z.enum(["proposed", "accepted", "in_progress", "done", "cancelled"]);
export const OPEN_STATUSES = ["proposed", "accepted", "in_progress"] as const;
export const bucket = z.enum(["safe", "review", "unsafe"]);
export const layout = z.enum(["list", "board"]);

export const due = z
  .strictObject({
    date: isoDate,
    time: hhmm.optional(),
    timezone: timezone.optional(),
  })
  .refine((value) => value.time === undefined || value.timezone !== undefined, {
    message: "A due time needs a timezone",
  });

export const evidence = z.array(z.string().trim().min(1).max(1000)).max(50);
export const origin = z.strictObject({
  actor,
  at: timestamp,
  reason: text.optional(),
  evidence,
});
export type Origin = z.infer<typeof origin>;
export const externalRef = z.strictObject({
  provider: slug,
  id: z.string().min(1).max(200),
  syncedAt: timestamp.optional(),
});
export const attachment = z.strictObject({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2000),
});
export const comment = z.strictObject({
  actor,
  at: timestamp,
  text,
  attachments: z.array(attachment).max(20),
});
export const occurrence = z.strictObject({ date: isoDate, at: timestamp, actor });

const priority = z.number().int().min(1).max(4);
const duration = z.number().int().min(1).max(24 * 60 * 30);

const bookkeeping = {
  version: z.number().int().positive(),
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
};

// ------------------------------------------------------------------ records

export const projectSchema = z.strictObject({
  id: projectId,
  name: text,
  slug,
  parentId: projectId.nullable(),
  color: color.optional(),
  layout,
  order,
  labels: z.array(slug).max(50),
  archived: z.boolean(),
  system: z.boolean(),
  origin,
  external: z.array(externalRef).max(20),
  ...bookkeeping,
});

export const sectionSchema = z.strictObject({
  id: sectionId,
  projectId,
  name: text,
  order,
  archived: z.boolean(),
  origin,
  external: z.array(externalRef).max(20),
  ...bookkeeping,
});

export const labelSchema = z.strictObject({
  id: labelId,
  name: slug,
  color: color.optional(),
  order,
  origin,
  external: z.array(externalRef).max(20),
  ...bookkeeping,
});

export const filterSchema = z.strictObject({
  id: filterId,
  name: text,
  query: filterQuery,
  order,
  origin,
  ...bookkeeping,
});

export const taskSchema = z
  .strictObject({
    id: taskId,
    title: text,
    notes: longText,
    projectId,
    sectionId: sectionId.optional(),
    parentId: taskId.optional(),
    order,
    status: taskStatus,
    executor,
    bucket: bucket.optional(),
    due: due.nullable(),
    repeat: rrule.optional(),
    deadline: isoDate.nullable(),
    duration: duration.optional(),
    priority: priority.optional(),
    labels: z.array(slug).max(50),
    comments: z.array(comment).max(1000),
    occurrences: z.array(occurrence).max(5000),
    origin,
    external: z.array(externalRef).max(20),
    completedAt: timestamp.nullable(),
    ...bookkeeping,
  })
  .refine((value) => !value.repeat || value.due, {
    message: "A repeating task needs a due date",
  });

// ------------------------------------------------------------------ calendar records

/** A moment: timed (timezone null means floating) or a date for an all-day event. */
export const timedWhen = z.strictObject({ at: timestamp, timezone: timezone.nullable() });
export const dateWhen = z.strictObject({ date: isoDate });
export const when = z.union([timedWhen, dateWhen]);
export type TimedWhen = z.infer<typeof timedWhen>;
export type DateWhen = z.infer<typeof dateWhen>;
export type When = z.infer<typeof when>;

export function isTimedWhen(value: When): value is TimedWhen {
  return "at" in value;
}

/** The sortable key of a moment: the instant, or the date. Comparable only between moments of the same kind. */
export function whenKey(value: When): string {
  return isTimedWhen(value) ? value.at : value.date;
}

/** True when both sides are timed or both are dates. */
export function sameWhenKind(a: When, b: When): boolean {
  return isTimedWhen(a) === isTimedWhen(b);
}

/**
 * True when `end` comes after `start`: a later instant for timed moments, a
 * later date for all-day ones (the end date is exclusive, so a one-day event
 * ends on the next date). False for mixed kinds.
 */
export function endsAfterStart(start: When, end: When): boolean {
  if (isTimedWhen(start) && isTimedWhen(end)) return Date.parse(end.at) > Date.parse(start.at);
  if (!isTimedWhen(start) && !isTimedWhen(end)) return end.date > start.date;
  return false;
}

/** Adds the span issues to `ctx`: same kind on both sides, end after start. Returns true when the span is sound. */
function checkSpan(start: When, end: When, ctx: z.RefinementCtx, path: (string | number)[] = ["end"]): boolean {
  if (!sameWhenKind(start, end)) {
    ctx.addIssue({ code: "custom", path, message: "Start and end must both be timed or both be dates" });
    return false;
  }
  if (!endsAfterStart(start, end)) {
    ctx.addIssue({
      code: "custom",
      path,
      message: isTimedWhen(start) ? "End must be after start" : "End date must be after the start date (it is exclusive)",
    });
    return false;
  }
  return true;
}

/**
 * A provider's recurrence rule. Providers deliver arbitrary RRULEs, expanded
 * by the rrule package in src/calendar/expand.ts, so this only checks that a
 * FREQ is named; the todo list's `rrule` subset is not applied here.
 */
export const eventRrule = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((value) => /(^|[;:\s])FREQ=[A-Z]+/i.test(value), "Not an RRULE (no FREQ)");
/** An original start as an exdate or an originalStart key: the instant for a timed series, the date for an all-day one. */
const originalStartKey = z.union([timestamp, isoDate]);
export const eventRepeat = z.strictObject({
  rrule: eventRrule,
  exdates: z.array(originalStartKey).max(2000),
});
export const provider = z.literal("google");
export const accountStatus = z.enum(["connected", "needs_reauth", "disconnected"]);
export const eventStatus = z.enum(["confirmed", "tentative", "cancelled"]);
export const attendeeResponse = z.enum(["needsAction", "accepted", "declined", "tentative"]);
export const emailAddress = z.string().trim().min(1).max(320);
export const organizer = z.strictObject({ email: emailAddress, name: text.nullable(), self: z.boolean() });
export const attendee = z.strictObject({
  email: emailAddress,
  name: text.nullable(),
  response: attendeeResponse,
  self: z.boolean(),
  optional: z.boolean(),
});
export const conferencing = z.strictObject({
  kind: z.string().trim().min(1).max(100),
  url: z.string().trim().min(1).max(2000),
});
export const reminder = z.strictObject({
  method: z.string().trim().min(1).max(50),
  minutes: z.number().int().min(0).max(4 * 7 * 24 * 60),
});
export const providerItemId = z.string().min(1).max(1024);
export const eventExternal = z.strictObject({
  provider,
  id: providerItemId,
  etag: z.string().min(1).max(200),
  iCalUID: z.string().min(1).max(1024),
  updatedAt: timestamp,
});
export const calendarExternal = z.strictObject({
  id: providerItemId,
  syncToken: z.string().min(1).max(4000).nullable(),
});

export const accountSchema = z.strictObject({
  id: accountId,
  provider,
  identity: emailAddress,
  label: text.nullable(),
  primary: z.boolean(),
  status: accountStatus,
  scopes: z.array(z.string().trim().min(1).max(200)).max(50),
  syncedAt: timestamp.nullable(),
  ...bookkeeping,
});

export const calendarSchema = z.strictObject({
  id: calendarId,
  accountId,
  name: text,
  color: color.nullable(),
  timezone,
  labels: z.array(slug).max(50),
  writable: z.boolean(),
  hidden: z.boolean(),
  primaryOfAccount: z.boolean(),
  order,
  external: calendarExternal,
  syncedAt: timestamp.nullable(),
  syncError: z.string().max(4000).nullable(),
  ...bookkeeping,
});

/** The shape of an event before the cross-field rules; `eventSchema` adds them. */
const eventFields = {
  id: eventId,
  calendarId,
  accountId,
  title: text,
  notes: longText.nullable(),
  location: text.nullable(),
  start: when,
  end: when,
  repeat: eventRepeat.nullable(),
  masterId: eventId.nullable(),
  originalStart: when.nullable(),
  status: eventStatus,
  busy: z.boolean(),
  organizer: organizer.nullable(),
  attendees: z.array(attendee).max(1000),
  myResponse: attendeeResponse.nullable(),
  conferencing: conferencing.nullable(),
  reminders: z.array(reminder).max(20).nullable(),
  origin,
  external: eventExternal,
  ...bookkeeping,
};

/** The cross-field rules shared by the record and the provider-side write shapes. */
function checkEventShape(
  value: { start: When; end: When; repeat: unknown; masterId?: string | null; originalStart?: When | null },
  ctx: z.RefinementCtx,
): void {
  checkSpan(value.start, value.end, ctx);
  if (value.repeat && value.masterId) {
    ctx.addIssue({ code: "custom", path: ["repeat"], message: "Only a master carries a rule; an exception row cannot repeat" });
  }
  const hasMaster = value.masterId !== null && value.masterId !== undefined;
  const hasOriginal = value.originalStart !== null && value.originalStart !== undefined;
  if (hasMaster !== hasOriginal) {
    ctx.addIssue({
      code: "custom",
      path: [hasMaster ? "originalStart" : "masterId"],
      message: "masterId and originalStart go together: both set on an exception row, both null otherwise",
    });
  }
}

export const eventSchema = z.strictObject(eventFields).superRefine(checkEventShape);

// ------------------------------------------------------------------ library records

export const medium = z.enum(["movie", "show", "game", "book"]);
export const progress = z.enum(["curious", "backlog", "active", "paused", "done", "dropped"]);
export const ownership = z.enum(["none", "owned", "service", "borrowed"]);
export const precision = z.enum(["day", "week", "month", "year", "unknown"]);
export const bookFormat = z.enum(["audiobook", "physical", "kindle"]);
export const catalogSource = z.enum(["tmdb", "openlibrary", "igdb"]);
export const titlePriority = z.enum(["now", "soon", "later"]);
export const moodFit = z.enum(["comfort", "immersive", "social", "learning", "low-energy"]);
export const timeFit = z.enum(["short", "medium", "long"]);
export const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;
export const rating = z.literal(RATINGS, "Use half stars from 0.5 to 5");
export const entryType = z.enum([
  "want", "start", "progress", "finish", "pause", "resume", "drop", "again", "note",
  "buy", "borrow", "return", "service",
]);
/** The entry types that speak about progress; every other type is about ownership. */
export const PROGRESS_ENTRY_TYPES = ["want", "start", "progress", "finish", "pause", "resume", "drop", "again", "note"] as const;
export const OWNERSHIP_ENTRY_TYPES = ["buy", "borrow", "return", "service"] as const;
/** The factual fields Neel can change by hand; each is listed in `edited` once he has (D93). */
export const editedField = z.enum(["name", "year", "creators", "cover", "length"]);

/**
 * When something happened, at the precision Neel gave (D92): the date at the
 * precision's grain (a week is its Monday), null only with `unknown`. The
 * forms are parsed and printed by src/media/on.ts.
 */
export const on = z
  .strictObject({ date: z.string().max(10).nullable(), precision })
  .superRefine((value, ctx) => {
    const issue = onIssue(value);
    if (issue) ctx.addIssue({ code: "custom", path: ["date"], message: issue });
  });
export const currency = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
export const money = z.strictObject({ amount: z.number().finite().min(0), currency });
export const spend = money.extend({ kind: z.enum(["purchase", "iap", "rental"]) });
const url = z.string().trim().min(1).max(2000);
const titleYear = z.number().int().min(1).max(9999);
/** One sitting's time, in minutes (D100): never cumulative. */
const sittingMinutes = z.number().int().min(1).max(24 * 60);
/** A diary text: a note, a review, a drop reason. Longer than a task title; kept in full (D98). */
const entryText = z.string().trim().min(1, "Required").max(20000);

const OWNERSHIP_TYPES: ReadonlySet<string> = new Set(OWNERSHIP_ENTRY_TYPES);
const CLOSING_TYPES: ReadonlySet<string> = new Set(["finish", "drop"]);

export const entrySchema = z
  .strictObject({
    id: entryId,
    type: entryType,
    on,
    at: timestamp,
    actor,
    text: entryText.nullable(),
    progress: text.nullable(),
    format: bookFormat.nullable(),
    rating: rating.nullable(),
    minutes: sittingMinutes.nullable(),
    spend: spend.nullable(),
    where: text.nullable(),
    evidence,
  })
  .superRefine((value, ctx) => {
    const isOwnership = OWNERSHIP_TYPES.has(value.type);
    if (value.rating !== null && !CLOSING_TYPES.has(value.type)) {
      ctx.addIssue({ code: "custom", path: ["rating"], message: "Only a finish or drop carries a rating" });
    }
    if (value.type === "drop" && value.text === null) {
      ctx.addIssue({ code: "custom", path: ["text"], message: "A drop needs its reason as text" });
    }
    if (value.minutes !== null && isOwnership) {
      ctx.addIssue({ code: "custom", path: ["minutes"], message: "Only a progress-facet entry carries minutes" });
    }
    if (value.spend !== null && !isOwnership) {
      ctx.addIssue({ code: "custom", path: ["spend"], message: "Only buy, borrow, return, or service carries spend" });
    }
    if (value.where !== null && !["buy", "borrow", "service"].includes(value.type)) {
      ctx.addIssue({ code: "custom", path: ["where"], message: "Only buy, borrow, or service carries where" });
    }
  });

export const availabilityKind = z.enum(["stream", "rent", "buy", "play", "borrow", "listen"]);
export const availabilitySchema = z.strictObject({
  kind: availabilityKind,
  name: text,
  url,
  region: z.string().regex(/^[A-Z]{2}$/, "Use a two-letter region code"),
  price: money.nullable(),
  constructed: z.boolean(),
});

const seriesEntry = z.strictObject({
  externalId: z.string().min(1).max(200),
  name: text,
  position: z.number().int().min(0).nullable(),
  released: z.string().trim().min(1).max(40).nullable(),
});

/** The raw catalog pull (D71): theirs, correctable, nothing of Neel's in it. */
export const factsSchema = z.strictObject({
  synopsis: longText.nullable(),
  genres: z.array(text).max(50),
  people: z.array(z.strictObject({ role: text, name: text })).max(500),
  released: z.string().trim().min(1).max(40).nullable(),
  runtime: z.number().int().min(0).nullable(),
  pages: z.number().int().min(0).nullable(),
  episodes: z.strictObject({ seasons: z.number().int().min(0), episodes: z.number().int().min(0) }).nullable(),
  playtime: z.number().finite().min(0).nullable(),
  series: z
    .strictObject({ name: text, position: z.number().int().min(0).nullable(), entries: z.array(seriesEntry).max(500) })
    .nullable(),
  platforms: z.array(text).max(100),
  formats: z.array(text).max(50),
  language: text.nullable(),
  links: z.array(z.strictObject({ label: text, url })).max(100),
  availability: z.array(availabilitySchema).max(200),
  sourceRating: z
    .strictObject({ value: z.number().finite().min(0), scale: z.number().finite().positive(), count: z.number().int().min(0).nullable() })
    .nullable(),
});

const positiveInt = z.number().int().min(1);
export const titleLength = z.strictObject({
  minutes: positiveInt.optional(),
  pages: positiveInt.optional(),
  hours: z.number().finite().positive().optional(),
  seasons: positiveInt.optional(),
  episodes: positiveInt.optional(),
});
export const titleSeries = z.strictObject({ name: text, position: z.number().int().min(0).nullable() });
export const titleCatalog = z.strictObject({ source: catalogSource, externalId: z.string().min(1).max(200), pulledAt: timestamp });
export const ownershipDetail = z.strictObject({ where: text.nullable(), since: on.nullable(), price: money.nullable() });
/** The medium block (D73): a book's wanted format, a game's platform, a movie's or show's where watched. */
export const titleDetail = z.strictObject({ format: bookFormat.nullable(), platform: text.nullable(), where: text.nullable() });

/** Which detail fields a medium has; the others must be null. */
const DETAIL_FIELDS: Record<z.infer<typeof medium>, readonly (keyof z.infer<typeof titleDetail>)[]> = {
  book: ["format"],
  game: ["platform"],
  movie: ["where"],
  show: ["where"],
};

const sameMoney = (a: { amount: number; currency: string } | null, b: { amount: number; currency: string } | null) =>
  a === b || (a !== null && b !== null && a.amount === b.amount && a.currency === b.currency);
const sameOn = (a: { date: string | null; precision: string } | null, b: { date: string | null; precision: string } | null) =>
  a === b || (a !== null && b !== null && a.date === b.date && a.precision === b.precision);

export const titleSchema = z
  .strictObject({
    id: titleId,
    medium,
    name: text,
    aliases: z.array(text).max(50),
    year: titleYear.nullable(),
    creators: z.array(text).max(50),
    cover: url.nullable(),
    length: titleLength.nullable(),
    facts: factsSchema.nullable(),
    catalog: titleCatalog.nullable(),
    edited: z.array(editedField).max(5),
    series: titleSeries.nullable(),
    status: progress,
    ownership,
    ownershipDetail: ownershipDetail.nullable(),
    priority: titlePriority.nullable(),
    moodFit: z.array(moodFit).max(5),
    timeFit: timeFit.nullable(),
    notes: longText.nullable(),
    detail: titleDetail,
    rating: rating.nullable(),
    review: entryText.nullable(),
    liked: z.boolean(),
    entries: z.array(entrySchema).max(5000),
    origin,
    ...bookkeeping,
  })
  .superRefine((value, ctx) => {
    // Entry ids are unique within the title.
    const seen = new Set<string>();
    value.entries.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: ["entries", index, "id"], message: `Duplicate entry id ${entry.id}` });
      seen.add(entry.id);
    });
    // Inapplicable detail fields are always null.
    const applies = DETAIL_FIELDS[value.medium];
    for (const field of ["format", "platform", "where"] as const) {
      if (value.detail[field] !== null && !applies.includes(field)) {
        ctx.addIssue({ code: "custom", path: ["detail", field], message: `A ${value.medium} has no ${field}` });
      }
    }
    // The stored derived fields must be what the diary derives (D91), so a forgotten finalize is caught here.
    const derived = derive(value.entries);
    const stale = (field: string, expected: unknown) =>
      ctx.addIssue({ code: "custom", path: [field], message: `Stale derived field: entries derive ${JSON.stringify(expected)}` });
    if (value.status !== derived.status) stale("status", derived.status);
    if (value.ownership !== derived.ownership) stale("ownership", derived.ownership);
    if (value.rating !== derived.rating) stale("rating", derived.rating);
    if (value.review !== derived.review) stale("review", derived.review);
    const a = value.ownershipDetail;
    const b = derived.ownershipDetail;
    const sameDetail = a === b || (a !== null && b !== null && a.where === b.where && sameOn(a.since, b.since) && sameMoney(a.price, b.price));
    if (!sameDetail) stale("ownershipDetail", derived.ownershipDetail);
  });

// ------------------------------------------------------------------ inputs

/** A project reference: an id, or a slug path like `health/dental`, or `inbox`. */
export const projectRef = z.string().trim().min(1).max(600);
/** A section reference: an id, or a name within the task's project. */
export const sectionRef = z.string().trim().min(1).max(4000);

export const taskAddSchema = z
  .strictObject({
    title: text,
    notes: longText.optional(),
    project: projectRef.optional(),
    section: sectionRef.optional(),
    parent: taskId.optional(),
    status: z.enum(["proposed", "accepted"]).optional(),
    executor: executor.optional(),
    bucket: bucket.optional(),
    due: due.nullable().optional(),
    repeat: rrule.optional(),
    deadline: isoDate.nullable().optional(),
    duration: duration.optional(),
    priority: priority.optional(),
    labels: z.array(slug).max(50).optional(),
    external: z.array(externalRef).max(20).optional(),
    allowDuplicate: z.boolean().optional(),
  })
  .refine((value) => !value.repeat || value.due, {
    message: "A repeating task needs a due date",
  });

export const taskUpdateSchema = z.strictObject({
  title: text.optional(),
  notes: longText.optional(),
  priority: priority.nullable().optional(),
  due: due.nullable().optional(),
  repeat: rrule.nullable().optional(),
  deadline: isoDate.nullable().optional(),
  duration: duration.nullable().optional(),
  labels: z.array(slug).max(50).optional(),
});

export const taskMoveSchema = z
  .strictObject({
    project: projectRef.optional(),
    section: sectionRef.nullable().optional(),
    parent: taskId.nullable().optional(),
  })
  .refine((value) => value.project !== undefined || value.section !== undefined || value.parent !== undefined, {
    message: "Nothing to move",
  });

export const taskListSchema = z.strictObject({
  status: z.array(taskStatus).min(1).optional(),
  includeClosed: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
  project: projectRef.optional(),
  withSubprojects: z.boolean().optional(),
  section: sectionRef.optional(),
  parent: taskId.nullable().optional(),
  label: slug.optional(),
  executor: executor.optional(),
  dueOn: isoDate.optional(),
  dueBefore: isoDate.optional(),
  dueAfter: isoDate.optional(),
  undated: z.boolean().optional(),
  text: z.string().trim().min(1).max(200).optional(),
  filter: filterQuery.optional(),
  limit: z.number().int().min(1).max(10000).optional(),
});

export const subtaskChoiceOnComplete = z.enum(["complete", "leave"]);
export const subtaskChoiceOnDelete = z.enum(["delete", "leave"]);

export const projectAddSchema = z.strictObject({
  name: text,
  slug: slug.optional(),
  parent: projectRef.nullable().optional(),
  color: color.optional(),
  layout: layout.optional(),
  labels: z.array(slug).max(50).optional(),
  external: z.array(externalRef).max(20).optional(),
});
export const projectUpdateSchema = z.strictObject({
  name: text.optional(),
  slug: slug.optional(),
  color: color.nullable().optional(),
  layout: layout.optional(),
  labels: z.array(slug).max(50).optional(),
});
export const sectionAddSchema = z.strictObject({
  project: projectRef,
  name: text,
  external: z.array(externalRef).max(20).optional(),
});
export const sectionUpdateSchema = z.strictObject({ name: text.optional() });
export const labelAddSchema = z.strictObject({
  name: slug,
  color: color.optional(),
  external: z.array(externalRef).max(20).optional(),
});
export const labelUpdateSchema = z.strictObject({
  name: slug.optional(),
  color: color.nullable().optional(),
});
export const filterAddSchema = z.strictObject({ name: text, query: filterQuery });
export const filterUpdateSchema = z.strictObject({
  name: text.optional(),
  query: filterQuery.optional(),
});

/** A calendar reference: an id, `<identity>/<name>`, or a name unique among non-deleted calendars. */
export const calendarRef = z.string().trim().min(1).max(600);
/** Minutes for a timed event, days for an all-day one. */
const eventDuration = z.number().int().min(1).max(366 * 24 * 60);

export const eventAddSchema = z
  .strictObject({
    title: text,
    calendar: calendarRef.optional(),
    start: when,
    end: when.optional(),
    duration: eventDuration.optional(),
    notes: longText.optional(),
    location: text.optional(),
    repeat: eventRrule.optional(),
    busy: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.end !== undefined && value.duration !== undefined) {
      ctx.addIssue({ code: "custom", path: ["duration"], message: "Give end or duration, not both" });
    }
    if (value.end !== undefined) checkSpan(value.start, value.end, ctx);
  });

export const eventUpdateSchema = z
  .strictObject({
    title: text.optional(),
    notes: longText.nullable().optional(),
    location: text.nullable().optional(),
    start: when.optional(),
    end: when.optional(),
    duration: eventDuration.optional(),
    repeat: eventRrule.nullable().optional(),
    busy: z.boolean().optional(),
    status: eventStatus.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.end !== undefined && value.duration !== undefined) {
      ctx.addIssue({ code: "custom", path: ["duration"], message: "Give end or duration, not both" });
    }
    if (value.start !== undefined && value.end !== undefined) checkSpan(value.start, value.end, ctx);
  });

/** The provider-neutral shape of a whole event as written to a provider. */
export const eventWriteSchema = z
  .strictObject({
    title: text,
    notes: longText.nullable(),
    location: text.nullable(),
    start: when,
    end: when,
    repeat: eventRepeat.nullable(),
    busy: z.boolean(),
    status: eventStatus,
  })
  .superRefine((value, ctx) => {
    checkSpan(value.start, value.end, ctx);
  });

/** The provider-neutral shape of a partial change; every field optional, `null` clears notes, location, repeat. */
export const eventPatchSchema = z
  .strictObject({
    title: text.optional(),
    notes: longText.nullable().optional(),
    location: text.nullable().optional(),
    start: when.optional(),
    end: when.optional(),
    repeat: eventRepeat.nullable().optional(),
    busy: z.boolean().optional(),
    status: eventStatus.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.start !== undefined && value.end !== undefined) checkSpan(value.start, value.end, ctx);
  });

export const accountUpdateSchema = z.strictObject({ label: text.nullable().optional() });
export const calendarUpdateSchema = z.strictObject({
  labels: z.array(slug).max(50).optional(),
  hidden: z.boolean().optional(),
  color: color.nullable().optional(),
});

// ------------------------------------------------------------------ library inputs

/** A title reference: an id, or a name (exact, alias, or unique substring) among the medium's titles. */
export const titleRef = z.string().trim().min(1).max(4000);

/** What every entry operation accepts; `on` defaults to today at day precision, `liked` sets the title, not the entry. */
export const entryInputSchema = z.strictObject({
  on: on.optional(),
  text: entryText.optional(),
  progress: text.optional(),
  format: bookFormat.optional(),
  rating: rating.optional(),
  liked: z.boolean().optional(),
  minutes: sittingMinutes.optional(),
  spend: spend.optional(),
  where: text.optional(),
  evidence: evidence.optional(),
});

/** An amend patch: any entry field including `type` and `on`; `null` clears a nullable one. */
export const entryPatchSchema = z
  .strictObject({
    type: entryType.optional(),
    on: on.optional(),
    text: entryText.nullable().optional(),
    progress: text.nullable().optional(),
    format: bookFormat.nullable().optional(),
    rating: rating.nullable().optional(),
    minutes: sittingMinutes.nullable().optional(),
    spend: spend.nullable().optional(),
    where: text.nullable().optional(),
    evidence: evidence.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to amend" });

/** The medium block as an input: only the fields that apply to the medium may be non-null; the operation checks that. */
export const titleDetailInputSchema = z.strictObject({
  format: bookFormat.nullable().optional(),
  platform: text.nullable().optional(),
  where: text.nullable().optional(),
});

export const titleAddSchema = z
  .strictObject({
    medium,
    name: text,
    year: titleYear.optional(),
    catalog: z.string().min(1).max(200).optional(),
    lookup: z.boolean().optional(),
    want: z.boolean().optional(),
    started: z.union([entryInputSchema, z.literal(true)]).optional(),
    finished: z.union([entryInputSchema, z.literal(true)]).optional(),
    seenBefore: z.union([on, z.literal(true)]).optional(),
    liked: z.boolean().optional(),
    priority: titlePriority.optional(),
    moodFit: z.array(moodFit).max(5).optional(),
    timeFit: timeFit.optional(),
    notes: longText.optional(),
    detail: titleDetailInputSchema.optional(),
    allowDuplicate: z.boolean().optional(),
  });

export const titleUpdateSchema = z.strictObject({
  name: text.optional(),
  aliases: z.array(text).max(50).optional(),
  year: titleYear.nullable().optional(),
  creators: z.array(text).max(50).optional(),
  cover: url.nullable().optional(),
  length: titleLength.nullable().optional(),
  series: titleSeries.nullable().optional(),
  priority: titlePriority.nullable().optional(),
  moodFit: z.array(moodFit).max(5).optional(),
  timeFit: timeFit.nullable().optional(),
  notes: longText.nullable().optional(),
  detail: titleDetailInputSchema.optional(),
});

export const titleListSchema = z.strictObject({
  medium: medium.optional(),
  status: z.array(progress).min(1).optional(),
  ownership: z.array(ownership).min(1).optional(),
  priority: titlePriority.optional(),
  moodFit: moodFit.optional(),
  timeFit: timeFit.optional(),
  format: bookFormat.optional(),
  text: z.string().trim().min(1).max(200).optional(),
  includeDeleted: z.boolean().optional(),
  full: z.boolean().optional(),
});

/**
 * An idempotency key as a caller passes it. No control characters: core.ts
 * derives per-item keys for batch, reorder, and import with one, so a caller's
 * key can never collide with a derived one.
 */
export const idempotencyKey = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/\p{Cc}/u.test(value), "No control characters");

export const ctxSchema = z.strictObject({
  actor,
  reason: text.optional(),
  evidence: evidence.optional(),
  key: idempotencyKey.optional(),
  ifVersion: z.number().int().positive().optional(),
});

// ------------------------------------------------------------------ types

export type Project = z.infer<typeof projectSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Label = z.infer<typeof labelSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskStatus = z.infer<typeof taskStatus>;
export type Due = z.infer<typeof due>;
export type Comment = z.infer<typeof comment>;
export type Ctx = z.infer<typeof ctxSchema>;
export type TaskAdd = z.infer<typeof taskAddSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type TaskMove = z.infer<typeof taskMoveSchema>;
export type TaskList = z.infer<typeof taskListSchema>;
export type ProjectAdd = z.infer<typeof projectAddSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type SectionAdd = z.infer<typeof sectionAddSchema>;
export type SectionUpdate = z.infer<typeof sectionUpdateSchema>;
export type LabelAdd = z.infer<typeof labelAddSchema>;
export type LabelUpdate = z.infer<typeof labelUpdateSchema>;
export type FilterAdd = z.infer<typeof filterAddSchema>;
export type FilterUpdate = z.infer<typeof filterUpdateSchema>;
export type Account = z.infer<typeof accountSchema>;
export type AccountStatus = z.infer<typeof accountStatus>;
export type Calendar = z.infer<typeof calendarSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EventStatus = z.infer<typeof eventStatus>;
export type EventRepeat = z.infer<typeof eventRepeat>;
export type Attendee = z.infer<typeof attendee>;
export type AttendeeResponse = z.infer<typeof attendeeResponse>;
export type Organizer = z.infer<typeof organizer>;
export type EventAdd = z.infer<typeof eventAddSchema>;
export type EventUpdate = z.infer<typeof eventUpdateSchema>;
export type EventWrite = z.infer<typeof eventWriteSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;
export type CalendarUpdate = z.infer<typeof calendarUpdateSchema>;

export type Medium = z.infer<typeof medium>;
export type Progress = z.infer<typeof progress>;
export type Ownership = z.infer<typeof ownership>;
export type Precision = z.infer<typeof precision>;
export type On = z.infer<typeof on>;
export type Rating = z.infer<typeof rating>;
export type BookFormat = z.infer<typeof bookFormat>;
export type CatalogSource = z.infer<typeof catalogSource>;
export type Money = z.infer<typeof money>;
export type Spend = z.infer<typeof spend>;
export type EntryType = z.infer<typeof entryType>;
export type Entry = z.infer<typeof entrySchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type Facts = z.infer<typeof factsSchema>;
export type Title = z.infer<typeof titleSchema>;
export type TitleLength = z.infer<typeof titleLength>;
export type TitleDetail = z.infer<typeof titleDetail>;
export type TitlePriority = z.infer<typeof titlePriority>;
export type MoodFit = z.infer<typeof moodFit>;
export type TimeFit = z.infer<typeof timeFit>;
export type EditedField = z.infer<typeof editedField>;
export type TitleAdd = z.infer<typeof titleAddSchema>;
export type TitleUpdate = z.infer<typeof titleUpdateSchema>;
export type TitleList = z.infer<typeof titleListSchema>;
export type EntryInput = z.infer<typeof entryInputSchema>;
export type EntryPatch = z.infer<typeof entryPatchSchema>;
export type TitleDetailInput = z.infer<typeof titleDetailInputSchema>;

/** What `list` and every library view return unless asked for the full record: a backlog readable in a few hundred tokens. */
export type TitleSummary = {
  id: string;
  medium: Medium;
  name: string;
  year: number | null;
  status: Progress;
  ownership: Ownership;
  priority: TitlePriority | null;
  rating: Rating | null;
  liked: boolean;
  timeFit: TimeFit | null;
  moodFit: MoodFit[];
  lastEntry: { type: EntryType; on: On; text: string | null } | null;
};

/** The todo list's records. The CLI renders these; the calendar's are `CalendarRecord`, the library's `MediaRecord`. */
export type AnyRecord = Task | Project | Section | Label | Filter;
export type CalendarRecord = Account | Calendar | Event;
export type MediaRecord = Title;

export type Outcome = "created" | "updated" | "unchanged" | "duplicate" | "rejected";

/** A rejection that a client can turn into a question. */
export type Needs = { field: string; options: string[]; message: string };

export type Receipt<T> =
  | {
      ok: true;
      outcome: "created" | "updated" | "unchanged";
      id: string;
      version: number;
      record: T;
      issues: [];
    }
  | { ok: false; outcome: "duplicate"; id?: undefined; candidates: T[]; issues: string[] }
  | { ok: false; outcome: "rejected"; id?: string; record?: T; issues: string[]; needs?: Needs };

export type LogEntry = {
  seq: number;
  at: string;
  actor: string;
  op: string;
  recordKind: RecordKind;
  recordId: string;
  patch: Record<string, { from: unknown; to: unknown }>;
  reason: string | null;
  evidence: string[];
  key: string | null;
};

export function issuesOf(error: z.ZodError): string[] {
  return error.issues
    .slice(0, 12)
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
}
