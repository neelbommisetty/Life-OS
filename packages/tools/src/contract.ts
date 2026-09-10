// The contract: what a task, project, section, label, filter, account,
// calendar, and event are, what the operations accept, and what every mutation
// returns. Everything is validated here before anything is written,
// regardless of who is calling.

import { z } from "zod";
import { isValidDate, isValidTimezone } from "./time.ts";
import { parseRule } from "./recurrence.ts";
import { parseFilter } from "./filter.ts";

export const ID_PREFIXES = {
  task: "t",
  project: "p",
  section: "s",
  label: "l",
  filter: "f",
  account: "a",
  calendar: "c",
  event: "e",
} as const;
export type RecordKind = keyof typeof ID_PREFIXES;

export const recordId = z.string().regex(/^[tpslface]_[a-z0-9]{10}$/, "Not a Life-OS id");
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

/** The todo list's records. The CLI renders these; the calendar's are `CalendarRecord`. */
export type AnyRecord = Task | Project | Section | Label | Filter;
export type CalendarRecord = Account | Calendar | Event;

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
