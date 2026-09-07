# @life-os/tools

The todo list core of Life-OS (the calendar joins later), plus the `life` CLI. The product spec is `docs/vision/HANDS.md` at the repository root; read it first. This file is the implementation brief: conventions, module map, and the fixed interfaces that let the modules be built independently.

## Conventions

- **Runtime.** Node 26 runs TypeScript directly, so there is no build step. Write erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties. Relative imports carry the `.ts` extension. `verbatimModuleSyntax` is on: use `import type` for types. `tsconfig.json` enforces all of this; `npx tsc --noEmit` must pass.
- **Tests.** `node:test` in `src/**/*.test.ts`. Run `node --test "src/**/*.test.ts"` from this directory (or `bun run test`). Tests that touch the database use `createTestDb()` from `src/db/testing.ts`, which creates a throwaway Postgres schema, migrates it, and drops it afterwards. Tests never touch the `public` schema. Inject a fixed clock; never depend on wall-clock time.
- **Environment.** `LIFE_DATABASE_URL` is the only setting. It lives in the repository root `.env` (git-ignored). `src/db/client.ts` reads `process.env.LIFE_DATABASE_URL` and, if unset, loads the root `.env` with `process.loadEnvFile`, resolving the root from `import.meta.url`. `LIFE_TZ` optionally sets the timezone; otherwise the machine's.
- **Database.** Postgres through the `pg` Pool and Drizzle ORM (`drizzle-orm/node-postgres`). The schema is declared in `src/db/schema.ts`; migration SQL in `drizzle/` is generated with `npx drizzle-kit generate` and applied by `migrate()` in `src/db/migrate.ts`, which accepts a schema name so tests can migrate a throwaway schema (Drizzle's `migrate` supports `migrationsSchema`). Tables are unqualified, so `search_path` decides where they live.
- **Storage shape.** One table per record kind (`tasks`, `projects`, `sections`, `labels`, `filters`), each `id text primary key, version integer, json jsonb, updated_at timestamptz, deleted_at timestamptz null`, plus `log` (`seq bigserial`, `at`, `actor`, `op`, `record_kind`, `record_id`, `patch jsonb`, `reason`, `evidence jsonb`, `key`) and `receipts` (`key text primary key`, `receipt jsonb`, `at`). Add expression indexes where a query needs them (tasks: `(json->>'status')`, `(json->>'projectId')`, `(json->'due'->>'date')`). Filtering happens in SQL for `deleted_at` and obvious columns, in JS otherwise. Single user; thousands of rows, not millions.
- **Writers are serialized.** Every write transaction starts with `select pg_advisory_xact_lock(4242)` so a CLI call and the app never interleave read-modify-write on the same rows. Reads do not take the lock.
- **Everything is async.** Every operation returns a Promise.
- **Every mutation goes through `core.ts`.** No module writes a record or a log entry on its own.
- **Time.** Dates are `YYYY-MM-DD` strings. Instants are ISO UTC strings. Helpers live in `src/time.ts`; do not add a date library.
- **Ids.** `newId(kind)` in `core.ts`: prefix from `ID_PREFIXES` plus ten random `[a-z0-9]` characters. Never derived from a provider.
- **No `any`.** Prefer narrow types from `contract.ts`.

## Module map and ownership

Done: `src/contract.ts` (schemas, inputs, receipt and log types), `src/filter.ts` (filter grammar and evaluator), `src/recurrence.ts` (RRULE subset), `src/time.ts` (dates, timezones), with tests.

| Module | Owns | Depends on |
|---|---|---|
| `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/testing.ts`, `drizzle/`, `drizzle.config.ts` | Drizzle schema, pool and env loading, migrations, test schema helper | contract types |
| `src/store.ts` | `Store` and `Tx` interfaces and `PgStore` | db |
| `src/core.ts` | `mutate`, `applyIn`, `newId`, `diff`, `bump`, receipts, `Clock` | store, contract |
| `src/organize.ts` | project, section, label, filter operations; project and section reference resolution; effective labels | core |
| `src/tasks.ts` | task operations, batch, import | core, organize (for reference resolution and Inbox) |
| `src/views.ts` | today, upcoming, label, filter, search, trash | tasks, organize, filter |
| `src/tools.ts` | the `Tools` facade and `Tools.open()` | all of the above |
| `src/cli.ts`, `bin/life.js` | the `life` CLI | tools |
| `../../skills/todo/SKILL.md` | guidance for Codex and agents | the CLI |

Each module has a matching `*.test.ts`.

## Fixed interfaces

### Store

```ts
export type Kind = "task" | "project" | "section" | "label" | "filter";
export type RecordOf<K extends Kind> = K extends "task" ? Task : K extends "project" ? Project : K extends "section" ? Section : K extends "label" ? Label : Filter;

export interface Tx {
  get<K extends Kind>(kind: K, id: string): Promise<RecordOf<K> | null>;              // deleted records included
  all<K extends Kind>(kind: K, opts?: { includeDeleted?: boolean }): Promise<RecordOf<K>[]>; // default excludes deleted
  put<K extends Kind>(kind: K, record: RecordOf<K>): Promise<void>;                   // upsert by id
  appendLog(entry: Omit<LogEntry, "seq">): Promise<number>;
  history(kind: Kind, id: string): Promise<LogEntry[]>;
  allLog(): Promise<LogEntry[]>;
  getReceipt(key: string): Promise<unknown | null>;
  putReceipt(key: string, receipt: unknown, at: string): Promise<void>;
}
export interface Store {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>; // BEGIN, advisory lock, work, COMMIT; ROLLBACK and rethrow on error
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T>;        // one client, no transaction, no lock
  close(): Promise<void>;
}
```

### Core

```ts
export type Clock = { now(): Date; timezone: string };
export type Mutation<T> = { before: T | null; after: T | null; receipt: Receipt<T> };
export function newId(kind: Kind): string;
export function nowIso(clock: Clock): string;               // "YYYY-MM-DDTHH:MM:SSZ"
export function diff(before: object | null, after: object): Record<string, { from: unknown; to: unknown }>; // ignores version, updatedAt
export function bump<T extends { version: number; updatedAt: string }>(record: T, now: string): T;
export function rejected<T>(issues: string[], extra?: { id?: string; record?: T; needs?: Needs }): Receipt<T>;
export function fail<T>(issues: string[], extra?: { id?: string; record?: T; needs?: Needs }): Mutation<T>;
export function okMutation<T extends { id: string; version: number }>(outcome: "created" | "updated" | "unchanged", before: T | null, after: T): Mutation<T>;
export function checkVersion<T extends { id: string; version: number }>(record: T, ctx: Ctx): Mutation<T> | null;
/** Validate ctx, open a write transaction, run `work`, validate the resulting record against its schema, persist, log, store the receipt under the idempotency key. */
export function mutate<K extends Kind>(store: Store, clock: Clock, kind: K, op: string, ctx: unknown, work: (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>): Promise<Receipt<RecordOf<K>>>;
/** The same inside an already-open transaction, for batch and import. */
export function applyIn<K extends Kind>(tx: Tx, clock: Clock, kind: K, op: string, ctx: Ctx, work: (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>): Promise<Receipt<RecordOf<K>>>;
```

Rules inside `mutate`/`applyIn`: an invalid ctx is `rejected` before anything runs; a known idempotency key returns the stored receipt without running `work`; the record is validated against `taskSchema`/`projectSchema`/... after `work` and rejected if invalid; `unchanged` outcomes persist nothing and log nothing; every other ok outcome upserts the record, appends one log entry `{ at, actor, op, recordKind, recordId, patch: diff(before, after), reason, evidence, key }`, and stores the receipt under the key if one was given. Rejected and duplicate receipts are never stored under a key.

### Tools facade

```ts
class Tools {
  static open(options?: { url?: string; clock?: Clock; migrate?: boolean }): Promise<Tools>; // migrate defaults to true
  constructor(store: Store, clock?: Clock);
  readonly clock: Clock;
  close(): Promise<void>;
  task: TaskOps; project: ProjectOps; section: SectionOps; label: LabelOps; filter: FilterOps; views: Views;
  export(): Promise<{ exportedAt: string; projects: Project[]; sections: Section[]; labels: Label[]; filters: Filter[]; tasks: Task[]; log: LogEntry[] }>; // everything, deleted included
}
```

`TaskOps` (all return `Promise<Receipt<Task>>` unless noted):

| Method | Behavior |
|---|---|
| `add(input: TaskAdd, ctx)` | Resolves `project` (id, slug path like `health/dental`, or `inbox`; default Inbox), `section` (id or name in that project), `parent` (must be in the same project; the task inherits the parent's section). Labels named but not registered are created with the same ctx. Duplicate check among open, non-deleted tasks: same normalized title, or word-set Jaccard ≥ 0.75 with at least three words each; returns `duplicate` with candidates unless `allowDuplicate`. Status defaults to `accepted` when actor is `neel`, else `proposed`. `order` = max order in scope + 1. |
| `get(id): Promise<Task \| null>` | Deleted included; callers check `deletedAt`. |
| `list(filter?: TaskList): Promise<Task[]>` | Excludes deleted unless `includeDeleted`. Open statuses only unless `status`, `includeClosed`, or a `filter` that mentions status. `project` accepts a ref; `withSubprojects` includes descendants. `filter` is evaluated with `matches()` from `filter.ts` after the other criteria. Sort: due date then due time then priority then order then createdAt; undated last. |
| `update(id, input: TaskUpdate, ctx)` | Content and scheduling fields only. `null` clears a field. A repeating task must keep a due date. |
| `move(id, input: TaskMove, ctx)` | Changes project, section, parent. Section must belong to the target project. Parent must be in the same project and must not be the task or one of its descendants. Moving a task moves its subtree with it. |
| `reorder(ids: string[], ctx): Promise<Receipt<Task>[]>` | All ids must be non-deleted and share project, section, and parent; assigns `order` 0..n-1 in the given sequence. |
| `duplicate(id, ctx, opts?: { subtasks?: boolean })` | New id, copies title, notes, project, section, parent, order (after the original), labels, priority, due, deadline, duration, repeat, executor, bucket. Status follows the add rule. Not comments, occurrences, external. `subtasks` defaults to true and duplicates the subtree. |
| `accept(id, ctx)` | proposed → accepted. |
| `start(id, ctx)` | accepted → in_progress. |
| `complete(id, ctx, opts?: { date?: string; subtasks?: "complete" \| "leave" })` | accepted or in_progress only. Repeating: append an occurrence `{ date, at, actor }` where `date` is `opts.date` or the due date, advance `due.date` with `nextOccurrence`, status back to `accepted`. Otherwise status `done`, `completedAt` set, occurrence appended. If the task has open, non-deleted sub-tasks and `opts.subtasks` is absent, reject with `needs: { field: "subtasks", options: ["complete", "leave"], message }` and change nothing. `"complete"` completes them recursively in the same transaction (each logs its own entry). |
| `uncomplete(id, ctx)` | done → accepted with `completedAt` null. On a repeating task (status accepted, at least one occurrence): pop the last occurrence and restore `due.date` to it. Cancelled tasks are reopened with `uncomplete` as well. |
| `cancel(id, ctx)` | Any open status → cancelled. `ctx.reason` required. |
| `delete(id, ctx, opts?: { subtasks?: "delete" \| "leave" })` | Soft: sets `deletedAt`, leaves status alone. Same `needs` rule as complete when sub-tasks exist; `"delete"` deletes the subtree, `"leave"` re-parents children to the task's parent (or top level). |
| `restore(id, ctx)` | Clears `deletedAt`. If the parent is deleted, the task becomes top level in its project; if the project or section is deleted, it moves to Inbox / no section. Sub-tasks deleted with it stay deleted until restored individually. |
| `assign(id, { executor?, bucket? }, ctx)` | Executor `neel` or `agent:<name>`; bucket `safe`, `review`, `unsafe`, or `null` to clear. |
| `reschedule(id, due: Due \| null, ctx)` | Open statuses only. Repeating tasks cannot go undated. |
| `note(id, text, ctx, attachments?: { name: string; url: string }[])` | Appends a comment with `actor` from ctx. Any status. |
| `history(id): Promise<LogEntry[]>` | The task's log entries in order. |
| `batch(items: BatchItem[], ctx, opts?: { atomic?: boolean }): Promise<Receipt<Task>[]>` | `BatchItem = { op: "accept" \| "start" \| "complete" \| "uncomplete" \| "cancel" \| "delete" \| "restore" \| "move" \| "reschedule" \| "assign" \| "update" \| "duplicate"; id: string; input?: unknown; options?: unknown }`. One transaction. Default: each item succeeds or fails on its own. `atomic`: any rejection rolls everything back and every receipt reports it. |
| `import(items: unknown[], ctx, opts?: { dryRun?: boolean }): Promise<ImportResult>` | Each item is a `TaskAdd` plus optional `id` (must be unused). One transaction; `dryRun` rolls back. `ImportResult = { dryRun, created, duplicate, rejected, items: { index, outcome, id?, issues }[] }`. |

`ProjectOps`, `SectionOps`, `LabelOps`, `FilterOps` (refs are ids, or for projects a slug path or `inbox`, for labels and filters a name):

- `project.add(input: ProjectAdd, ctx)`: slug defaults to a kebab-case of the name; unique among siblings; `order` last among siblings. `project.get(ref)`, `project.tree(opts?: { includeArchived?: boolean }): Promise<ProjectNode[]>` (`{ project, sections, children }`), `project.update(ref, input, ctx)`, `project.move(ref, parent: string | null, ctx)` (no cycles; Inbox cannot move), `project.reorder(ids, ctx)` (siblings only), `project.archive(ref, ctx)`, `project.unarchive(ref, ctx)`, `project.delete(ref, ctx, opts?: { contents?: "delete" \| "inbox" })` (Inbox cannot be deleted; with non-deleted tasks or sub-projects and no choice, reject with `needs: { field: "contents", options: ["delete", "inbox"] }`; `delete` soft-deletes sub-projects, sections, and tasks recursively; `inbox` moves every task in the subtree to Inbox with no section and deletes the now-empty sub-projects and sections), `project.restore(id, ctx)` (if the parent is deleted, becomes top level), `project.history(id)`.
- `ensureInbox(tx, clock)` in `organize.ts` creates the Inbox on first use: name `Inbox`, slug `inbox`, `system: true`, actor `neel`.
- `section.add(input: SectionAdd, ctx)`, `section.get(id)`, `section.list(projectRef)`, `section.update(id, input, ctx)`, `section.reorder(ids, ctx)`, `section.archive`, `section.unarchive`, `section.delete(id, ctx, opts?: { tasks?: "delete" \| "unsection" })` (same `needs` pattern), `section.restore(id, ctx)`.
- `label.add(input: LabelAdd, ctx)` (name unique among non-deleted), `label.get(ref)`, `label.list()`, `label.update(ref, input, ctx)` (renaming rewrites the name on every task and project that carries it, each logged), `label.reorder(ids, ctx)`, `label.delete(ref, ctx)` (rejected while any non-deleted task or project carries it), `label.restore(id, ctx)`.
- `filter.add(input: FilterAdd, ctx)`, `filter.get(ref)`, `filter.list()`, `filter.update`, `filter.reorder`, `filter.delete`, `filter.restore`, `filter.run(refOrQuery): Promise<Task[]>`.
- `effectiveLabels(task, projectsById)`: the task's labels plus those of its project and every ancestor project.
- `resolveProject(tx, ref)`, `resolveSection(tx, projectId, ref)`, `projectPath(project, projectsById)` (slug path from the root), `projectDescendants(id, projects)`.

`Views` (all `Promise`):

- `today(opts?: { date?: string })` → `{ date, timezone, overdue: Task[], due: Task[], deadlines: Task[], proposed: Task[] }`. Open accepted/in_progress tasks; `deadlines` are tasks whose deadline is today or past regardless of due; `proposed` is every proposed task.
- `upcoming(days = 7, opts?: { from?: string })` → `{ from, to, days: { date, tasks: Task[] }[] }`, one entry per day including empty days; undated excluded; overdue tasks appear under the first day.
- `label(name)` → open tasks with the label directly or through their project, sorted like `list`.
- `filter(refOrQuery)` → `filter.run`.
- `search(text)` → non-deleted tasks, any status, where title, notes, or a comment contains the text case-insensitively.
- `trash()` → `{ tasks, projects, sections, labels, filters }`, deleted records only, newest deletion first.

To build a `FilterSubject` for a task: `status`, `dueDate: due?.date ?? null`, `deadline`, `priority ?? null`, `executor`, `hasParent`, `recurring: Boolean(repeat)`, `labels: effectiveLabels`, `projectPaths` (root to own project), `projectPath`, `projectIds` (root to own), `searchable` (title, notes, comment texts, lowercased).

### CLI

`life <group> <command> [args] [flags]`. Global flags: `--actor` (or `LIFE_ACTOR`; defaults to `neel` only when stdin is a TTY, otherwise required), `--reason`, `--evidence` (repeatable), `--key`, `--if-version`, `--json` (default when stdout is not a TTY), `--tz`, `--db <url>`. Exit codes: 0 ok, 1 rejected or invalid, 2 duplicate candidates, 3 database unavailable, 64 usage. On a TTY, a `needs` rejection becomes a question with the offered options; without a TTY it is a rejection whose message names the flag to pass.

```text
life task add <title> [--notes] [--project ref] [--section name|id] [--parent id] [--due date|today|tomorrow|+Nd] [--time HH:MM] [--tz] [--deadline date] [--duration min] [--repeat RRULE] [--priority 1-4] [--label name]... [--executor] [--bucket] [--status proposed|accepted] [--allow-duplicate]
life task get <id>
life task list [--filter "<query>"] [--project ref] [--with-subprojects] [--section name|id] [--label name] [--status a,b] [--all] [--due date] [--due-before date] [--due-after date] [--undated] [--text s] [--deleted] [--limit n]
life task update <id> [--title] [--notes] [--priority n|--no-priority] [--due d|--no-due] [--time] [--tz] [--deadline d|--no-deadline] [--duration n|--no-duration] [--repeat r|--no-repeat] [--label name]...
life task move <id> [--project ref] [--section name|id|--no-section] [--parent id|--no-parent]
life task reorder <id> <id>...
life task duplicate <id> [--no-subtasks]
life task accept|start|uncomplete|restore <id>
life task complete <id> [--date d] [--subtasks complete|leave]
life task cancel <id> --reason "..."
life task delete <id> [--subtasks delete|leave]
life task assign <id> [--executor e] [--bucket b|--no-bucket]
life task reschedule <id> (--due d [--time] [--tz] | --no-due)
life task note <id> <text> [--attach name=url]...
life task history <id>
life task import <file.json> [--dry-run]
life project add <name> [--parent ref] [--slug s] [--color c] [--layout list|board] [--label name]...
life project tree [--archived]
life project get|archive|unarchive|restore <ref>
life project update <ref> [--name] [--slug] [--color|--no-color] [--layout] [--label]...
life project move <ref> (--parent ref | --no-parent)
life project delete <ref> [--contents delete|inbox]
life project reorder <id> <id>...
life section add <project-ref> <name>
life section list <project-ref>
life section update <id> --name n
life section archive|unarchive|restore <id>
life section delete <id> [--tasks delete|unsection]
life section reorder <id> <id>...
life label add <name> [--color c]
life label list
life label update <ref> [--name] [--color|--no-color]
life label delete|restore <ref>
life label reorder <id> <id>...
life filter add <name> <query>
life filter list
life filter run <ref|query>
life filter update <ref> [--name] [--query]
life filter delete|restore <ref>
life today [--date d]
life upcoming [days] [--from d]
life search <text>
life trash
life export [file]
life migrate
```

Human output is plain aligned text: one line per task with id, status, title, due, project path, labels. JSON output is the receipt or result object exactly as the library returns it.
