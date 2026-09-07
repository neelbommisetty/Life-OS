// Projects, sections, labels, and filters: the containers and slices around
// tasks. Reference resolution (ids, slug paths, names), the Inbox, effective
// labels, and the cascades that keep containers and their contents consistent
// (deleting a project with contents, renaming a label). Every write goes
// through core.mutate / core.applyIn; nothing here touches the store directly
// except to read.

import {
  OPEN_STATUSES,
  ctxSchema,
  filterAddSchema,
  filterId as filterIdSchema,
  filterUpdateSchema,
  issuesOf,
  labelAddSchema,
  labelId as labelIdSchema,
  labelUpdateSchema,
  projectAddSchema,
  projectId as projectIdSchema,
  projectUpdateSchema,
  recordId,
  sectionAddSchema,
  sectionId as sectionIdSchema,
  sectionUpdateSchema,
  type Ctx,
  type Filter,
  type FilterAdd,
  type FilterUpdate,
  type Label,
  type LabelAdd,
  type LabelUpdate,
  type LogEntry,
  type Project,
  type ProjectAdd,
  type ProjectUpdate,
  type Receipt,
  type Section,
  type SectionAdd,
  type SectionUpdate,
  type Task,
} from "./contract.ts";
import { applyIn, bump, checkVersion, diff, fail, itemCtx, mutate, newId, okMutation, rejected, type Clock, type Mutation } from "./core.ts";
import { matches, mentionsStatus, parseFilter, type FilterSubject } from "./filter.ts";
import type { Kind, RecordOf, Store, Tx } from "./store.ts";
import { todayIn } from "./time.ts";

// ------------------------------------------------------------------ types

export type ProjectNode = { project: Project; sections: Section[]; children: ProjectNode[] };
/** Projects by id, as a Map or a plain object; `indexProjects` builds the Map. */
export type ProjectIndex = ReadonlyMap<string, Project> | Readonly<Record<string, Project>>;
export type ProjectContents = "delete" | "inbox";
export type SectionTasks = "delete" | "unsection";

export interface ProjectOps {
  add(input: ProjectAdd, ctx: Ctx): Promise<Receipt<Project>>;
  /** An id (deleted included), a slug path like `health/dental`, or `inbox` (created on first use). */
  get(ref: string): Promise<Project | null>;
  tree(opts?: { includeArchived?: boolean }): Promise<ProjectNode[]>;
  update(ref: string, input: ProjectUpdate, ctx: Ctx): Promise<Receipt<Project>>;
  move(ref: string, parent: string | null, ctx: Ctx): Promise<Receipt<Project>>;
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Project>[]>;
  archive(ref: string, ctx: Ctx): Promise<Receipt<Project>>;
  unarchive(ref: string, ctx: Ctx): Promise<Receipt<Project>>;
  delete(ref: string, ctx: Ctx, opts?: { contents?: ProjectContents }): Promise<Receipt<Project>>;
  restore(id: string, ctx: Ctx): Promise<Receipt<Project>>;
  history(id: string): Promise<LogEntry[]>;
}

export interface SectionOps {
  add(input: SectionAdd, ctx: Ctx): Promise<Receipt<Section>>;
  /** Deleted included; callers check `deletedAt`. */
  get(id: string): Promise<Section | null>;
  /** Non-deleted sections of the project (archived included), by order. Throws when the project ref does not resolve. */
  list(projectRef: string): Promise<Section[]>;
  update(id: string, input: SectionUpdate, ctx: Ctx): Promise<Receipt<Section>>;
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Section>[]>;
  archive(id: string, ctx: Ctx): Promise<Receipt<Section>>;
  unarchive(id: string, ctx: Ctx): Promise<Receipt<Section>>;
  delete(id: string, ctx: Ctx, opts?: { tasks?: SectionTasks }): Promise<Receipt<Section>>;
  restore(id: string, ctx: Ctx): Promise<Receipt<Section>>;
}

export interface LabelOps {
  add(input: LabelAdd, ctx: Ctx): Promise<Receipt<Label>>;
  /** An id (deleted included) or a name (non-deleted only). */
  get(ref: string): Promise<Label | null>;
  list(): Promise<Label[]>;
  update(ref: string, input: LabelUpdate, ctx: Ctx): Promise<Receipt<Label>>;
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Label>[]>;
  delete(ref: string, ctx: Ctx): Promise<Receipt<Label>>;
  restore(id: string, ctx: Ctx): Promise<Receipt<Label>>;
}

export interface FilterOps {
  add(input: FilterAdd, ctx: Ctx): Promise<Receipt<Filter>>;
  /** An id (deleted included) or a name (non-deleted only). */
  get(ref: string): Promise<Filter | null>;
  list(): Promise<Filter[]>;
  update(ref: string, input: FilterUpdate, ctx: Ctx): Promise<Receipt<Filter>>;
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Filter>[]>;
  delete(ref: string, ctx: Ctx): Promise<Receipt<Filter>>;
  restore(id: string, ctx: Ctx): Promise<Receipt<Filter>>;
  /** A saved filter (id or name) or an ad hoc query. Throws when neither resolves nor parses. */
  run(refOrQuery: string): Promise<Task[]>;
}

export type Organize = { project: ProjectOps; section: SectionOps; label: LabelOps; filter: FilterOps };

// ------------------------------------------------------------------ small helpers

const unique = (items: string[]): string[] => [...new Set(items)];
const nextOrder = (records: { order: number }[]): number => records.reduce((max, r) => Math.max(max, r.order + 1), 0);
const byOrder = <T extends { order: number; createdAt: string; id: string }>(a: T, b: T): number =>
  a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
const looksLikeId = (value: string): boolean => recordId.safeParse(value).success;

/** kebab-case of a name: lowercase ASCII letters and digits, dashes between. Empty when nothing survives. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

function originOf(ctx: Ctx, now: string): Project["origin"] {
  return {
    actor: ctx.actor,
    at: now,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
    evidence: ctx.evidence ?? [],
  };
}

/** The ctx for records changed as a consequence of another record's mutation: same actor, reason, evidence; no key, no ifVersion. */
export function cascadeCtx(ctx: Ctx): Ctx {
  const { key: _key, ifVersion: _ifVersion, ...rest } = ctx;
  return rest;
}

type Bookkept = { id: string; version: number; updatedAt: string };

/** `updated` with a bump when anything outside version/updatedAt differs, else `unchanged`. */
function updatedOrUnchanged<T extends Bookkept>(before: T, next: T, now: string): Mutation<T> {
  return Object.keys(diff(before, next)).length ? okMutation("updated", before, bump(next, now)) : okMutation("unchanged", before, before);
}

type Lookup<T> = { ok: true; record: T } | { ok: false; issues: string[]; id?: string };
const failed = <T>(lookup: { issues: string[]; id?: string }): Mutation<T> =>
  fail<T>(lookup.issues, lookup.id !== undefined ? { id: lookup.id } : {});

/** A cascaded write was rejected: abort the transaction and surface the issues as the primary receipt. */
class CascadeRejected extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
  }
}

function must<T>(receipt: Receipt<T>, what: string): T {
  if (!receipt.ok) throw new CascadeRejected(receipt.issues.map((issue) => `${what}: ${issue}`));
  return receipt.record;
}

async function guarded<T>(run: () => Promise<Receipt<T>>): Promise<Receipt<T>> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CascadeRejected) return rejected(error.issues);
    throw error;
  }
}

// ------------------------------------------------------------------ projects: pure helpers

export function indexProjects(projects: Project[]): Map<string, Project> {
  return new Map(projects.map((project) => [project.id, project]));
}

function lookup(index: ProjectIndex, id: string): Project | undefined {
  return index instanceof Map ? (index as ReadonlyMap<string, Project>).get(id) : (index as Readonly<Record<string, Project>>)[id];
}

/** The project and its ancestors, root first. Stops at a missing parent or a cycle. */
export function projectAncestry(project: Project, projectsById: ProjectIndex): Project[] {
  const chain = [project];
  const seen = new Set([project.id]);
  let parentId = project.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = lookup(projectsById, parentId);
    if (!parent) break;
    seen.add(parent.id);
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** The slug path from the root, like `health/dental`. */
export function projectPath(project: Project, projectsById: ProjectIndex): string {
  return projectAncestry(project, projectsById)
    .map((p) => p.slug)
    .join("/");
}

/** Every project under `id` (not `id` itself), depth first, siblings by order. Works on whatever list is given. */
export function projectDescendants(id: string, projects: Project[]): Project[] {
  const out: Project[] = [];
  const seen = new Set([id]);
  const visit = (parentId: string) => {
    for (const child of projects.filter((p) => p.parentId === parentId).sort(byOrder)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      visit(child.id);
    }
  };
  visit(id);
  return out;
}

/** The task's labels plus those of its project and every ancestor project, deduplicated. */
export function effectiveLabels(task: Task, projectsById: ProjectIndex): string[] {
  const own = lookup(projectsById, task.projectId);
  const chain = own ? projectAncestry(own, projectsById) : [];
  return unique([...task.labels, ...chain.flatMap((p) => p.labels)]);
}

/** What the filter evaluator needs to know about one task. */
export function filterSubject(task: Task, projectsById: ProjectIndex): FilterSubject {
  const own = lookup(projectsById, task.projectId);
  const chain = own ? projectAncestry(own, projectsById) : [];
  const projectPaths = chain.map((_, i) =>
    chain
      .slice(0, i + 1)
      .map((p) => p.slug)
      .join("/"),
  );
  return {
    status: task.status,
    dueDate: task.due?.date ?? null,
    deadline: task.deadline,
    priority: task.priority ?? null,
    executor: task.executor,
    hasParent: task.parentId !== undefined,
    recurring: Boolean(task.repeat),
    labels: effectiveLabels(task, projectsById),
    projectPaths,
    projectPath: projectPaths[projectPaths.length - 1] ?? "",
    projectIds: chain.map((p) => p.id),
    searchable: [task.title, task.notes, ...task.comments.map((c) => c.text)].join("\n").toLowerCase(),
  };
}

/** Due date, due time, priority, order, createdAt; anything missing sorts last. */
export function sortTasks(tasks: Task[]): Task[] {
  const cmp = (a: string | undefined, b: string | undefined): number => {
    if (a === b) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a < b ? -1 : 1;
  };
  return [...tasks].sort(
    (a, b) =>
      cmp(a.due?.date, b.due?.date) ||
      cmp(a.due?.time, b.due?.time) ||
      (a.priority ?? 5) - (b.priority ?? 5) ||
      a.order - b.order ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

// ------------------------------------------------------------------ resolution

export async function findInbox(tx: Tx): Promise<Project | null> {
  return (await tx.all("project")).find((p) => p.system) ?? null;
}

/**
 * A project by id, by slug path from the roots (`health/dental`), or `inbox`.
 * Slug paths only match non-deleted projects; an id matches a deleted one only
 * with `includeDeleted`.
 */
export async function resolveProject(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Project | null> {
  const value = ref.trim();
  if (!value) return null;
  if (value.toLowerCase() === "inbox") return findInbox(tx);
  if (projectIdSchema.safeParse(value).success) {
    const project = await tx.get("project", value);
    return project && (opts.includeDeleted || !project.deletedAt) ? project : null;
  }
  const segments = value
    .split("/")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!segments.length) return null;
  const projects = await tx.all("project");
  let parentId: string | null = null;
  let current: Project | null = null;
  for (const segment of segments) {
    current = projects.find((p) => p.parentId === parentId && p.slug === segment) ?? null;
    if (!current) return null;
    parentId = current.id;
  }
  return current;
}

/** A section of `projectId` by id or by name (exact, then case-insensitive). Names only match non-deleted sections. */
export async function resolveSection(tx: Tx, projectId: string, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Section | null> {
  const value = ref.trim();
  if (!value) return null;
  if (sectionIdSchema.safeParse(value).success) {
    const section = await tx.get("section", value);
    if (!section || section.projectId !== projectId) return null;
    return opts.includeDeleted || !section.deletedAt ? section : null;
  }
  const sections = (await tx.all("section")).filter((s) => s.projectId === projectId);
  const lowered = value.toLowerCase();
  return sections.find((s) => s.name === value) ?? sections.find((s) => s.name.toLowerCase() === lowered) ?? null;
}

async function findLabel(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Label | null> {
  const value = ref.trim();
  if (!value) return null;
  if (labelIdSchema.safeParse(value).success) {
    const label = await tx.get("label", value);
    return label && (opts.includeDeleted || !label.deletedAt) ? label : null;
  }
  const name = value.toLowerCase();
  return (await tx.all("label")).find((l) => l.name === name) ?? null;
}

async function findFilter(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Filter | null> {
  const value = ref.trim();
  if (!value) return null;
  if (filterIdSchema.safeParse(value).success) {
    const filter = await tx.get("filter", value);
    return filter && (opts.includeDeleted || !filter.deletedAt) ? filter : null;
  }
  const filters = await tx.all("filter");
  const lowered = value.toLowerCase();
  return filters.find((f) => f.name === value) ?? filters.find((f) => f.name.toLowerCase() === lowered) ?? null;
}

/** A non-deleted project by ref, or the issue that explains why not. `field` prefixes the issue. */
async function liveProject(tx: Tx, ref: string, field = "project"): Promise<Lookup<Project>> {
  const project = await resolveProject(tx, ref, { includeDeleted: true });
  if (!project) return { ok: false, issues: [`${field}: no project "${ref}"`] };
  if (project.deletedAt) return { ok: false, issues: [`${field}: project "${ref}" is deleted; restore it first`], id: project.id };
  return { ok: true, record: project };
}

async function liveSection(tx: Tx, id: string): Promise<Lookup<Section>> {
  const section = sectionIdSchema.safeParse(id).success ? await tx.get("section", id) : null;
  if (!section) return { ok: false, issues: [`section: no section "${id}"`] };
  if (section.deletedAt) return { ok: false, issues: [`section: section "${id}" is deleted; restore it first`], id: section.id };
  return { ok: true, record: section };
}

async function liveLabel(tx: Tx, ref: string): Promise<Lookup<Label>> {
  const label = await findLabel(tx, ref, { includeDeleted: true });
  if (!label) return { ok: false, issues: [`label: no label "${ref}"`] };
  if (label.deletedAt) return { ok: false, issues: [`label: label "${ref}" is deleted; restore it first`], id: label.id };
  return { ok: true, record: label };
}

async function liveFilter(tx: Tx, ref: string): Promise<Lookup<Filter>> {
  const filter = await findFilter(tx, ref, { includeDeleted: true });
  if (!filter) return { ok: false, issues: [`filter: no filter "${ref}"`] };
  if (filter.deletedAt) return { ok: false, issues: [`filter: filter "${ref}" is deleted; restore it first`], id: filter.id };
  return { ok: true, record: filter };
}

// ------------------------------------------------------------------ the Inbox and labels on demand

/** The Inbox, created on first use: name `Inbox`, slug `inbox`, system, actor neel. */
export async function ensureInbox(tx: Tx, clock: Clock): Promise<Project> {
  const existing = await findInbox(tx);
  if (existing) return existing;
  const receipt = await applyIn(tx, clock, "project", "project.add", { actor: "neel" }, async (_tx, ctx, now) =>
    okMutation("created", null, {
      id: newId("project"),
      name: "Inbox",
      slug: "inbox",
      parentId: null,
      layout: "list",
      order: 0,
      labels: [],
      archived: false,
      system: true,
      origin: originOf(ctx, now),
      external: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );
  if (!receipt.ok) throw new Error(`Could not create the Inbox: ${receipt.issues.join("; ")}`);
  return receipt.record;
}

async function addLabelWork(tx: Tx, input: LabelAdd, ctx: Ctx, now: string): Promise<Mutation<Label>> {
  const labels = await tx.all("label");
  if (labels.some((l) => l.name === input.name)) return fail([`name: label "${input.name}" already exists`]);
  return okMutation("created", null, {
    id: newId("label"),
    name: input.name,
    ...(input.color !== undefined ? { color: input.color } : {}),
    order: nextOrder(labels),
    origin: originOf(ctx, now),
    external: input.external ?? [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

/** Register every named label that is not already a non-deleted label, with the same actor, reason, and evidence (no key). */
export async function ensureLabels(tx: Tx, clock: Clock, ctx: Ctx, names: string[]): Promise<{ created: Label[]; issues: string[] }> {
  const existing = new Set((await tx.all("label")).map((l) => l.name));
  const created: Label[] = [];
  const issues: string[] = [];
  for (const name of unique(names)) {
    if (existing.has(name)) continue;
    const receipt = await applyIn(tx, clock, "label", "label.add", cascadeCtx(ctx), (t, c, now) => addLabelWork(t, { name }, c, now));
    if (receipt.ok) {
      created.push(receipt.record);
      existing.add(name);
    } else issues.push(...receipt.issues.map((issue) => `labels: ${name}: ${issue}`));
  }
  return { created, issues };
}

// ------------------------------------------------------------------ shared write patterns

type Work<K extends Kind> = (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>;
type Ordered = { id: string; order: number; version: number; updatedAt: string; deletedAt: string | null };

/** Hands out the next `order` per task scope (project, section, parent), counting up as tasks land in it. */
function orderAllocator(tasks: Task[]) {
  const counters = new Map<string, number>();
  return (projectId: string, sectionId: string | undefined, parentId: string | undefined): number => {
    const key = `${projectId}|${sectionId ?? ""}|${parentId ?? ""}`;
    const next =
      counters.get(key) ??
      nextOrder(tasks.filter((t) => t.projectId === projectId && (t.sectionId ?? "") === (sectionId ?? "") && (t.parentId ?? "") === (parentId ?? "")));
    counters.set(key, next + 1);
    return next;
  };
}

/** Restore-time name or slug: the original, or the first `-2`, `-3`, ... that no live sibling uses. */
function freeName(wanted: string, taken: (candidate: string) => boolean, join: string): string {
  if (!taken(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}${join}${n}`;
    if (!taken(candidate)) return candidate;
  }
}

// ------------------------------------------------------------------ the factory

export function createOrganize(store: Store, clock: Clock): Organize {
  const write = <K extends Kind>(kind: K, op: string, ctx: Ctx, work: Work<K>): Promise<Receipt<RecordOf<K>>> =>
    guarded(() => mutate(store, clock, kind, op, ctx, work));

  /** Assign order 0..n-1 to `ids` in one transaction; every id must be live and share one scope. */
  async function reorderRecords<R extends Ordered>(
    ids: string[],
    ctx: Ctx,
    io: {
      noun: string;
      get(tx: Tx, id: string): Promise<R | null>;
      apply(tx: Tx, ctx: Ctx, work: (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<R>>): Promise<Receipt<R>>;
      scopeOf(record: R): string;
      scopeName: string;
    },
  ): Promise<Receipt<R>[]> {
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) return ids.map(() => rejected(issuesOf(parsed.error)));
    const context = parsed.data;
    if (context.ifVersion !== undefined) return ids.map(() => rejected(["ifVersion: not supported by reorder"]));
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length) return ids.map(() => rejected(["ids: contains duplicates"]));
    return store.transaction(async (tx) => {
      const records: R[] = [];
      const issues: string[] = [];
      for (const id of ids) {
        const record = await io.get(tx, id);
        if (!record) issues.push(`${id}: no ${io.noun}`);
        else if (record.deletedAt) issues.push(`${id}: ${io.noun} is deleted`);
        else records.push(record);
      }
      if (!issues.length && new Set(records.map(io.scopeOf)).size > 1) issues.push(`ids: every ${io.noun} must share the same ${io.scopeName}`);
      if (issues.length) return ids.map(() => rejected(issues));
      const receipts: Receipt<R>[] = [];
      for (const [index, record] of records.entries()) {
        receipts.push(
          await io.apply(tx, itemCtx(context, index), async (_tx, _ctx, now) =>
            record.order === index ? okMutation("unchanged", record, record) : okMutation("updated", record, bump({ ...record, order: index }, now)),
          ),
        );
      }
      return receipts;
    });
  }

  /** The Inbox from a read, creating it in a write transaction when it does not exist yet. */
  async function inbox(): Promise<Project> {
    const existing = await store.read((tx) => findInbox(tx));
    return existing ?? store.transaction((tx) => ensureInbox(tx, clock));
  }

  // ---------------------------------------------------------------- projects

  async function projectAdd(tx: Tx, input: ProjectAdd, ctx: Ctx, now: string): Promise<Mutation<Project>> {
    let parentId: string | null = null;
    if (input.parent !== undefined && input.parent !== null) {
      const parent = await liveProject(tx, input.parent, "parent");
      if (!parent.ok) return failed(parent);
      if (parent.record.system) return fail(["parent: the Inbox cannot have sub-projects"]);
      parentId = parent.record.id;
    }
    const slug = input.slug ?? slugify(input.name);
    if (!slug) return fail([`slug: cannot derive a slug from "${input.name}"; pass one`]);
    if (looksLikeId(slug)) return fail([`slug: "${slug}" looks like an id`]);
    // The Inbox is created on first use, once the refs and the slug have passed. It is a root sibling, so it
    // must exist before the slug and order checks below; a clash after this point rolls it back (core.ts).
    await ensureInbox(tx, clock);
    const siblings = (await tx.all("project")).filter((p) => p.parentId === parentId);
    if (siblings.some((p) => p.slug === slug)) return fail([`slug: "${slug}" is already used by a sibling project`]);
    const labels = unique(input.labels ?? []);
    const ensured = await ensureLabels(tx, clock, ctx, labels);
    if (ensured.issues.length) return fail(ensured.issues);
    return okMutation("created", null, {
      id: newId("project"),
      name: input.name,
      slug,
      parentId,
      ...(input.color !== undefined ? { color: input.color } : {}),
      layout: input.layout ?? "list",
      order: nextOrder(siblings),
      labels,
      archived: false,
      system: false,
      origin: originOf(ctx, now),
      external: input.external ?? [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function projectUpdate(tx: Tx, ref: string, input: ProjectUpdate, ctx: Ctx, now: string): Promise<Mutation<Project>> {
    const found = await liveProject(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Project = { ...before };
    if (input.name !== undefined) {
      if (before.system && input.name !== before.name) return fail(["name: the Inbox cannot be renamed"], { id: before.id });
      next.name = input.name;
    }
    if (input.slug !== undefined && input.slug !== before.slug) {
      if (before.system) return fail(["slug: the Inbox keeps its slug"], { id: before.id });
      if (looksLikeId(input.slug)) return fail([`slug: "${input.slug}" looks like an id`], { id: before.id });
      const siblings = (await tx.all("project")).filter((p) => p.parentId === before.parentId && p.id !== before.id);
      if (siblings.some((p) => p.slug === input.slug)) return fail([`slug: "${input.slug}" is already used by a sibling project`], { id: before.id });
      next.slug = input.slug;
    }
    if (input.color !== undefined) {
      if (input.color === null) delete next.color;
      else next.color = input.color;
    }
    if (input.layout !== undefined) next.layout = input.layout;
    if (input.labels !== undefined) {
      const labels = unique(input.labels);
      const ensured = await ensureLabels(tx, clock, ctx, labels);
      if (ensured.issues.length) return fail(ensured.issues, { id: before.id });
      next.labels = labels;
    }
    return updatedOrUnchanged(before, next, now);
  }

  async function projectMove(tx: Tx, ref: string, parent: string | null, ctx: Ctx, now: string): Promise<Mutation<Project>> {
    const found = await liveProject(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (before.system) return fail(["The Inbox cannot be moved"], { id: before.id });
    const projects = await tx.all("project");
    let parentId: string | null = null;
    if (parent !== null) {
      const target = await liveProject(tx, parent, "parent");
      if (!target.ok) return failed(target);
      if (target.record.system) return fail(["parent: the Inbox cannot have sub-projects"], { id: before.id });
      if (target.record.id === before.id) return fail(["parent: a project cannot be its own parent"], { id: before.id });
      if (projectDescendants(before.id, projects).some((d) => d.id === target.record.id)) {
        return fail(["parent: a project cannot move under its own sub-project"], { id: before.id });
      }
      parentId = target.record.id;
    }
    if (parentId === before.parentId) return okMutation("unchanged", before, before);
    const siblings = projects.filter((p) => p.parentId === parentId && p.id !== before.id);
    if (siblings.some((p) => p.slug === before.slug)) {
      return fail([`slug: "${before.slug}" is already used by a project under the new parent; change the slug first`], { id: before.id });
    }
    return okMutation("updated", before, bump({ ...before, parentId, order: nextOrder(siblings) }, now));
  }

  async function projectSetArchived(tx: Tx, ref: string, archived: boolean, ctx: Ctx, now: string): Promise<Mutation<Project>> {
    const found = await liveProject(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (before.system) return fail(["The Inbox cannot be archived"], { id: before.id });
    return updatedOrUnchanged(before, { ...before, archived }, now);
  }

  async function projectDelete(tx: Tx, ref: string, ctx: Ctx, now: string, opts: { contents?: ProjectContents }): Promise<Mutation<Project>> {
    const found = await liveProject(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (before.system) return fail(["The Inbox cannot be deleted"], { id: before.id });
    if (opts.contents !== undefined && opts.contents !== "delete" && opts.contents !== "inbox") {
      return fail([`contents: expected "delete" or "inbox", got "${String(opts.contents)}"`], { id: before.id });
    }
    const projects = await tx.all("project");
    const subprojects = projectDescendants(before.id, projects);
    const subtree = new Set([before.id, ...subprojects.map((p) => p.id)]);
    const allTasks = await tx.all("task");
    const tasks = allTasks.filter((t) => subtree.has(t.projectId)).sort(byOrder);
    const sections = (await tx.all("section")).filter((s) => subtree.has(s.projectId));
    if ((tasks.length || subprojects.length) && opts.contents === undefined) {
      const message = `Project "${projectPath(before, indexProjects(projects))}" has ${count(tasks.length, "task")} and ${count(subprojects.length, "sub-project")}; pass contents "delete" to delete them too, or "inbox" to move the tasks to the Inbox`;
      return fail([message], { id: before.id, record: before, needs: { field: "contents", options: ["delete", "inbox"], message } });
    }
    const cascade = cascadeCtx(ctx);
    if (opts.contents === "inbox" && tasks.length) {
      const target = await ensureInbox(tx, clock);
      const allocate = orderAllocator(allTasks);
      for (const task of tasks) {
        const { sectionId: _section, ...rest } = task;
        const order = allocate(target.id, undefined, task.parentId);
        must(
          await applyIn(tx, clock, "task", "project.delete", cascade, async (_tx, _ctx, at) =>
            okMutation("updated", task, bump({ ...rest, projectId: target.id, order }, at)),
          ),
          `task ${task.id}`,
        );
      }
    } else if (opts.contents === "delete") {
      for (const task of tasks) {
        must(
          await applyIn(tx, clock, "task", "project.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", task, bump({ ...task, deletedAt: at }, at))),
          `task ${task.id}`,
        );
      }
    }
    for (const section of sections) {
      must(
        await applyIn(tx, clock, "section", "project.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", section, bump({ ...section, deletedAt: at }, at))),
        `section ${section.id}`,
      );
    }
    for (const sub of subprojects) {
      must(
        await applyIn(tx, clock, "project", "project.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", sub, bump({ ...sub, deletedAt: at }, at))),
        `project ${sub.id}`,
      );
    }
    return okMutation("updated", before, bump({ ...before, deletedAt: now }, now));
  }

  async function projectRestore(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Project>> {
    const before = projectIdSchema.safeParse(id).success ? await tx.get("project", id) : null;
    if (!before) return fail([`project: no project "${id}"`]);
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!before.deletedAt) return okMutation("unchanged", before, before);
    const live = await tx.all("project");
    const parentId = before.parentId !== null && live.some((p) => p.id === before.parentId) ? before.parentId : null;
    const siblings = live.filter((p) => p.parentId === parentId);
    const slug = freeName(before.slug, (candidate) => siblings.some((p) => p.slug === candidate), "-");
    const order = parentId === before.parentId ? before.order : nextOrder(siblings);
    return okMutation("updated", before, bump({ ...before, parentId, slug, order, deletedAt: null }, now));
  }

  const project: ProjectOps = {
    async add(input, ctx) {
      const parsed = projectAddSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("project", "project.add", ctx, (tx, c, now) => projectAdd(tx, parsed.data, c, now));
    },
    async get(ref) {
      if (ref.trim().toLowerCase() === "inbox") return inbox();
      return store.read((tx) => resolveProject(tx, ref, { includeDeleted: true }));
    },
    async tree(opts = {}) {
      await inbox();
      return store.read(async (tx) => {
        const projects = await tx.all("project");
        const sections = await tx.all("section");
        const seen = new Set<string>();
        const build = (parentId: string | null): ProjectNode[] =>
          projects
            .filter((p) => p.parentId === parentId && (opts.includeArchived || !p.archived) && !seen.has(p.id))
            .sort((a, b) => Number(b.system) - Number(a.system) || byOrder(a, b))
            .map((p) => {
              seen.add(p.id);
              return {
                project: p,
                sections: sections.filter((s) => s.projectId === p.id && (opts.includeArchived || !s.archived)).sort(byOrder),
                children: build(p.id),
              };
            });
        return build(null);
      });
    },
    async update(ref, input, ctx) {
      const parsed = projectUpdateSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("project", "project.update", ctx, (tx, c, now) => projectUpdate(tx, ref, parsed.data, c, now));
    },
    move: (ref, parent, ctx) => write("project", "project.move", ctx, (tx, c, now) => projectMove(tx, ref, parent, c, now)),
    reorder: (ids, ctx) =>
      reorderRecords<Project>(ids, ctx, {
        noun: "project",
        get: (tx, id) => tx.get("project", id),
        apply: (tx, c, work) => applyIn(tx, clock, "project", "project.reorder", c, work),
        scopeOf: (p) => p.parentId ?? "",
        scopeName: "parent",
      }),
    archive: (ref, ctx) => write("project", "project.archive", ctx, (tx, c, now) => projectSetArchived(tx, ref, true, c, now)),
    unarchive: (ref, ctx) => write("project", "project.unarchive", ctx, (tx, c, now) => projectSetArchived(tx, ref, false, c, now)),
    delete: (ref, ctx, opts = {}) => write("project", "project.delete", ctx, (tx, c, now) => projectDelete(tx, ref, c, now, opts)),
    restore: (id, ctx) => write("project", "project.restore", ctx, (tx, c, now) => projectRestore(tx, id, c, now)),
    history: (id) => store.read((tx) => tx.history("project", id)),
  };

  // ---------------------------------------------------------------- sections

  const sectionNameTaken = (sections: Section[], name: string, exceptId?: string): boolean =>
    sections.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());

  async function sectionAdd(tx: Tx, input: SectionAdd, ctx: Ctx, now: string): Promise<Mutation<Section>> {
    const found = await liveProject(tx, input.project);
    if (!found.ok) return failed(found);
    const sections = (await tx.all("section")).filter((s) => s.projectId === found.record.id);
    if (sectionNameTaken(sections, input.name)) return fail([`name: section "${input.name}" already exists in that project`]);
    return okMutation("created", null, {
      id: newId("section"),
      projectId: found.record.id,
      name: input.name,
      order: nextOrder(sections),
      archived: false,
      origin: originOf(ctx, now),
      external: input.external ?? [],
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function sectionUpdate(tx: Tx, id: string, input: SectionUpdate, ctx: Ctx, now: string): Promise<Mutation<Section>> {
    const found = await liveSection(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Section = { ...before };
    if (input.name !== undefined && input.name !== before.name) {
      const sections = (await tx.all("section")).filter((s) => s.projectId === before.projectId);
      if (sectionNameTaken(sections, input.name, before.id)) return fail([`name: section "${input.name}" already exists in that project`], { id: before.id });
      next.name = input.name;
    }
    return updatedOrUnchanged(before, next, now);
  }

  async function sectionSetArchived(tx: Tx, id: string, archived: boolean, ctx: Ctx, now: string): Promise<Mutation<Section>> {
    const found = await liveSection(tx, id);
    if (!found.ok) return failed(found);
    const mismatch = checkVersion(found.record, ctx);
    if (mismatch) return mismatch;
    return updatedOrUnchanged(found.record, { ...found.record, archived }, now);
  }

  async function sectionDelete(tx: Tx, id: string, ctx: Ctx, now: string, opts: { tasks?: SectionTasks }): Promise<Mutation<Section>> {
    const found = await liveSection(tx, id);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (opts.tasks !== undefined && opts.tasks !== "delete" && opts.tasks !== "unsection") {
      return fail([`tasks: expected "delete" or "unsection", got "${String(opts.tasks)}"`], { id: before.id });
    }
    const allTasks = await tx.all("task");
    const tasks = allTasks.filter((t) => t.sectionId === before.id).sort(byOrder);
    if (tasks.length && opts.tasks === undefined) {
      const message = `Section "${before.name}" has ${count(tasks.length, "task")}; pass tasks "delete" to delete them too, or "unsection" to keep them in the project without a section`;
      return fail([message], { id: before.id, record: before, needs: { field: "tasks", options: ["delete", "unsection"], message } });
    }
    const cascade = cascadeCtx(ctx);
    const allocate = orderAllocator(allTasks);
    for (const task of tasks) {
      const next =
        opts.tasks === "delete"
          ? (at: string) => bump({ ...task, deletedAt: at }, at)
          : (at: string) => {
              const { sectionId: _section, ...rest } = task;
              return bump({ ...rest, order: allocate(task.projectId, undefined, task.parentId) }, at);
            };
      must(
        await applyIn(tx, clock, "task", "section.delete", cascade, async (_tx, _ctx, at) => okMutation("updated", task, next(at))),
        `task ${task.id}`,
      );
    }
    return okMutation("updated", before, bump({ ...before, deletedAt: now }, now));
  }

  async function sectionRestore(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Section>> {
    const before = sectionIdSchema.safeParse(id).success ? await tx.get("section", id) : null;
    if (!before) return fail([`section: no section "${id}"`]);
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!before.deletedAt) return okMutation("unchanged", before, before);
    const owner = await tx.get("project", before.projectId);
    if (!owner || owner.deletedAt) return fail([`project: project "${before.projectId}" is deleted; restore it first`], { id: before.id });
    const sections = (await tx.all("section")).filter((s) => s.projectId === before.projectId);
    const name = freeName(before.name, (candidate) => sectionNameTaken(sections, candidate), " ");
    return okMutation("updated", before, bump({ ...before, name, deletedAt: null }, now));
  }

  const section: SectionOps = {
    async add(input, ctx) {
      const parsed = sectionAddSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("section", "section.add", ctx, (tx, c, now) => sectionAdd(tx, parsed.data, c, now));
    },
    get: (id) => store.read((tx) => (sectionIdSchema.safeParse(id).success ? tx.get("section", id) : Promise.resolve(null))),
    list: (projectRef) =>
      store.read(async (tx) => {
        const found = await liveProject(tx, projectRef);
        if (!found.ok) throw new Error(found.issues.join("; "));
        return (await tx.all("section")).filter((s) => s.projectId === found.record.id).sort(byOrder);
      }),
    async update(id, input, ctx) {
      const parsed = sectionUpdateSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("section", "section.update", ctx, (tx, c, now) => sectionUpdate(tx, id, parsed.data, c, now));
    },
    reorder: (ids, ctx) =>
      reorderRecords<Section>(ids, ctx, {
        noun: "section",
        get: (tx, id) => tx.get("section", id),
        apply: (tx, c, work) => applyIn(tx, clock, "section", "section.reorder", c, work),
        scopeOf: (s) => s.projectId,
        scopeName: "project",
      }),
    archive: (id, ctx) => write("section", "section.archive", ctx, (tx, c, now) => sectionSetArchived(tx, id, true, c, now)),
    unarchive: (id, ctx) => write("section", "section.unarchive", ctx, (tx, c, now) => sectionSetArchived(tx, id, false, c, now)),
    delete: (id, ctx, opts = {}) => write("section", "section.delete", ctx, (tx, c, now) => sectionDelete(tx, id, c, now, opts)),
    restore: (id, ctx) => write("section", "section.restore", ctx, (tx, c, now) => sectionRestore(tx, id, c, now)),
  };

  // ---------------------------------------------------------------- labels

  async function labelUpdate(tx: Tx, ref: string, input: LabelUpdate, ctx: Ctx, now: string): Promise<Mutation<Label>> {
    const found = await liveLabel(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Label = { ...before };
    if (input.color !== undefined) {
      if (input.color === null) delete next.color;
      else next.color = input.color;
    }
    if (input.name !== undefined && input.name !== before.name) {
      const labels = await tx.all("label");
      if (labels.some((l) => l.name === input.name)) return fail([`name: label "${input.name}" already exists`], { id: before.id });
      const newName = input.name;
      next.name = newName;
      // Every task and project carrying the old name, deleted ones included so a restore does not resurrect it.
      const cascade = cascadeCtx(ctx);
      const rename = (names: string[]) => unique(names.map((n) => (n === before.name ? newName : n)));
      for (const task of (await tx.all("task", { includeDeleted: true })).filter((t) => t.labels.includes(before.name))) {
        must(
          await applyIn(tx, clock, "task", "label.update", cascade, async (_tx, _ctx, at) => okMutation("updated", task, bump({ ...task, labels: rename(task.labels) }, at))),
          `task ${task.id}`,
        );
      }
      for (const p of (await tx.all("project", { includeDeleted: true })).filter((p) => p.labels.includes(before.name))) {
        must(
          await applyIn(tx, clock, "project", "label.update", cascade, async (_tx, _ctx, at) => okMutation("updated", p, bump({ ...p, labels: rename(p.labels) }, at))),
          `project ${p.id}`,
        );
      }
    }
    return updatedOrUnchanged(before, next, now);
  }

  async function labelDelete(tx: Tx, ref: string, ctx: Ctx, now: string): Promise<Mutation<Label>> {
    const found = await liveLabel(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const tasks = (await tx.all("task")).filter((t) => t.labels.includes(before.name)).length;
    const projects = (await tx.all("project")).filter((p) => p.labels.includes(before.name)).length;
    if (tasks || projects) {
      return fail([`label "${before.name}" is used by ${count(tasks, "task")} and ${count(projects, "project")}; remove it from them first`], { id: before.id, record: before });
    }
    return okMutation("updated", before, bump({ ...before, deletedAt: now }, now));
  }

  async function labelRestore(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Label>> {
    const before = labelIdSchema.safeParse(id).success ? await tx.get("label", id) : null;
    if (!before) return fail([`label: no label "${id}"`]);
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!before.deletedAt) return okMutation("unchanged", before, before);
    if ((await tx.all("label")).some((l) => l.name === before.name)) {
      return fail([`name: label "${before.name}" already exists; rename or delete that one first`], { id: before.id });
    }
    return okMutation("updated", before, bump({ ...before, deletedAt: null }, now));
  }

  const label: LabelOps = {
    async add(input, ctx) {
      const parsed = labelAddSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("label", "label.add", ctx, (tx, c, now) => addLabelWork(tx, parsed.data, c, now));
    },
    get: (ref) => store.read((tx) => findLabel(tx, ref, { includeDeleted: true })),
    list: () => store.read(async (tx) => (await tx.all("label")).sort(byOrder)),
    async update(ref, input, ctx) {
      const parsed = labelUpdateSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("label", "label.update", ctx, (tx, c, now) => labelUpdate(tx, ref, parsed.data, c, now));
    },
    reorder: (ids, ctx) =>
      reorderRecords<Label>(ids, ctx, {
        noun: "label",
        get: (tx, id) => tx.get("label", id),
        apply: (tx, c, work) => applyIn(tx, clock, "label", "label.reorder", c, work),
        scopeOf: () => "",
        scopeName: "scope",
      }),
    delete: (ref, ctx) => write("label", "label.delete", ctx, (tx, c, now) => labelDelete(tx, ref, c, now)),
    restore: (id, ctx) => write("label", "label.restore", ctx, (tx, c, now) => labelRestore(tx, id, c, now)),
  };

  // ---------------------------------------------------------------- filters

  const filterNameTaken = (filters: Filter[], name: string, exceptId?: string): boolean =>
    filters.some((f) => f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase());

  async function filterAdd(tx: Tx, input: FilterAdd, ctx: Ctx, now: string): Promise<Mutation<Filter>> {
    const filters = await tx.all("filter");
    if (filterNameTaken(filters, input.name)) return fail([`name: filter "${input.name}" already exists`]);
    return okMutation("created", null, {
      id: newId("filter"),
      name: input.name,
      query: input.query,
      order: nextOrder(filters),
      origin: originOf(ctx, now),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function filterUpdate(tx: Tx, ref: string, input: FilterUpdate, ctx: Ctx, now: string): Promise<Mutation<Filter>> {
    const found = await liveFilter(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Filter = { ...before };
    if (input.name !== undefined && input.name !== before.name) {
      if (filterNameTaken(await tx.all("filter"), input.name, before.id)) return fail([`name: filter "${input.name}" already exists`], { id: before.id });
      next.name = input.name;
    }
    if (input.query !== undefined) next.query = input.query;
    return updatedOrUnchanged(before, next, now);
  }

  async function filterDelete(tx: Tx, ref: string, ctx: Ctx, now: string): Promise<Mutation<Filter>> {
    const found = await liveFilter(tx, ref);
    if (!found.ok) return failed(found);
    const mismatch = checkVersion(found.record, ctx);
    if (mismatch) return mismatch;
    return okMutation("updated", found.record, bump({ ...found.record, deletedAt: now }, now));
  }

  async function filterRestore(tx: Tx, id: string, ctx: Ctx, now: string): Promise<Mutation<Filter>> {
    const before = filterIdSchema.safeParse(id).success ? await tx.get("filter", id) : null;
    if (!before) return fail([`filter: no filter "${id}"`]);
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    if (!before.deletedAt) return okMutation("unchanged", before, before);
    const filters = await tx.all("filter");
    const name = freeName(before.name, (candidate) => filterNameTaken(filters, candidate), " ");
    return okMutation("updated", before, bump({ ...before, name, deletedAt: null }, now));
  }

  const filter: FilterOps = {
    async add(input, ctx) {
      const parsed = filterAddSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("filter", "filter.add", ctx, (tx, c, now) => filterAdd(tx, parsed.data, c, now));
    },
    get: (ref) => store.read((tx) => findFilter(tx, ref, { includeDeleted: true })),
    list: () => store.read(async (tx) => (await tx.all("filter")).sort(byOrder)),
    async update(ref, input, ctx) {
      const parsed = filterUpdateSchema.safeParse(input);
      if (!parsed.success) return rejected(issuesOf(parsed.error));
      return write("filter", "filter.update", ctx, (tx, c, now) => filterUpdate(tx, ref, parsed.data, c, now));
    },
    reorder: (ids, ctx) =>
      reorderRecords<Filter>(ids, ctx, {
        noun: "filter",
        get: (tx, id) => tx.get("filter", id),
        apply: (tx, c, work) => applyIn(tx, clock, "filter", "filter.reorder", c, work),
        scopeOf: () => "",
        scopeName: "scope",
      }),
    delete: (ref, ctx) => write("filter", "filter.delete", ctx, (tx, c, now) => filterDelete(tx, ref, c, now)),
    restore: (id, ctx) => write("filter", "filter.restore", ctx, (tx, c, now) => filterRestore(tx, id, c, now)),
    run: (refOrQuery) =>
      store.read(async (tx) => {
        const saved = await findFilter(tx, refOrQuery);
        const query = saved ? saved.query : refOrQuery;
        const parsed = parseFilter(query);
        if (!parsed.ok) throw new Error(`"${refOrQuery}" is neither a saved filter nor a valid query: ${parsed.error}`);
        const index = indexProjects(await tx.all("project", { includeDeleted: true }));
        const today = todayIn(clock.timezone, clock.now());
        const openOnly = !mentionsStatus(parsed.ast);
        const open = new Set<string>(OPEN_STATUSES);
        const tasks = (await tx.all("task")).filter((t) => (!openOnly || open.has(t.status)) && matches(parsed.ast, filterSubject(t, index), today));
        return sortTasks(tasks);
      }),
  };

  return { project, section, label, filter };
}
