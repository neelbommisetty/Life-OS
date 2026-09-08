// Tasks: the records that hold the work, and everything that happens to them.
// Adding with the duplicate check, listing with the open-only default, the
// lifecycle transitions, moving a subtree, the sub-task question on complete
// and delete, recurrence on complete and its rewind on uncomplete, batch, and
// import. Every write goes through core.mutate / core.applyIn; reference
// resolution, the Inbox, labels on demand, and effective labels come from
// organize.ts.

import { z } from "zod";
import {
  OPEN_STATUSES,
  attachment as attachmentSchema,
  bucket as bucketSchema,
  ctxSchema,
  due as dueSchema,
  executor as executorSchema,
  isoDate,
  issuesOf,
  sectionId as sectionIdSchema,
  subtaskChoiceOnComplete,
  subtaskChoiceOnDelete,
  taskAddSchema,
  taskId as taskIdSchema,
  taskListSchema,
  taskMoveSchema,
  taskUpdateSchema,
  text as textSchema,
  type Ctx,
  type Due,
  type LogEntry,
  type Outcome,
  type Project,
  type Receipt,
  type Task,
  type TaskAdd,
  type TaskList,
  type TaskMove,
  type TaskStatus,
  type TaskUpdate,
} from "./contract.ts";
import { RejectedAfterWrites, applyIn, bump, checkVersion, diff, duplicate as duplicateMutation, fail, itemCtx, mutate, newId, okMutation, rejected, type Clock, type Mutation } from "./core.ts";
import { matches, mentionsStatus, parseFilter } from "./filter.ts";
import {
  cascadeCtx,
  effectiveLabels,
  ensureInbox,
  ensureLabels,
  filterSubject,
  findInbox,
  indexProjects,
  projectDescendants,
  projectPath,
  resolveProject,
  resolveSection,
  sortTasks,
  type Organize,
  type ProjectIndex,
} from "./organize.ts";
import { nextOccurrence, parseRule } from "./recurrence.ts";
import { withSavepoint, type Store, type Tx } from "./store.ts";
import { todayIn } from "./time.ts";

// ------------------------------------------------------------------ types

export type SubtasksOnComplete = z.infer<typeof subtaskChoiceOnComplete>;
export type SubtasksOnDelete = z.infer<typeof subtaskChoiceOnDelete>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type TaskAssign = { executor?: string; bucket?: z.infer<typeof bucketSchema> | null };
export type CompleteOptions = { date?: string; subtasks?: SubtasksOnComplete };
export type DeleteOptions = { subtasks?: SubtasksOnDelete };
export type DuplicateOptions = { subtasks?: boolean };

export const BATCH_OPS = [
  "accept",
  "start",
  "complete",
  "uncomplete",
  "cancel",
  "delete",
  "restore",
  "move",
  "reschedule",
  "assign",
  "update",
  "duplicate",
] as const;
export type BatchOp = (typeof BATCH_OPS)[number];
/** One task operation in a batch: `input` is the op's input (move, reschedule, assign, update), `options` its options (complete, delete, duplicate). */
export type BatchItem = { op: BatchOp; id: string; input?: unknown; options?: unknown };

export type ImportItemResult = { index: number; outcome: Outcome; id?: string; issues: string[] };
export type ImportResult = { dryRun: boolean; created: number; duplicate: number; rejected: number; items: ImportItemResult[] };

export interface TaskOps {
  add(input: TaskAdd, ctx: Ctx): Promise<Receipt<Task>>;
  /** Deleted included; callers check `deletedAt`. */
  get(id: string): Promise<Task | null>;
  /** Throws when the criteria are invalid or a project or section ref does not resolve; an empty result is `[]`. */
  list(filter?: TaskList): Promise<Task[]>;
  update(id: string, input: TaskUpdate, ctx: Ctx): Promise<Receipt<Task>>;
  move(id: string, input: TaskMove, ctx: Ctx): Promise<Receipt<Task>>;
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Task>[]>;
  duplicate(id: string, ctx: Ctx, opts?: DuplicateOptions): Promise<Receipt<Task>>;
  accept(id: string, ctx: Ctx): Promise<Receipt<Task>>;
  start(id: string, ctx: Ctx): Promise<Receipt<Task>>;
  complete(id: string, ctx: Ctx, opts?: CompleteOptions): Promise<Receipt<Task>>;
  uncomplete(id: string, ctx: Ctx): Promise<Receipt<Task>>;
  cancel(id: string, ctx: Ctx): Promise<Receipt<Task>>;
  delete(id: string, ctx: Ctx, opts?: DeleteOptions): Promise<Receipt<Task>>;
  restore(id: string, ctx: Ctx): Promise<Receipt<Task>>;
  assign(id: string, input: TaskAssign, ctx: Ctx): Promise<Receipt<Task>>;
  reschedule(id: string, due: Due | null, ctx: Ctx): Promise<Receipt<Task>>;
  note(id: string, text: string, ctx: Ctx, attachments?: Attachment[]): Promise<Receipt<Task>>;
  history(id: string): Promise<LogEntry[]>;
  batch(items: BatchItem[], ctx: Ctx, opts?: { atomic?: boolean }): Promise<Receipt<Task>[]>;
  import(items: unknown[], ctx: Ctx, opts?: { dryRun?: boolean }): Promise<ImportResult>;
}

// ------------------------------------------------------------------ input schemas local to tasks

const assignSchema = z
  .strictObject({ executor: executorSchema.optional(), bucket: bucketSchema.nullable().optional() })
  .refine((value) => value.executor !== undefined || value.bucket !== undefined, { message: "Nothing to assign" });
const completeOptionsSchema = z.strictObject({ date: isoDate.optional(), subtasks: subtaskChoiceOnComplete.optional() });
const deleteOptionsSchema = z.strictObject({ subtasks: subtaskChoiceOnDelete.optional() });
const duplicateOptionsSchema = z.strictObject({ subtasks: z.boolean().optional() });
const rescheduleSchema = dueSchema.nullable();
const attachmentsSchema = z.array(attachmentSchema).max(20);
const importIdSchema = taskIdSchema.optional();

// ------------------------------------------------------------------ small helpers

const OPEN = new Set<string>(OPEN_STATUSES);
const isOpen = (task: Task): boolean => OPEN.has(task.status);
const unique = (items: string[]): string[] => [...new Set(items)];
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const byOrder = (a: Task, b: Task): number => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const isTaskId = (value: string): boolean => taskIdSchema.safeParse(value).success;
/** Whether a project ref names the Inbox, the way resolveProject reads it. */
const isInboxRef = (ref: string): boolean => ref.trim().toLowerCase() === "inbox";

/** The ordering scope of a task: its project, section, and parent. */
const scopeOf = (task: { projectId: string; sectionId?: string; parentId?: string }): string =>
  `${task.projectId}|${task.sectionId ?? ""}|${task.parentId ?? ""}`;

function originOf(ctx: Ctx, now: string): Task["origin"] {
  return {
    actor: ctx.actor,
    at: now,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
    evidence: ctx.evidence ?? [],
  };
}

/** `updated` with a bump when anything outside version/updatedAt differs, else `unchanged`. */
function updatedOrUnchanged(before: Task, next: Task, now: string): Mutation<Task> {
  return Object.keys(diff(before, next)).length ? okMutation("updated", before, bump(next, now)) : okMutation("unchanged", before, before);
}

/**
 * Hands out the next `order` per scope, counting up as tasks land in it. Give
 * it every task, deleted ones included: a deleted task keeps its slot, so a
 * restore never collides with what was added meanwhile.
 */
function orderAllocator(tasks: Task[]) {
  const counters = new Map<string, number>();
  return (projectId: string, sectionId: string | undefined, parentId: string | undefined): number => {
    const key = scopeOf({ projectId, sectionId, parentId });
    const next = counters.get(key) ?? tasks.filter((t) => scopeOf(t) === key).reduce((max, t) => Math.max(max, t.order + 1), 0);
    counters.set(key, next + 1);
    return next;
  };
}

/** Direct sub-tasks of `id` among `tasks`, by order. */
export function childrenOf(id: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.parentId === id).sort(byOrder);
}

/** Every task under `id` (not `id` itself), depth first, siblings by order. Cycle-safe. */
export function descendantsOf(id: string, tasks: Task[]): Task[] {
  const out: Task[] = [];
  const seen = new Set([id]);
  const visit = (parentId: string) => {
    for (const child of childrenOf(parentId, tasks)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return out;
}

type Lookup<T> = { ok: true; record: T } | { ok: false; issues: string[]; id?: string };
const failed = (lookup: { issues: string[]; id?: string }): Mutation<Task> => fail<Task>(lookup.issues, lookup.id !== undefined ? { id: lookup.id } : {});

/** A task by id, deleted included; null for anything that is not a task id. */
async function anyTask(tx: Tx, id: string): Promise<Task | null> {
  return isTaskId(id) ? tx.get("task", id) : null;
}

/** A non-deleted task by id, or the issue that explains why not. `field` prefixes the issue. */
async function liveTask(tx: Tx, id: string, field = "task"): Promise<Lookup<Task>> {
  const task = await anyTask(tx, id);
  if (!task) return { ok: false, issues: [`${field}: no task "${id}"`] };
  if (task.deletedAt) return { ok: false, issues: [`${field}: task "${id}" is deleted; restore it first`], id: task.id };
  return { ok: true, record: task };
}

/** A non-deleted project by ref (id, slug path, or inbox), or the issue that explains why not. */
async function liveProject(tx: Tx, ref: string, field = "project"): Promise<Lookup<Project>> {
  const project = await resolveProject(tx, ref, { includeDeleted: true });
  if (!project) return { ok: false, issues: [`${field}: no project "${ref}"`] };
  if (project.deletedAt) return { ok: false, issues: [`${field}: project "${ref}" is deleted; restore it first`], id: project.id };
  return { ok: true, record: project };
}

async function pathOf(tx: Tx, project: Project): Promise<string> {
  return projectPath(project, indexProjects(await tx.all("project", { includeDeleted: true })));
}

/** A cascaded write was rejected: abort the transaction and surface the issues as the primary receipt. */
class CascadeRejected extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
  }
}

function must(receipt: Receipt<Task>, what: string): Task {
  if (!receipt.ok) throw new CascadeRejected(receipt.issues.map((issue) => `${what}: ${issue}`));
  return receipt.record;
}

async function guarded(run: () => Promise<Receipt<Task>>): Promise<Receipt<Task>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CascadeRejected) return rejected(error.issues);
    throw error;
  }
}

// ------------------------------------------------------------------ the duplicate check

/** Lowercase ASCII words separated by single spaces; punctuation and accents gone. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same normalized title, or word-set Jaccard >= 0.75 when both titles have at least three distinct words. */
export function similarTitles(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  if (wa.size < 3 || wb.size < 3) return false;
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared++;
  return shared / (wa.size + wb.size - shared) >= 0.75;
}

/** The open, non-deleted tasks among `tasks` whose title is similar to `title`. */
export function findDuplicates(title: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.deletedAt && isOpen(t) && similarTitles(title, t.title)).sort(byOrder);
}

// ------------------------------------------------------------------ the factory

type Work = (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<Task>>;
/** A validated operation ready to run: the log op name and the work, or the issues that stopped it. */
type Prepared = { ok: true; op: string; work: Work } | { ok: false; issues: string[] };
const invalid = (issues: string[]): Prepared => ({ ok: false, issues });

/** Atomic batch: the first rejection aborts the transaction and every receipt reports it. */
class BatchAborted extends Error {
  readonly index: number;
  readonly receipt: Receipt<Task>;

  constructor(index: number, receipt: Receipt<Task>) {
    super(`batch: item ${index} was rejected`);
    this.index = index;
    this.receipt = receipt;
  }
}

/** Import dry run: everything ran; roll it back and hand the result out. */
class ImportDryRun extends Error {
  readonly result: ImportResult;

  constructor(result: ImportResult) {
    super("import: dry run");
    this.result = result;
  }
}

/**
 * The task operations over `store` with `clock`. `organize` is accepted for
 * symmetry with the module map; the task operations only need the tx-level
 * helpers organize.ts exports, so it may be omitted.
 */
export function createTasks(store: Store, clock: Clock, _organize?: Organize): TaskOps {
  const today = (): string => todayIn(clock.timezone, clock.now());
  const write = (op: string, ctx: Ctx, work: Work): Promise<Receipt<Task>> => guarded(() => mutate(store, clock, "task", op, ctx, work));
  const run = (prepared: Prepared, ctx: Ctx): Promise<Receipt<Task>> => (prepared.ok ? write(prepared.op, ctx, prepared.work) : Promise.resolve(rejected(prepared.issues)));

  /** The Inbox from a read, creating it in a write transaction when it does not exist yet. */
  async function inbox(): Promise<Project> {
    const existing = await store.read((tx) => findInbox(tx));
    return existing ?? store.transaction((tx) => ensureInbox(tx, clock));
  }

  // ---------------------------------------------------------------- add

  async function addTask(tx: Tx, input: TaskAdd, ctx: Ctx, now: string, opts: { id?: string } = {}): Promise<Mutation<Task>> {
    let parent: Task | undefined;
    if (input.parent !== undefined) {
      const found = await liveTask(tx, input.parent, "parent");
      if (!found.ok) return failed(found);
      parent = found.record;
    }
    // The project: the ref, the parent's, or the Inbox. The Inbox is created on first use, but only
    // once the input has passed every check below, so a rejection leaves nothing behind.
    let project: Project | null;
    if (input.project !== undefined && !isInboxRef(input.project)) {
      const found = await liveProject(tx, input.project);
      if (!found.ok) return failed(found);
      project = found.record;
    } else if (input.project === undefined && parent) {
      const found = await liveProject(tx, parent.projectId, "parent");
      if (!found.ok) return failed(found);
      project = found.record;
    } else {
      project = await findInbox(tx);
    }
    if (parent && parent.projectId !== project?.id) return fail([`parent: task "${parent.id}" is not in project "${input.project}"`]);
    let sectionId = parent?.sectionId;
    if (input.section !== undefined) {
      const section = project ? await resolveSection(tx, project.id, input.section) : null;
      if (!section) return fail([`section: no section "${input.section}" in project "${project ? await pathOf(tx, project) : "inbox"}"`]);
      if (parent && section.id !== parent.sectionId) return fail([`section: a sub-task lives in its parent's section; leave section out or pass parent null`]);
      sectionId = section.id;
    }
    const tasks = await tx.all("task", { includeDeleted: true });
    if (!input.allowDuplicate) {
      const candidates = findDuplicates(input.title, tasks);
      if (candidates.length) {
        return duplicateMutation(candidates, [`Similar open tasks exist (${candidates.map((t) => t.id).join(", ")}); pass allowDuplicate to add anyway`]);
      }
    }
    // Every check has passed: the writes the new task depends on come last.
    project ??= await ensureInbox(tx, clock);
    const labels = unique(input.labels ?? []);
    const ensured = await ensureLabels(tx, clock, ctx, labels);
    if (ensured.issues.length) return fail(ensured.issues);
    const record: Task = {
      id: opts.id ?? newId("task"),
      title: input.title,
      notes: input.notes ?? "",
      projectId: project.id,
      ...(sectionId !== undefined ? { sectionId } : {}),
      ...(parent ? { parentId: parent.id } : {}),
      order: orderAllocator(tasks)(project.id, sectionId, parent?.id),
      status: input.status ?? (ctx.actor === "neel" ? "accepted" : "proposed"),
      executor: input.executor ?? "neel",
      ...(input.bucket !== undefined ? { bucket: input.bucket } : {}),
      due: input.due ?? null,
      ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
      deadline: input.deadline ?? null,
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      labels,
      comments: [],
      occurrences: [],
      origin: originOf(ctx, now),
      external: input.external ?? [],
      completedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    return okMutation("created", null, record);
  }

  // ---------------------------------------------------------------- update, move, reorder, duplicate

  async function updateTask(tx: Tx, id: string, input: TaskUpdate, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Task = { ...before };
    if (input.title !== undefined) next.title = input.title;
    if (input.notes !== undefined) next.notes = input.notes;
    if (input.priority !== undefined) {
      if (input.priority === null) delete next.priority;
      else next.priority = input.priority;
    }
    if (input.due !== undefined) next.due = input.due;
    if (input.repeat !== undefined) {
      if (input.repeat === null) delete next.repeat;
      else next.repeat = input.repeat;
    }
    if (input.deadline !== undefined) next.deadline = input.deadline;
    if (input.duration !== undefined) {
      if (input.duration === null) delete next.duration;
      else next.duration = input.duration;
    }
    if (next.repeat && !next.due) return fail(["due: a repeating task needs a due date; clear repeat first"], { id: before.id, record: before });
    // Checked; registering labels is the one write this update cascades, so it comes last.
    if (input.labels !== undefined) {
      const labels = unique(input.labels);
      const ensured = await ensureLabels(tx, clock, ctx, labels);
      if (ensured.issues.length) return fail(ensured.issues, { id: before.id });
      next.labels = labels;
    }
    return updatedOrUnchanged(before, next, now);
  }

  async function moveTask(tx: Tx, id: string, input: TaskMove, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const everything = await tx.all("task", { includeDeleted: true });
    const live = everything.filter((t) => !t.deletedAt);

    let projectId = before.projectId;
    let project: Project | null = null;
    if (input.project !== undefined) {
      // "inbox" creates the Inbox on first use, like add. Every task already has a project, and creating
      // any project creates the Inbox, so in practice this only reads.
      if (isInboxRef(input.project)) project = await ensureInbox(tx, clock);
      else {
        const target = await liveProject(tx, input.project);
        if (!target.ok) return failed(target);
        project = target.record;
      }
      projectId = project.id;
    }
    const projectChanged = projectId !== before.projectId;

    let parent: Task | undefined;
    if (input.parent === undefined) {
      parent = projectChanged || before.parentId === undefined ? undefined : live.find((t) => t.id === before.parentId);
    } else if (input.parent !== null) {
      const target = await liveTask(tx, input.parent, "parent");
      if (!target.ok) return failed(target);
      if (target.record.id === before.id) return fail(["parent: a task cannot be its own parent"], { id: before.id });
      if (target.record.projectId !== projectId) return fail([`parent: task "${target.record.id}" is not in the target project`], { id: before.id });
      if (descendantsOf(before.id, everything).some((d) => d.id === target.record.id)) {
        return fail(["parent: a task cannot move under its own sub-task"], { id: before.id });
      }
      parent = target.record;
    }

    let sectionId: string | undefined;
    if (input.section === undefined) sectionId = projectChanged ? undefined : before.sectionId;
    else if (input.section !== null) {
      const section = await resolveSection(tx, projectId, input.section);
      if (!section) {
        const owner = project ?? (await tx.get("project", projectId));
        const path = owner ? await pathOf(tx, owner) : projectId;
        return fail([`section: no section "${input.section}" in project "${path}"`], { id: before.id });
      }
      sectionId = section.id;
    }
    if (parent) {
      if (input.section !== undefined && (sectionId ?? null) !== (parent.sectionId ?? null)) {
        return fail(["section: a sub-task lives in its parent's section; leave section out or pass parent null"], { id: before.id });
      }
      sectionId = parent.sectionId;
    }

    const next: Task = { ...before, projectId };
    if (sectionId === undefined) delete next.sectionId;
    else next.sectionId = sectionId;
    if (parent === undefined) delete next.parentId;
    else next.parentId = parent.id;
    if (scopeOf(next) !== scopeOf(before)) next.order = orderAllocator(everything)(projectId, sectionId, parent?.id);
    if (!Object.keys(diff(before, next)).length) return okMutation("unchanged", before, before);

    const cascade = cascadeCtx(ctx);
    for (const sub of descendantsOf(before.id, everything)) {
      const moved: Task = { ...sub, projectId };
      if (sectionId === undefined) delete moved.sectionId;
      else moved.sectionId = sectionId;
      if (!Object.keys(diff(sub, moved)).length) continue;
      must(
        await applyIn(tx, clock, "task", "task.move", cascade, async (_tx, _ctx, at) => okMutation("updated", sub, bump(moved, at))),
        `task ${sub.id}`,
      );
    }
    return okMutation("updated", before, bump(next, now));
  }

  async function reorderTasks(ids: string[], ctx: Ctx): Promise<Receipt<Task>[]> {
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) return ids.map(() => rejected(issuesOf(parsed.error)));
    const context = parsed.data;
    if (context.ifVersion !== undefined) return ids.map(() => rejected(["ifVersion: not supported by reorder"]));
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length) return ids.map(() => rejected(["ids: contains duplicates"]));
    return store.transaction(async (tx) => {
      const records: Task[] = [];
      const issues: string[] = [];
      for (const id of ids) {
        const record = await anyTask(tx, id);
        if (!record) issues.push(`${id}: no task`);
        else if (record.deletedAt) issues.push(`${id}: task is deleted`);
        else records.push(record);
      }
      if (!issues.length && new Set(records.map(scopeOf)).size > 1) issues.push("ids: every task must share the same project, section, and parent");
      if (issues.length) return ids.map(() => rejected(issues));
      const receipts: Receipt<Task>[] = [];
      for (const [index, record] of records.entries()) {
        receipts.push(
          await applyIn(tx, clock, "task", "task.reorder", itemCtx(context, index), async (_tx, _ctx, now) =>
            record.order === index ? okMutation("unchanged", record, record) : okMutation("updated", record, bump({ ...record, order: index }, now)),
          ),
        );
      }
      return receipts;
    });
  }

  async function duplicateTask(tx: Tx, id: string, ctx: Ctx, now: string, opts: DuplicateOptions): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const everything = await tx.all("task", { includeDeleted: true });
    const live = everything.filter((t) => !t.deletedAt);
    const status: TaskStatus = ctx.actor === "neel" ? "accepted" : "proposed";
    const copyOf = (source: Task, parentId: string | undefined, order: number): Task => ({
      id: newId("task"),
      title: source.title,
      notes: source.notes,
      projectId: source.projectId,
      ...(source.sectionId !== undefined ? { sectionId: source.sectionId } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      order,
      status,
      executor: source.executor,
      ...(source.bucket !== undefined ? { bucket: source.bucket } : {}),
      due: source.due,
      ...(source.repeat !== undefined ? { repeat: source.repeat } : {}),
      deadline: source.deadline,
      ...(source.duration !== undefined ? { duration: source.duration } : {}),
      ...(source.priority !== undefined ? { priority: source.priority } : {}),
      labels: [...source.labels],
      comments: [],
      occurrences: [],
      origin: originOf(ctx, now),
      external: [],
      completedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const copy = copyOf(before, before.parentId, before.order + 1);
    const cascade = cascadeCtx(ctx);
    // The copy sits right after the original: every sibling after it moves up one, deleted siblings
    // included so a restore lands where it was, not on the copy.
    const scope = scopeOf(before);
    for (const sibling of everything.filter((t) => t.id !== before.id && scopeOf(t) === scope && t.order > before.order).sort(byOrder)) {
      must(
        await applyIn(tx, clock, "task", "task.duplicate", cascade, async (_tx, _ctx, at) => okMutation("updated", sibling, bump({ ...sibling, order: sibling.order + 1 }, at))),
        `task ${sibling.id}`,
      );
    }
    if (opts.subtasks !== false) {
      const visit = async (sourceId: string, targetId: string): Promise<void> => {
        for (const child of childrenOf(sourceId, live)) {
          const childCopy = copyOf(child, targetId, child.order);
          must(await applyIn(tx, clock, "task", "task.duplicate", cascade, async () => okMutation("created", null, childCopy)), `task ${child.id}`);
          await visit(child.id, childCopy.id);
        }
      };
      await visit(before.id, copy.id);
    }
    return okMutation("created", null, copy);
  }

  // ---------------------------------------------------------------- lifecycle

  /** A status transition from one of `from` to `to`, with `extra` applied to the record. */
  async function transition(tx: Tx, id: string, ctx: Ctx, now: string, verb: string, from: readonly TaskStatus[], to: TaskStatus, extra: Partial<Task> = {}): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!from.includes(before.status)) {
      return fail([`status: ${verb} needs ${from.join(" or ")}, task is ${before.status}`], { id: before.id, record: before });
    }
    return okMutation("updated", before, bump({ ...before, ...extra, status: to }, now));
  }

  /** What completing one task does: record the occurrence and either close it or, when it repeats, advance it. */
  function completion(task: Task, ctx: Ctx, at: string, date: string | undefined): Mutation<Task> {
    if (task.repeat) {
      if (!task.due) return fail(["due: a repeating task needs a due date"], { id: task.id, record: task });
      const rule = parseRule(task.repeat);
      if (!rule.ok) return fail([`repeat: ${rule.error}`], { id: task.id, record: task });
      const anchor = task.due.date;
      const occurred = date ?? anchor;
      const after = occurred > anchor ? occurred : anchor;
      const nextDate = nextOccurrence(rule.rule, anchor, after);
      if (!nextDate) return fail([`repeat: no occurrence after ${after}`], { id: task.id, record: task });
      return okMutation(
        "updated",
        task,
        bump(
          {
            ...task,
            status: "accepted",
            due: { ...task.due, date: nextDate },
            occurrences: [...task.occurrences, { date: occurred, at, actor: ctx.actor }],
          },
          at,
        ),
      );
    }
    const occurred = date ?? task.due?.date ?? today();
    return okMutation(
      "updated",
      task,
      bump({ ...task, status: "done", completedAt: at, occurrences: [...task.occurrences, { date: occurred, at, actor: ctx.actor }] }, at),
    );
  }

  async function completeTask(tx: Tx, id: string, ctx: Ctx, now: string, opts: CompleteOptions): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (before.status !== "accepted" && before.status !== "in_progress") {
      return fail([`status: complete needs accepted or in_progress, task is ${before.status}`], { id: before.id, record: before });
    }
    const openBelow = descendantsOf(before.id, await tx.all("task")).filter(isOpen);
    if (openBelow.length && opts.subtasks === undefined) {
      const message = `Task "${before.title}" has ${count(openBelow.length, "open sub-task")}; pass subtasks "complete" to complete them too, or "leave" to leave them open`;
      return fail([message], { id: before.id, record: before, needs: { field: "subtasks", options: ["complete", "leave"], message } });
    }
    // The task's own completion is settled before anything below it is written.
    const primary = completion(before, ctx, now, opts.date);
    if (!primary.receipt.ok) return primary;
    if (opts.subtasks === "complete") {
      const cascade = cascadeCtx(ctx);
      for (const sub of openBelow) {
        must(await applyIn(tx, clock, "task", "task.complete", cascade, async (_tx, c, at) => completion(sub, c, at, opts.date)), `task ${sub.id}`);
      }
    }
    return primary;
  }

  /**
   * The due date the task had before the completion that recorded its last
   * occurrence, from that completion's own log entry (HANDS D52: a log-based
   * rewind). Null when the log holds no such entry.
   */
  async function dueBeforeLastCompletion(tx: Tx, task: Task): Promise<string | null> {
    for (const entry of (await tx.history("task", task.id)).toReversed()) {
      if (entry.op !== "task.complete") continue;
      const recorded = entry.patch.occurrences?.to;
      if (!Array.isArray(recorded) || recorded.length !== task.occurrences.length) continue;
      const from = dueSchema.safeParse(entry.patch.due?.from);
      return from.success ? from.data.date : null;
    }
    return null;
  }

  async function uncompleteTask(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (before.status === "done") {
      return okMutation("updated", before, bump({ ...before, status: "accepted", completedAt: null, occurrences: before.occurrences.slice(0, -1) }, now));
    }
    if (before.status === "cancelled") return okMutation("updated", before, bump({ ...before, status: "accepted", completedAt: null }, now));
    const last = before.occurrences[before.occurrences.length - 1];
    if ((before.status === "accepted" || before.status === "in_progress") && before.repeat && before.due && last) {
      // Rewind the last completion: the due date it advanced from comes back and its occurrence goes.
      // An early or late completion recorded a different date, so the occurrence is only the fallback.
      // A task started since that completion goes back to accepted, the status the completion left it in.
      const date = (await dueBeforeLastCompletion(tx, before)) ?? last.date;
      return okMutation("updated", before, bump({ ...before, status: "accepted", due: { ...before.due, date }, occurrences: before.occurrences.slice(0, -1) }, now));
    }
    const why = before.repeat && !last ? "no recorded occurrence to rewind" : `task is ${before.status}`;
    return fail([`status: uncomplete needs done, cancelled, or a repeating task with an occurrence; ${why}`], { id: before.id, record: before });
  }

  async function cancelTask(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    if (ctx.reason === undefined) return fail(["reason: cancel needs a reason"], isTaskId(id) ? { id } : {});
    return transition(tx, id, ctx, now, "cancel", OPEN_STATUSES, "cancelled");
  }

  // ---------------------------------------------------------------- delete and restore

  async function deleteTask(tx: Tx, id: string, ctx: Ctx, now: string, opts: DeleteOptions): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const everything = await tx.all("task", { includeDeleted: true });
    const live = everything.filter((t) => !t.deletedAt);
    // The same question complete asks (HANDS D54): open, non-deleted sub-tasks anywhere below need a choice.
    const below = descendantsOf(before.id, live);
    const openBelow = below.filter(isOpen);
    if (openBelow.length && opts.subtasks === undefined) {
      const message = `Task "${before.title}" has ${count(openBelow.length, "open sub-task")}; pass subtasks "delete" to delete them too, or "leave" to keep them under its parent`;
      return fail([message], { id: before.id, record: before, needs: { field: "subtasks", options: ["delete", "leave"], message } });
    }
    const cascade = cascadeCtx(ctx);
    if (opts.subtasks === "leave") {
      const allocate = orderAllocator(everything);
      for (const child of childrenOf(before.id, live)) {
        const next: Task = { ...child };
        if (before.parentId === undefined) delete next.parentId;
        else next.parentId = before.parentId;
        next.order = allocate(next.projectId, next.sectionId, next.parentId);
        must(await applyIn(tx, clock, "task", "task.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", child, bump(next, at))), `task ${child.id}`);
      }
    } else {
      // "delete", or no choice with nothing open below: the subtree goes to the trash with it, each restorable on its own.
      for (const sub of below) {
        must(await applyIn(tx, clock, "task", "task.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", sub, bump({ ...sub, deletedAt: at }, at))), `task ${sub.id}`);
      }
    }
    return okMutation("updated", before, bump({ ...before, deletedAt: now }, now));
  }

  async function restoreTask(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const before = await anyTask(tx, id);
    if (!before) return fail([`task: no task "${id}"`]);
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!before.deletedAt) return okMutation("unchanged", before, before);
    const next: Task = { ...before, deletedAt: null };
    const project = await tx.get("project", before.projectId);
    if (!project || project.deletedAt) {
      next.projectId = (await ensureInbox(tx, clock)).id;
      delete next.sectionId;
    }
    if (next.sectionId !== undefined) {
      const section = await tx.get("section", next.sectionId);
      if (!section || section.deletedAt || section.projectId !== next.projectId) delete next.sectionId;
    }
    if (next.parentId !== undefined) {
      const parent = await tx.get("task", next.parentId);
      if (!parent || parent.deletedAt || parent.projectId !== next.projectId) delete next.parentId;
      else if (parent.sectionId === undefined) delete next.sectionId;
      else next.sectionId = parent.sectionId;
    }
    if (scopeOf(next) !== scopeOf(before)) next.order = orderAllocator(await tx.all("task", { includeDeleted: true }))(next.projectId, next.sectionId, next.parentId);
    return okMutation("updated", before, bump(next, now));
  }

  // ---------------------------------------------------------------- assign, reschedule, note

  async function assignTask(tx: Tx, id: string, input: TaskAssign, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Task = { ...before };
    if (input.executor !== undefined) next.executor = input.executor;
    if (input.bucket !== undefined) {
      if (input.bucket === null) delete next.bucket;
      else next.bucket = input.bucket;
    }
    return updatedOrUnchanged(before, next, now);
  }

  async function rescheduleTask(tx: Tx, id: string, due: Due | null, ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!isOpen(before)) return fail([`status: reschedule needs an open task, task is ${before.status}`], { id: before.id, record: before });
    if (due === null && before.repeat) return fail(["due: a repeating task cannot go undated; clear repeat first"], { id: before.id, record: before });
    return updatedOrUnchanged(before, { ...before, due }, now);
  }

  async function noteTask(tx: Tx, id: string, text: string, attachments: Attachment[], ctx: Ctx, now: string): Promise<Mutation<Task>> {
    const found = await liveTask(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const comment = { actor: ctx.actor, at: now, text, attachments };
    return okMutation("updated", before, bump({ ...before, comments: [...before.comments, comment] }, now));
  }

  // ---------------------------------------------------------------- preparing operations (shared by the single calls and batch)

  const prepareUpdate = (id: string, input: unknown): Prepared => {
    const parsed = taskUpdateSchema.safeParse(input);
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.update", work: (tx, c, now) => updateTask(tx, id, parsed.data, c, now) };
  };
  const prepareMove = (id: string, input: unknown): Prepared => {
    const parsed = taskMoveSchema.safeParse(input);
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.move", work: (tx, c, now) => moveTask(tx, id, parsed.data, c, now) };
  };
  const prepareDuplicate = (id: string, options: unknown): Prepared => {
    const parsed = duplicateOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.duplicate", work: (tx, c, now) => duplicateTask(tx, id, c, now, parsed.data) };
  };
  const prepareAccept = (id: string): Prepared => ({ ok: true, op: "task.accept", work: (tx, c, now) => transition(tx, id, c, now, "accept", ["proposed"], "accepted") });
  const prepareStart = (id: string): Prepared => ({ ok: true, op: "task.start", work: (tx, c, now) => transition(tx, id, c, now, "start", ["accepted"], "in_progress") });
  const prepareComplete = (id: string, options: unknown): Prepared => {
    const parsed = completeOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.complete", work: (tx, c, now) => completeTask(tx, id, c, now, parsed.data) };
  };
  const prepareUncomplete = (id: string): Prepared => ({ ok: true, op: "task.uncomplete", work: (tx, c, now) => uncompleteTask(tx, id, c, now) });
  const prepareCancel = (id: string): Prepared => ({ ok: true, op: "task.cancel", work: (tx, c, now) => cancelTask(tx, id, c, now) });
  const prepareDelete = (id: string, options: unknown): Prepared => {
    const parsed = deleteOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.delete", work: (tx, c, now) => deleteTask(tx, id, c, now, parsed.data) };
  };
  const prepareRestore = (id: string): Prepared => ({ ok: true, op: "task.restore", work: (tx, c, now) => restoreTask(tx, id, c, now) });
  const prepareAssign = (id: string, input: unknown): Prepared => {
    const parsed = assignSchema.safeParse(input);
    if (!parsed.success) return invalid(issuesOf(parsed.error));
    return { ok: true, op: "task.assign", work: (tx, c, now) => assignTask(tx, id, parsed.data, c, now) };
  };
  const prepareReschedule = (id: string, due: unknown): Prepared => {
    if (due === undefined) return invalid(["due: reschedule needs a due date or null"]);
    const parsed = rescheduleSchema.safeParse(due);
    if (!parsed.success) return invalid(issuesOf(parsed.error).map((issue) => `due.${issue}`.replace("due.input:", "due:")));
    return { ok: true, op: "task.reschedule", work: (tx, c, now) => rescheduleTask(tx, id, parsed.data, c, now) };
  };
  const prepareNote = (id: string, text: unknown, attachments: unknown): Prepared => {
    const parsedText = textSchema.safeParse(text);
    if (!parsedText.success) return invalid(issuesOf(parsedText.error).map((issue) => issue.replace(/^input:/, "text:")));
    const parsedAttachments = attachmentsSchema.safeParse(attachments ?? []);
    if (!parsedAttachments.success) return invalid(issuesOf(parsedAttachments.error).map((issue) => `attachments.${issue}`.replace("attachments.input:", "attachments:")));
    return { ok: true, op: "task.note", work: (tx, c, now) => noteTask(tx, id, parsedText.data, parsedAttachments.data, c, now) };
  };

  function prepareItem(item: BatchItem): Prepared {
    if (typeof item !== "object" || item === null) return invalid(["item: expected an object"]);
    const op = item.op as string;
    if (!(BATCH_OPS as readonly string[]).includes(op)) return invalid([`op: expected one of ${BATCH_OPS.join(", ")}, got "${String(op)}"`]);
    if (typeof item.id !== "string") return invalid(["id: expected a task id"]);
    switch (item.op) {
      case "accept":
        return prepareAccept(item.id);
      case "start":
        return prepareStart(item.id);
      case "complete":
        return prepareComplete(item.id, item.options);
      case "uncomplete":
        return prepareUncomplete(item.id);
      case "cancel":
        return prepareCancel(item.id);
      case "delete":
        return prepareDelete(item.id, item.options);
      case "restore":
        return prepareRestore(item.id);
      case "move":
        return prepareMove(item.id, item.input);
      case "reschedule":
        return prepareReschedule(item.id, item.input);
      case "assign":
        return prepareAssign(item.id, item.input);
      case "update":
        return prepareUpdate(item.id, item.input);
      case "duplicate":
        return prepareDuplicate(item.id, item.options);
    }
  }

  // ---------------------------------------------------------------- list

  async function listTasks(criteria: TaskList): Promise<Task[]> {
    const parsed = taskListSchema.safeParse(criteria);
    if (!parsed.success) throw new Error(`list: ${issuesOf(parsed.error).join("; ")}`);
    const q = parsed.data;
    if (q.project !== undefined && q.project.trim().toLowerCase() === "inbox") await inbox();
    const ast = q.filter !== undefined ? parseFilter(q.filter) : null;
    if (ast && !ast.ok) throw new Error(`list: filter: ${ast.error}`);
    return store.read(async (tx) => {
      const projects = await tx.all("project", { includeDeleted: true });
      const index: ProjectIndex = indexProjects(projects);
      let projectIds: Set<string> | null = null;
      let project: Project | null = null;
      if (q.project !== undefined) {
        project = await resolveProject(tx, q.project, { includeDeleted: q.includeDeleted });
        if (!project) throw new Error(`list: no project "${q.project}"`);
        projectIds = new Set([project.id]);
        if (q.withSubprojects) {
          for (const sub of projectDescendants(project.id, q.includeDeleted ? projects : projects.filter((p) => !p.deletedAt))) projectIds.add(sub.id);
        }
      }
      let sectionId: string | null = null;
      if (q.section !== undefined) {
        if (project) {
          const section = await resolveSection(tx, project.id, q.section, { includeDeleted: q.includeDeleted });
          if (!section) throw new Error(`list: no section "${q.section}" in project "${projectPath(project, index)}"`);
          sectionId = section.id;
        } else if (sectionIdSchema.safeParse(q.section).success) {
          const section = await tx.get("section", q.section);
          if (!section || (section.deletedAt && !q.includeDeleted)) throw new Error(`list: no section "${q.section}"`);
          sectionId = section.id;
        } else throw new Error(`list: pass project to look up section "${q.section}" by name`);
      }
      const statuses: Set<string> | null = q.status ? new Set(q.status) : q.includeClosed || (ast?.ok && mentionsStatus(ast.ast)) ? null : OPEN;
      const now = today();
      const needle = q.text?.toLowerCase();
      const tasks = (await tx.all("task", { includeDeleted: q.includeDeleted })).filter((t) => {
        if (statuses && !statuses.has(t.status)) return false;
        if (projectIds && !projectIds.has(t.projectId)) return false;
        if (sectionId !== null && t.sectionId !== sectionId) return false;
        if (q.parent !== undefined && (q.parent === null ? t.parentId !== undefined : t.parentId !== q.parent)) return false;
        if (q.executor !== undefined && t.executor !== q.executor) return false;
        if (q.label !== undefined && !effectiveLabels(t, index).includes(q.label)) return false;
        const dueDate = t.due?.date ?? null;
        if (q.undated && dueDate !== null) return false;
        if (q.dueOn !== undefined && dueDate !== q.dueOn) return false;
        if (q.dueBefore !== undefined && (dueDate === null || dueDate >= q.dueBefore)) return false;
        if (q.dueAfter !== undefined && (dueDate === null || dueDate <= q.dueAfter)) return false;
        if (needle === undefined && !ast) return true;
        const subject = filterSubject(t, index);
        if (needle !== undefined && !subject.searchable.includes(needle)) return false;
        if (ast?.ok && !matches(ast.ast, subject, now)) return false;
        return true;
      });
      const sorted = sortTasks(tasks);
      return q.limit !== undefined ? sorted.slice(0, q.limit) : sorted;
    });
  }

  // ---------------------------------------------------------------- batch and import

  /** The ctx without its version guard, for a batch item on a record an earlier item already changed. */
  const withoutVersion = (ctx: Ctx): Ctx => {
    const { ifVersion: _ifVersion, ...rest } = ctx;
    return rest;
  };

  /**
   * An item's throw as its receipt: a rejection that came after its cascade
   * wrote, or a cascade that was itself rejected. Anything else propagates.
   * What the cascade wrote is undone by the caller: the item's savepoint in a
   * non-atomic batch, the whole transaction in an atomic one.
   */
  const thrownAsReceipt = (error: unknown): Receipt<Task> => {
    if (error instanceof RejectedAfterWrites) return error.receipt as Receipt<Task>;
    if (error instanceof CascadeRejected) return rejected(error.issues);
    throw error;
  };

  async function batch(items: BatchItem[], ctx: Ctx, opts: { atomic?: boolean } = {}): Promise<Receipt<Task>[]> {
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) return items.map(() => rejected(issuesOf(parsed.error)));
    const context = parsed.data;
    if (!items.length) return [];
    const prepared = items.map(prepareItem);
    try {
      return await store.transaction(async (tx) => {
        const receipts: Receipt<Task>[] = [];
        /** Records an earlier item already applied to: ctx.ifVersion guards the first item on each, later ones take the version that item left. */
        const applied = new Set<string>();
        for (const [index, item] of prepared.entries()) {
          let receipt: Receipt<Task>;
          if (!item.ok) receipt = rejected(item.issues);
          else {
            const id = items[index]!.id;
            const itemContext = itemCtx(applied.has(id) ? withoutVersion(context) : context, index);
            const run = () => applyIn(tx, clock, "task", item.op, itemContext, item.work);
            // Each non-atomic item stands on its own: a savepoint undoes what a rejected item's cascade wrote and nothing else.
            receipt = await (opts.atomic ? run() : withSavepoint(tx, run)).catch(thrownAsReceipt);
            if (receipt.ok) applied.add(id);
          }
          receipts.push(receipt);
          if (opts.atomic && !receipt.ok) throw new BatchAborted(index, receipt);
        }
        return receipts;
      });
    } catch (error) {
      if (error instanceof BatchAborted) {
        const culprit = items[error.index]!;
        const why = `batch: rolled back; item ${error.index} (${String(culprit.op)} ${String(culprit.id)}) was rejected: ${error.receipt.issues.join("; ")}`;
        return items.map((_, index) => (index === error.index ? error.receipt : rejected<Task>([why])));
      }
      throw error;
    }
  }

  /** An import item: a TaskAdd plus an optional id. */
  function parseImportItem(raw: unknown): { ok: true; id: string | undefined; input: TaskAdd } | { ok: false; issues: string[] } {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issues: ["item: expected an object"] };
    const { id, ...rest } = raw as Record<string, unknown>;
    const parsedId = importIdSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, issues: issuesOf(parsedId.error).map((issue) => issue.replace(/^input:/, "id:")) };
    const parsedInput = taskAddSchema.safeParse(rest);
    if (!parsedInput.success) return { ok: false, issues: issuesOf(parsedInput.error) };
    return { ok: true, id: parsedId.data, input: parsedInput.data };
  }

  async function importTasks(items: unknown[], ctx: Ctx, opts: { dryRun?: boolean } = {}): Promise<ImportResult> {
    const dryRun = Boolean(opts.dryRun);
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) {
      const issues = issuesOf(parsed.error);
      return { dryRun, created: 0, duplicate: 0, rejected: items.length, items: items.map((_, index) => ({ index, outcome: "rejected", issues })) };
    }
    const context = parsed.data;
    try {
      return await store.transaction(async (tx) => {
        const results: ImportItemResult[] = [];
        for (const [index, raw] of items.entries()) {
          const item = parseImportItem(raw);
          if (!item.ok) {
            results.push({ index, outcome: "rejected", issues: item.issues });
            continue;
          }
          const receipt = await applyIn(tx, clock, "task", "task.import", itemCtx(context, index), async (t, c, now) => {
            if (item.id !== undefined && (await t.get("task", item.id))) return fail<Task>([`id: "${item.id}" is already used`]);
            return addTask(t, item.input, c, now, item.id !== undefined ? { id: item.id } : {});
          });
          if (receipt.ok) results.push({ index, outcome: receipt.outcome, id: receipt.id, issues: [] });
          else if (receipt.outcome === "duplicate") results.push({ index, outcome: "duplicate", issues: receipt.issues });
          else results.push({ index, outcome: "rejected", ...(receipt.id !== undefined ? { id: receipt.id } : {}), issues: receipt.issues });
        }
        const tally = (outcome: Outcome) => results.filter((r) => r.outcome === outcome).length;
        const result: ImportResult = { dryRun, created: tally("created"), duplicate: tally("duplicate"), rejected: tally("rejected"), items: results };
        if (dryRun) throw new ImportDryRun(result);
        return result;
      });
    } catch (error) {
      if (error instanceof ImportDryRun) return error.result;
      if (error instanceof RejectedAfterWrites) {
        const issues = [`import: rolled back; an item was rejected after its cascade wrote: ${error.receipt.issues.join("; ")}`];
        return { dryRun, created: 0, duplicate: 0, rejected: items.length, items: items.map((_, index) => ({ index, outcome: "rejected", issues })) };
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- the ops object

  return {
    async add(input, ctx) {
      const parsed = taskAddSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("task.add", ctx, (tx, c, now) => addTask(tx, parsed.data, c, now));
    },
    get: (id) => (isTaskId(id) ? store.read((tx) => tx.get("task", id)) : Promise.resolve(null)),
    list: (criteria = {}) => listTasks(criteria),
    update: (id, input, ctx) => run(prepareUpdate(id, input), ctx),
    move: (id, input, ctx) => run(prepareMove(id, input), ctx),
    reorder: reorderTasks,
    duplicate: (id, ctx, opts) => run(prepareDuplicate(id, opts), ctx),
    accept: (id, ctx) => run(prepareAccept(id), ctx),
    start: (id, ctx) => run(prepareStart(id), ctx),
    complete: (id, ctx, opts) => run(prepareComplete(id, opts), ctx),
    uncomplete: (id, ctx) => run(prepareUncomplete(id), ctx),
    cancel: (id, ctx) => run(prepareCancel(id), ctx),
    delete: (id, ctx, opts) => run(prepareDelete(id, opts), ctx),
    restore: (id, ctx) => run(prepareRestore(id), ctx),
    assign: (id, input, ctx) => run(prepareAssign(id, input), ctx),
    reschedule: (id, due, ctx) => run(prepareReschedule(id, due), ctx),
    note: (id, text, ctx, attachments) => run(prepareNote(id, text, attachments), ctx),
    history: (id) => store.read((tx) => tx.history("task", id)),
    batch,
    import: importTasks,
  };
}
