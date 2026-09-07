// The contract: what a task, project, section, label, and filter are, what the
// operations accept, and what every mutation returns. Everything is validated
// here before anything is written, regardless of who is calling.

import { z } from "zod";
import { isValidDate, isValidTimezone } from "./time.ts";
import { parseRule } from "./recurrence.ts";
import { parseFilter } from "./filter.ts";

export const ID_PREFIXES = { task: "t", project: "p", section: "s", label: "l", filter: "f" } as const;
export type RecordKind = keyof typeof ID_PREFIXES;

export const recordId = z.string().regex(/^[tpslfc]_[a-z0-9]{10}$/, "Not a Life-OS id");
const idOf = (kind: RecordKind) =>
  z.string().regex(new RegExp(`^${ID_PREFIXES[kind]}_[a-z0-9]{10}$`), `Not a ${kind} id`);
export const taskId = idOf("task");
export const projectId = idOf("project");
export const sectionId = idOf("section");
export const labelId = idOf("label");
export const filterId = idOf("filter");

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

export type AnyRecord = Task | Project | Section | Label | Filter;

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
