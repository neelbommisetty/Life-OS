import { z } from "@hono/zod-openapi";
import { inputs } from "./domain-schemas.ts";
import type { Tools } from "../tools.ts";

// This is an allowlist, never arbitrary property traversal. Argument validation
// protects the transport boundary; domain validation stays in the shared core
// so every caller receives the same receipts, needs, and duplicate candidates.
const s = z.string();
const n = z.number().finite();
const o = z.record(z.string(), z.unknown());
const a = z.array(z.unknown());
const ids = z.array(s);
const optional = (schema: z.ZodType) => schema.optional();
const os = optional(s), on = optional(n), oo = optional(o);
const ctx = inputs.ctx;
const write = [s, ctx] as const;
const edit = [s, o, ctx] as const;
const add = [o, ctx] as const;
const reorder = [ids, ctx] as const;

type Schemas<T> = { [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: readonly z.ZodType[] };
type CoreSchemas = {
  [K in "task" | "project" | "section" | "label" | "filter" | "calendar" | "event" | "views" | "media"]: Schemas<Tools[K]>
} & {
  account: Schemas<Omit<Tools["account"], "add">>;
  title: Schemas<Omit<Tools["title"], "scoped">>;
  "title.catalog": Schemas<Tools["title"]["catalog"]>;
};

export const GROUPS = {
  task: {
    add, get: [s], list: [oo], update: edit, move: edit, reorder,
    duplicate: [...write, oo], accept: write, start: write, complete: [...write, oo],
    uncomplete: write, cancel: write, delete: [...write, oo], restore: write,
    assign: edit, reschedule: [s, inputs.due.nullable(), ctx], note: [s, s, ctx, optional(a)],
    history: [s], batch: [a, ctx, oo], import: [a, ctx, oo],
  },
  project: {
    add, get: [s], tree: [oo], update: edit, move: [s, s.nullable(), ctx], reorder,
    archive: write, unarchive: write, delete: [...write, oo], restore: write, history: [s],
  },
  section: { add, get: [s], list: [s], update: edit, reorder, archive: write, unarchive: write, delete: [...write, oo], restore: write },
  label: { add, get: [s], list: [], update: edit, delete: write, restore: write, reorder },
  filter: { add, get: [s], list: [], update: edit, delete: write, restore: write, reorder, run: [s] },
  account: { get: [s], list: [], update: edit, primary: write, sync: [os, oo], remove: write },
  calendar: { get: [s], list: [oo], update: edit, reorder, sync: [s] },
  event: {
    add, get: [s], list: [o], update: [...edit, oo], reschedule: [...edit, oo],
    move: [s, s, ctx], respond: [s, s, ctx, oo], cancel: [...write, oo], delete: [...write, oo],
    restore: write, duplicate: [...write, oo], history: [s],
  },
  views: { today: [oo], week: [oo], slots: [o], upcoming: [on, oo], label: [s], filter: [s], search: [s], trash: [] },
  title: {
    add, get: [s], resolve: [s, oo], list: [oo], update: edit,
    want: edit, start: edit, resume: edit, pause: edit, progress: edit, note: edit,
    buy: edit, borrow: edit, return: edit, service: edit, again: [...edit, oo], finish: [...edit, oo], drop: edit,
    amend: [s, s, inputs.entryPatch, ctx], unlog: [s, s, ctx], relog: [s, s, s, ctx],
    rate: [s, n, ctx, oo], unrate: [...write, oo], review: [s, s, ctx, oo], like: write, unlike: write,
    where: [z.union([s, o])], next: [s], series: [s], merge: [s, s, ctx], delete: write, restore: write, history: [s],
  },
  "title.catalog": { search: [s, s, oo], link: [s, s, ctx], unlink: write, refresh: write, availability: [z.union([s, o]), ctx] },
  media: { now: [os, oo], curious: [os, oo], backlog: [os, oo], buy: [os, oo], shelf: [os, oo], diary: [oo], series: [s], time: [oo], year: [n, os, oo], search: [s, oo] },
} as const satisfies CoreSchemas;

export const EXTRA = {
  export: [],
  "catalog.resolve": [s, s, oo],
  "catalog.availability": [s, s],
  "display.indexes": [],
  "system.info": [],
  "system.doctor": [oo],
  "system.migrate": [],
  // Starting a connection returns a session; polling works in any interface.
  "account.add": [o, ctx],
  "account.connection": [s],
} as const satisfies Record<string, readonly z.ZodType[]>;

export const OPERATIONS = new Map<string, readonly z.ZodType[]>(Object.entries(EXTRA));
const inputSchemas: Record<string, z.ZodType> = {
  "task.add": inputs.taskAdd, "task.update": inputs.taskUpdate, "task.move": inputs.taskMove, "task.list": inputs.taskList,
  "project.add": inputs.projectAdd, "project.update": inputs.projectUpdate,
  "section.add": inputs.sectionAdd, "section.update": inputs.sectionUpdate,
  "label.add": inputs.labelAdd, "label.update": inputs.labelUpdate,
  "filter.add": inputs.filterAdd, "filter.update": inputs.filterUpdate,
  "account.update": inputs.accountUpdate, "calendar.update": inputs.calendarUpdate,
  "event.add": inputs.eventAdd, "event.update": inputs.eventUpdate,
  "title.add": inputs.titleAdd, "title.update": inputs.titleUpdate, "title.list": inputs.titleList,
};
for (const method of ["want", "start", "resume", "pause", "progress", "note", "buy", "borrow", "return", "service", "again", "finish", "drop"]) inputSchemas[`title.${method}`] = inputs.entry;
for (const [group, methods] of Object.entries(GROUPS)) {
  for (const [method, args] of Object.entries(methods)) {
    const name = `${group}.${method}`;
    const shape: z.ZodType[] = [...args];
    if (inputSchemas[name]) {
      const position = method === "add" || method === "list" ? 0 : 1;
      shape[position] = shape[position]!.isOptional() ? inputSchemas[name]!.optional() : inputSchemas[name]!;
    }
    OPERATIONS.set(name, shape);
  }
}

export function parseArgs(operation: string, args: unknown): unknown[] {
  const shape = OPERATIONS.get(operation);
  if (!shape) throw new Error("Unknown operation");
  // JSON has no undefined. Null in an optional argument slot means omitted;
  // null inside objects (clearing a field) is preserved exactly.
  const normalized = Array.isArray(args) ? args.map((value, i) => value === null && shape[i]?.isOptional() ? undefined : value) : args;
  return z.tuple(shape as [z.ZodType, ...z.ZodType[]]).parse(normalized);
}
