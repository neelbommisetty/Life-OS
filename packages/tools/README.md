# @life-os/tools

The todo list and calendar core of Life-OS, plus the `life` CLI. The product spec is `docs/vision/HANDS.md` at the repository root; read it first. This file is the implementation brief: conventions, module map, and the fixed interfaces that let the modules be built independently.

## Conventions

- **Runtime.** Node 26 runs TypeScript directly, so there is no build step. Write erasable syntax only: no `enum`, no `namespace`, no constructor parameter properties. Relative imports carry the `.ts` extension. `verbatimModuleSyntax` is on: use `import type` for types. `tsconfig.json` enforces all of this; `npx tsc --noEmit` must pass.
- **Tests.** `node:test` in `src/**/*.test.ts`. Run `node --test "src/**/*.test.ts"` from this directory (or `bun run test`). Tests that touch the database use `createTestDb()` from `src/db/testing.ts`, which creates a throwaway Postgres schema, migrates it, and drops it afterwards. Tests never touch the `public` schema. Inject a fixed clock; never depend on wall-clock time.
- **Environment.** `LIFE_DATABASE_URL` is the only setting. It lives in the repository root `.env` (git-ignored). `src/db/client.ts` reads `process.env.LIFE_DATABASE_URL` and, if unset, loads the root `.env` with `process.loadEnvFile`, resolving the root from `import.meta.url`. `LIFE_TZ` optionally sets the timezone; otherwise the machine's.
- **Database.** Postgres through the `pg` Pool and Drizzle ORM (`drizzle-orm/node-postgres`). The schema is declared in `src/db/schema.ts`; migration SQL in `drizzle/` is generated with `npx drizzle-kit generate` and applied by `migrate()` in `src/db/migrate.ts`, which accepts a schema name so tests can migrate a throwaway schema (Drizzle's `migrate` supports `migrationsSchema`). Tables are unqualified, so `search_path` decides where they live; without a schema name the migration journal follows `search_path` too (`public` on a plain URL), so a URL that sets `search_path` never records a migration in `public`.
- **Storage shape.** One table per record kind (`tasks`, `projects`, `sections`, `labels`, `filters`), each `id text primary key, version integer, json jsonb, updated_at timestamptz, deleted_at timestamptz null`, plus `log` (`seq bigserial`, `at`, `actor`, `op`, `record_kind`, `record_id`, `patch jsonb`, `reason`, `evidence jsonb`, `key`) and `receipts` (`key text primary key`, `receipt jsonb`, `at`). Add expression indexes where a query needs them (tasks: `(json->>'status')`, `(json->>'projectId')`, `(json->'due'->>'date')`). Filtering happens in SQL for `deleted_at` and obvious columns, in JS otherwise. Single user; thousands of rows, not millions.
- **Writers are serialized.** Every write transaction starts with `select pg_advisory_xact_lock(4242)` so a CLI call and the app never interleave read-modify-write on the same rows. Reads do not take the lock; each `read` runs in one `REPEATABLE READ READ ONLY` transaction, so a multi-table read (export, trash, tree, list) sees one snapshot rather than a writer's commit landing between its queries.
- **Everything is async.** Every operation returns a Promise.
- **Every mutation goes through `core.ts`.** No module writes a record or a log entry on its own.
- **Time.** Dates are `YYYY-MM-DD` strings. Instants are ISO UTC strings. Helpers live in `src/time.ts`; do not add a date library.
- **Ids.** `newId(kind)` in `core.ts`: prefix from `ID_PREFIXES` plus ten random `[a-z0-9]` characters. Never derived from a provider. Prefixes: `t_ p_ s_ l_ f_` for the todo list, `a_ c_ e_` for the calendar, `v_` reserved for calendar sets.
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
  read<T>(work: (tx: Tx) => Promise<T>): Promise<T>;        // one client, one read-only snapshot (REPEATABLE READ), no lock
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

Rules inside `mutate`/`applyIn`: an invalid ctx is `rejected` before anything runs; a known idempotency key returns the stored receipt without running `work`, and is `rejected` when the stored receipt answers a different kind or op (`key: "k" was already used by project.add`); the record is validated against `taskSchema`/`projectSchema`/... after `work` and rejected if invalid; `unchanged` outcomes persist nothing and log nothing; every other ok outcome upserts the record, appends one log entry `{ at, actor, op, recordKind, recordId, patch: diff(before, after), reason, evidence, key }`, and stores `{ kind, op, receipt }` in the `receipts` table under the key if one was given. `diff` reads an absent field as null and skips fields that are null on both sides, so a create entry lists what the record holds, not every nullable field it does not. Rejected and duplicate receipts are never stored under a key, and `unchanged` outcomes likewise store no receipt under an idempotency key. A rejection that comes after a nested `applyIn` already wrote (a cascade ran before a check failed) throws `RejectedAfterWrites`, which rolls the transaction back; `mutate` returns it as the rejected receipt, so a rejected mutation never commits anything. Multi-record operations (batch, reorder, import) derive one key per item with `itemCtx(ctx, index)`: the caller's key, U+001F, the index; caller keys may not contain control characters, so the two can never collide.

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
| `add(input: TaskAdd, ctx)` | Resolves `project` (id, slug path like `health/dental`, or `inbox`; default Inbox), `section` (id or name in that project), `parent` (must be in the same project; the task inherits the parent's section). Labels named but not registered are created with the same ctx. Duplicate check among open, non-deleted tasks: same normalized title, or word-set Jaccard ≥ 0.75 with at least three words each; returns `duplicate` with candidates unless `allowDuplicate`. Status defaults to `accepted` when actor is `neel`, else `proposed`. `order` = max order in scope + 1, deleted tasks included, so a deleted task keeps its slot and a restore never collides with what was added meanwhile (the same rule orders projects, sections, labels, and filters). |
| `get(id): Promise<Task \| null>` | Deleted included; callers check `deletedAt`. |
| `list(filter?: TaskList): Promise<Task[]>` | Excludes deleted unless `includeDeleted`. Open statuses only unless `status`, `includeClosed`, or a `filter` that mentions status. `project` accepts a ref; `withSubprojects` includes descendants. `filter` is evaluated with `matches()` from `filter.ts` after the other criteria. Sort: due date then due time then priority then order then createdAt; undated last. |
| `update(id, input: TaskUpdate, ctx)` | Content and scheduling fields only. `null` clears a field. A repeating task must keep a due date. |
| `move(id, input: TaskMove, ctx)` | Changes project, section, parent. Section must belong to the target project. Parent must be in the same project and must not be the task or one of its descendants. Moving a task moves its subtree with it. |
| `reorder(ids: string[], ctx): Promise<Receipt<Task>[]>` | All ids must be non-deleted and share project, section, and parent; assigns `order` 0..n-1 in the given sequence. |
| `duplicate(id, ctx, opts?: { subtasks?: boolean })` | New id, copies title, notes, project, section, parent, order (immediately after the original: the copy takes `original.order + 1` and every following sibling, deleted ones included, moves up one in the same transaction, each logged as an `order` patch), labels, priority, due, deadline, duration, repeat, executor, bucket. Status follows the add rule. Not comments, occurrences, external. `subtasks` defaults to true and duplicates the subtree. |
| `accept(id, ctx)` | proposed → accepted. |
| `start(id, ctx)` | accepted → in_progress. |
| `complete(id, ctx, opts?: { date?: string; subtasks?: "complete" \| "leave" })` | accepted or in_progress only. Repeating: append an occurrence `{ date, at, actor }` where `date` is `opts.date` or the due date, advance `due.date` with `nextOccurrence`, status back to `accepted`. Otherwise status `done`, `completedAt` set, occurrence appended. If the task has open, non-deleted sub-tasks and `opts.subtasks` is absent, reject with `needs: { field: "subtasks", options: ["complete", "leave"], message }` and change nothing. `"complete"` completes them recursively in the same transaction (each logs its own entry). |
| `uncomplete(id, ctx)` | done → accepted with `completedAt` null. On a repeating task (status accepted or in_progress, at least one occurrence): pop the last occurrence, restore `due.date` to what it was before the completion that recorded it, read from that completion's log entry (HANDS D52), and set status `accepted`; the occurrence's own date is only the fallback when the log has no such entry. Cancelled tasks are reopened with `uncomplete` as well. |
| `cancel(id, ctx)` | Any open status → cancelled. `ctx.reason` required. |
| `delete(id, ctx, opts?: { subtasks?: "delete" \| "leave" })` | Soft: sets `deletedAt`, leaves status alone. Same `needs` rule as complete, asked only when the task has open, non-deleted sub-tasks; closed sub-tasks are deleted along with the parent even when no choice is given. `"delete"` deletes the subtree, `"leave"` re-parents children to the task's parent (or top level). |
| `restore(id, ctx)` | Clears `deletedAt`. If the parent is deleted, the task becomes top level in its project; if the project or section is deleted, it moves to Inbox / no section. Sub-tasks deleted with it stay deleted until restored individually. |
| `assign(id, { executor?, bucket? }, ctx)` | Executor `neel` or `agent:<name>`; bucket `safe`, `review`, `unsafe`, or `null` to clear. |
| `reschedule(id, due: Due \| null, ctx)` | Open statuses only. Repeating tasks cannot go undated. |
| `note(id, text, ctx, attachments?: { name: string; url: string }[])` | Appends a comment with `actor` from ctx. Any status. |
| `history(id): Promise<LogEntry[]>` | The task's log entries in order. |
| `batch(items: BatchItem[], ctx, opts?: { atomic?: boolean }): Promise<Receipt<Task>[]>` | `BatchItem = { op: "accept" \| "start" \| "complete" \| "uncomplete" \| "cancel" \| "delete" \| "restore" \| "move" \| "reschedule" \| "assign" \| "update" \| "duplicate"; id: string; input?: unknown; options?: unknown }`. One transaction. Default: each item succeeds or fails on its own, including an item rejected after its own cascade wrote (each item runs under a Postgres savepoint, so only that item is undone). `atomic`: any rejection rolls everything back and every receipt reports it. `ctx.ifVersion` guards the first item on each task id; later items on the same id run against the version the earlier item left. |
| `import(items: unknown[], ctx, opts?: { dryRun?: boolean }): Promise<ImportResult>` | Each item is a `TaskAdd` plus optional `id` (must be unused). One transaction; `dryRun` rolls back. `ImportResult = { dryRun, created, duplicate, rejected, items: { index, outcome, id?, issues }[] }`. |

`ProjectOps`, `SectionOps`, `LabelOps`, `FilterOps` (refs are ids, or for projects a slug path or `inbox`, for labels and filters a name):

- `project.add(input: ProjectAdd, ctx)`: slug defaults to a kebab-case of the name; unique among siblings; `order` last among siblings. Labels named on `project.add` and `project.update` are auto-registered the same as on `task.add`. Changing a slug with `project.update` rewrites `#old/path` and `##old/path` (and every path below them) to the new path in every non-deleted saved filter, each logged. `project.get(ref)`, `project.tree(opts?: { includeArchived?: boolean }): Promise<ProjectNode[]>` (`{ project, sections, children }`), `project.update(ref, input, ctx)`, `project.move(ref, parent: string | null, ctx)` (no cycles; Inbox cannot move), `project.reorder(ids, ctx)` (siblings only), `project.archive(ref, ctx)`, `project.unarchive(ref, ctx)`, `project.delete(ref, ctx, opts?: { contents?: "delete" \| "inbox" })` (Inbox cannot be deleted; with non-deleted tasks or sub-projects and no choice, reject with `needs: { field: "contents", options: ["delete", "inbox"] }`; `delete` soft-deletes sub-projects, sections, and tasks recursively; `inbox` moves every task in the subtree to Inbox with no section and deletes the now-empty sub-projects and sections), `project.restore(id, ctx)` (if the parent is deleted, becomes top level), `project.history(id)`.
- `ensureInbox(tx, clock)` in `organize.ts` creates the Inbox on first use: name `Inbox`, slug `inbox`, `system: true`, actor `neel`.
- `section.add(input: SectionAdd, ctx)`, `section.get(id)`, `section.list(projectRef)`, `section.update(id, input, ctx)`, `section.reorder(ids, ctx)`, `section.archive`, `section.unarchive`, `section.delete(id, ctx, opts?: { tasks?: "delete" \| "unsection" })` (same `needs` pattern), `section.restore(id, ctx)`.
- `label.add(input: LabelAdd, ctx)` (name unique among non-deleted), `label.get(ref)`, `label.list()`, `label.update(ref, input, ctx)` (renaming rewrites the name on every task and project that carries it and `@old` → `@new` in every non-deleted saved filter, each logged), `label.reorder(ids, ctx)`, `label.delete(ref, ctx)` (rejected while any non-deleted task or project carries it), `label.restore(id, ctx)`.
- `filter.add(input: FilterAdd, ctx)`, `filter.get(ref)`, `filter.list()`, `filter.update`, `filter.reorder`, `filter.delete`, `filter.restore`, `filter.run(refOrQuery): Promise<Task[]>`.
- `effectiveLabels(task, projectsById)`: the task's labels plus those of its project and every ancestor project.
- `resolveProject(tx, ref)`, `resolveSection(tx, projectId, ref)`, `projectPath(project, projectsById)` (slug path from the root), `projectDescendants(id, projects)`.

`Views` (all `Promise`):

- `today(opts?: { date?: string })` → `{ date, timezone, overdue: Task[], due: Task[], deadlines: Task[], proposed: Task[] }`. Open accepted/in_progress tasks; `deadlines` are tasks whose deadline is today or past regardless of due; `proposed` is every proposed task.
- `upcoming(days = 7, opts?: { from?: string })` → `{ from, to, days: { date, tasks: Task[] }[] }`, one entry per day including empty days; undated excluded; overdue tasks appear under the first day. Accepted and in-progress tasks only, the same statuses `today` lays out: proposed tasks appear only in today's `proposed` list, not in upcoming.
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
life task update <id> [--title] [--notes] [--priority n|--no-priority] [--due d|--no-due] [--time] [--tz] [--deadline d|--no-deadline] [--duration n|--no-duration] [--repeat r|--no-repeat] [--label name]...|--no-label
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
life project update <ref> [--name] [--slug] [--color|--no-color] [--layout] [--label]...|--no-label
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
life filter reorder <id> <id>...
life today [--date d]
life upcoming [days] [--from d]
life search <text>
life trash
life export [file]
life migrate
life help
```

### CLI ergonomics for agents (binding)

The CLI's first user is an agent reading JSON, and its second is Neel debugging what the agent did. Every rule below is testable.

- **Help at every layer.** `life --help`, `life <group> --help`, and `life <group> <command> --help` (also `-h`, and `life help [group] [command]`). Top level lists groups, global flags, environment variables, and exit codes. Group level lists its commands with one-line purposes. Command level lists positionals, every flag with its type, allowed values, default, and whether it repeats, plus two or three copy-pasteable examples and the exit codes that command can produce. `life --version` prints the package version.
- **Unknown input is a usage error, never a guess.** An unknown group, command, or flag exits 64, names what was unknown, suggests the closest known names, and prints the help for the layer it failed at. Missing required positionals say which one is missing.
- **One JSON envelope, always on stdout, nothing else on stdout.** With `--json` (or a non-TTY stdout), the CLI prints exactly one JSON object: `{ "ok": boolean, "command": "task add", "exitCode": number, "result"?: <the library's return value: receipt, record, list, view>, "error"?: { "code": "usage" | "rejected" | "duplicate" | "needs" | "not_found" | "db_unavailable" | "internal", "message": string, "issues": string[], "hint"?: string, "needs"?: { field, options, message }, "candidates"?: Task[] }, "warnings"?: string[] }`. Diagnostics and progress go to stderr. Nothing else may be printed to stdout in JSON mode, including from the database driver.
- **Every failure carries a hint an agent can act on.** A `needs` rejection names the exact flag and values to pass (`--subtasks complete|leave`). A duplicate names `--allow-duplicate` and lists candidate ids and titles. A bad project or section ref suggests `life project tree`. A bad filter quotes the grammar cheat sheet line that applies. A validation issue keeps its field path (`due.time: Use HH:MM`). A missing actor says `--actor` or `LIFE_ACTOR`. A database failure says which variable it read, the host it tried (never the password), and to run `life doctor`.
- **`life doctor`.** Reports, as a table or JSON: which env file was read, whether `LIFE_DATABASE_URL` is set, connectivity and server version, whether migrations are current, the effective timezone and where it came from, the effective actor and where it came from, and the Inbox id. Exit 0 when healthy, 3 when the database is unreachable, 1 for any other problem.
- **Debuggability.** `--verbose` (or `LIFE_DEBUG=1`) adds stack traces, the SQL error code and detail on database errors, and the resolved refs (project path to id, section name to id) on stderr. Without it, messages stay one or two lines. Every success line in human mode includes the id; `life task get <id> --json` returns the full record.
- **Determinism.** Lists are ordered as the brief's sort rules say, and identical inputs give identical output. Timestamps in output are the library's ISO strings, untouched.
- **Human mode is a convenience, not a source of truth.** Anything an agent needs is in the JSON envelope.
- **The CLI stands alone.** The skill says when to reach for the CLI and what Neel expects of agents; it is not the manual. An agent with no skill loaded, starting from `life --help`, must be able to discover every command, flag, ref format, filter term, and exit code and complete a task correctly. Test this by driving a flow from help output alone.

Human output is plain aligned text: one line per task with id, status, title, due, project path, labels. JSON output is the receipt or result object exactly as the library returns it.

## The calendar

The calendar spec is the "The calendar" section of `docs/vision/HANDS.md` (D44, D55 to D66); read it first. This part of the brief fixes how it lands in this package. Everything above still applies: `core.mutate` for every write, the store's lock and snapshot rules, the receipt and log shapes, the CLI envelope and ergonomics. The calendar adds three record kinds, one provider adapter, a sync engine, and a handful of views. Nothing in the todo modules changes except the `today` view, which grows a schedule.

### Conventions that change or extend

- **Environment.** `LIFE_DATABASE_URL` is still the only required setting. Two more are needed once an account is connected: `LIFE_GOOGLE_CLIENT_ID` and `LIFE_GOOGLE_CLIENT_SECRET`, Life-OS's own OAuth desktop client, in the root `.env`. `LIFE_CAL_MAX_AGE` (seconds, default `300`) is the copy age above which a view refreshes before answering. `LIFE_CAL_HISTORY_MONTHS` (default `12`) bounds the first full sync backwards; there is no forward bound.
- **Credentials.** Refresh tokens live in `.local/google/<accountId>.json` (`{ identity, refreshToken, scopes, obtainedAt }`), resolved from the repository root the way `.env` is. Never in a record, never in the log, never in a receipt, never on stderr even with `--verbose`.
- **Network.** Only `src/calendar/google/*` talks to Google, through the global `fetch` and Node's `http` for the OAuth loopback. No `googleapis` package. Every request has a 20 second timeout. Tests never touch the network: they use the fake adapter.
- **Recurrence.** Provider events arrive with arbitrary RRULEs, so expansion uses the `rrule` package behind `src/calendar/expand.ts`; nothing else imports it. `src/recurrence.ts` stays the todo subset and is untouched. Expansion runs in the event's own timezone (wall clock through `zonedToInstant`), so a weekly 9 AM stays 9 AM across a DST change.
- **Actors.** Sync writes carry actor `import:google`, op `event.sync`, `calendar.sync`, or `account.sync`. They go through `applyIn` like everything else, so a meeting moved on the phone shows up in `event.history` with who moved it, from the provider's point of view. Unchanged items log nothing, and `syncedAt`, `syncError`, and the sync token are bookkeeping written with `tx.put` without a log entry or version bump, so a quiet sync writes nothing.
- **Dependencies added.** `rrule` only.

### Module map additions

| Module | Owns | Depends on |
|---|---|---|
| `src/contract.ts` (extended) | account, calendar, event schemas and inputs; `ID_PREFIXES` gains `account: "a"`, `calendar: "c"`, `event: "e"` | |
| `src/db/schema.ts` (extended), `drizzle/0001_calendar.sql` | `accounts`, `calendars`, `events` tables | |
| `src/store.ts` (extended) | `Kind` and `RecordOf` gain the three kinds; `Tx.eventsInRange` | db |
| `src/calendar/adapter.ts` | `CalendarAdapter` interface, provider record types, `FakeAdapter` for tests | contract |
| `src/calendar/credentials.ts` | read, write, delete of `.local/google/*.json` | |
| `src/calendar/google/oauth.ts` | desktop OAuth with PKCE and a loopback listener; token refresh | credentials |
| `src/calendar/google/client.ts` | the REST calls: calendarList, events list with sync tokens, insert, patch, delete, instances | oauth |
| `src/calendar/google/map.ts` | provider event ↔ `Event`, provider calendar ↔ `Calendar`; pure functions | contract |
| `src/calendar/google/index.ts` | `GoogleAdapter implements CalendarAdapter` | the three above |
| `src/calendar/expand.ts` | occurrences of one event in a window, honouring exception rows | contract, `rrule` |
| `src/calendar/sync.ts` | full and incremental sync per calendar, calendar list sync, `refreshIfStale` | core, adapter |
| `src/calendar/accounts.ts` | `AccountOps`, `CalendarOps` | core, sync, adapter |
| `src/calendar/events.ts` | `EventOps`: write-through, scope handling, delete and restore | core, sync, adapter, expand |
| `src/calendar/schedule.ts` | `today` (the schedule half), `week`, `slots`; merges events and dated tasks | expand, views, tasks |
| `src/tools.ts` (extended) | `account`, `calendar`, `event` on the facade; `Tools.open({ adapters })` | |
| `src/cli.ts` (extended) | `account`, `calendar`, `event` groups; `week`, `slots`, `sync`; `today` shows the schedule; `doctor` reports accounts | tools |
| `../../skills/calendar/SKILL.md` | guidance for Codex and agents | the CLI |

Each module has a matching `*.test.ts`. `map.ts` and `expand.ts` are pure and get the densest tests.

### Records

```ts
// A moment: timed (timezone null means floating) or a date for all-day.
type When = { at: string; timezone: string | null } | { date: string };

type Account = {
  id: string; provider: "google"; identity: string; label: string | null;
  primary: boolean;                       // exactly one account is primary once any exists
  status: "connected" | "needs_reauth" | "disconnected";
  scopes: string[]; syncedAt: string | null;
  version: number; createdAt: string; updatedAt: string; deletedAt: string | null;
};

type Calendar = {
  id: string; accountId: string; name: string; color: string | null; timezone: string;
  labels: string[];                       // life areas, D49
  writable: boolean;                      // provider access role is owner or writer
  hidden: boolean;                        // excluded from views unless asked for
  primaryOfAccount: boolean;              // the account's main calendar; default target for event.add on that account
  order: number;
  external: { id: string; syncToken: string | null };
  syncedAt: string | null; syncError: string | null;
  version: number; createdAt: string; updatedAt: string; deletedAt: string | null;
};

type Event = {
  id: string; calendarId: string; accountId: string;
  title: string; notes: string | null; location: string | null;
  start: When; end: When;                 // both timed or both dates; end after start; an all-day end date is exclusive
  repeat: { rrule: string; exdates: string[] } | null;   // masters only; exdates are original starts
  masterId: string | null; originalStart: When | null;  // set on an exception row: one edited or cancelled occurrence
  status: "confirmed" | "tentative" | "cancelled";
  busy: boolean;                          // provider transparency; all-day events default to false
  organizer: { email: string; name: string | null; self: boolean } | null;
  attendees: { email: string; name: string | null; response: "needsAction" | "accepted" | "declined" | "tentative"; self: boolean; optional: boolean }[];
  myResponse: "needsAction" | "accepted" | "declined" | "tentative" | null;   // null when Neel is not an attendee
  conferencing: { kind: string; url: string } | null;   // read only in this cut
  reminders: { method: string; minutes: number }[] | null; // null means the calendar's default; carried for the iOS app, D63
  origin: Origin; external: { provider: "google"; id: string; etag: string; iCalUID: string; updatedAt: string };
  version: number; createdAt: string; updatedAt: string; deletedAt: string | null;
};
```

HANDS calls per-instance changes "overrides". Here each is its own event row with `masterId` and `originalStart`, because that is how Google delivers them and it makes sync one row per provider item. A cancelled occurrence is an exception row with `status: "cancelled"`. `expand.ts` lays the master's rule out, drops `exdates`, and replaces any occurrence whose original start matches an exception row with that row.

An occurrence is addressed as `<eventId>@<originalStart>` where `originalStart` is the `at` instant or the `date`. `EventOps` accepts an event id or an occurrence id wherever it says `ref`.

Storage: `accounts`, `calendars`, `events` use `recordColumns()`. Indexes on `events`: `(json->>'calendarId')`, `(json->>'masterId')`, `(json->'start'->>'at')`, `(json->'start'->>'date')`, `((json->'external'->>'id'))`. `Tx.eventsInRange(calendarIds, fromInstant, toInstant)` returns non-deleted rows whose start is before `to` and end after `from`, plus every master with a rule in those calendars (masters are expanded in JS; an unbounded series cannot be range-filtered in SQL), plus their exception rows.

### The adapter

```ts
export type ProviderCalendar = { id: string; name: string; color: string | null; timezone: string; writable: boolean; primary: boolean; hidden: boolean };
export type ProviderEvent = Omit<Event, "id" | "calendarId" | "accountId" | "masterId" | "origin" | "version" | "createdAt" | "updatedAt" | "deletedAt"> & {
  providerMasterId: string | null;      // for an exception row
  deleted: boolean;                     // provider says it is gone
  lifeId: string | null;                // our id, if we stamped it on create (extendedProperties.private.lifeId)
};
export type SyncPage = { items: ProviderEvent[]; nextCursor: string | null; done: boolean };
export class CursorExpired extends Error {}
export class ProviderUnavailable extends Error { constructor(message: string, readonly status?: number) }
export class ProviderRejected extends Error { constructor(message: string, readonly status: number) }

export interface CalendarAdapter {
  readonly provider: "google";
  /** Runs the OAuth flow. `open` receives the URL to show; the promise resolves when the loopback receives the code. */
  connect(opts: { open: (url: string) => void; timeoutMs?: number }): Promise<{ identity: string; scopes: string[]; credentialId: string }>;
  listCalendars(accountId: string): Promise<ProviderCalendar[]>;
  /** One page. Pass `cursor: null` for a full sync from `since`; afterwards pass the cursor from the last page. Throws CursorExpired when the provider says start over. */
  syncPage(accountId: string, calendarExternalId: string, cursor: string | null, since: string): Promise<SyncPage>;
  create(accountId: string, calendarExternalId: string, event: EventWrite, lifeId: string): Promise<ProviderEvent>;
  update(accountId: string, calendarExternalId: string, providerId: string, patch: EventPatch, etag: string): Promise<ProviderEvent>;
  delete(accountId: string, calendarExternalId: string, providerId: string): Promise<void>;
  respond(accountId: string, calendarExternalId: string, providerId: string, response: "accepted" | "declined" | "tentative"): Promise<ProviderEvent>;
  move(accountId: string, fromCalendarExternalId: string, toCalendarExternalId: string, providerId: string): Promise<ProviderEvent>;   // keeps the provider id
  instances(accountId: string, calendarExternalId: string, providerMasterId: string): Promise<ProviderEvent[]>;  // a master's exception rows, deleted included
  instanceId(providerMasterId: string, originalStart: When): string;   // the provider's id for one occurrence
}
```

`EventWrite` and `EventPatch` are the provider-neutral write shapes (title, notes, location, start, end, repeat, busy, status). The Google adapter stamps `extendedProperties.private.lifeId` on create so the row keeps its Life-OS id even if the local write fails and sync later brings the event back. `FakeAdapter` holds calendars and events in memory, records every call, can be told to throw `ProviderUnavailable` or `CursorExpired` on the next call, and generates cursors so incremental sync is testable.

Google specifics, kept inside `src/calendar/google`: scopes `calendar.events`, `calendar.calendarlist.readonly`, `userinfo.email`; loopback redirect on `127.0.0.1` with a random port and PKCE; `events.list` with `singleEvents=false`, `showDeleted=true`, `maxResults=250`, `timeMin=since` on the first page only, `syncToken` afterwards; HTTP 410 becomes `CursorExpired`; 401 after one refresh attempt marks the account `needs_reauth`; 403 with a rate-limit reason and 5xx become `ProviderUnavailable`; other 4xx become `ProviderRejected` with Google's message. `sendUpdates` is `none` on every write in this cut, since attendees are not authored (D61); `respond` patches Neel's own attendee entry.

### Sync

```ts
export type SyncReport = { accountId: string; calendars: { calendarId: string; outcome: "synced" | "unchanged" | "resynced" | "failed"; created: number; updated: number; deleted: number; error?: string }[] };
export function syncAccount(store, clock, adapter, accountId, opts?: { calendarIds?: string[]; full?: boolean }): Promise<SyncReport>;
export function refreshIfStale(store, clock, adapters, opts: { maxAgeSeconds: number; calendarIds?: string[] }): Promise<{ refreshed: string[]; failed: { calendarId: string; error: string }[] }>;
```

Rules:

- **Calendar list first.** `syncAccount` reconciles calendars: new provider calendars are added (`calendar.sync`, hidden defaults to the provider's flag), renamed or re-permissioned ones updated, ones the provider no longer lists are soft-deleted along with their events. `labels`, `hidden` once Neel has set it, and `order` are ours and never overwritten by sync.
- **One transaction per page.** Each page of events is applied inside one `store.transaction` with `applyIn` per item, so a crash mid-sync leaves whole pages and the cursor is stored only with the page that earned it. Only the sync token from the final page lands on the calendar record, in that page's transaction; page tokens stay in memory, so a crash mid-listing restarts the listing, which is idempotent, and a refused page token restarts it too.
- **Matching.** A provider item finds its row by `lifeId` first, then by `external.id`. A `lifeId` hit must also agree on provider id and calendar for a tombstone, so a moved or restored event is not trashed by its old copy; a live item with a different provider id claims the row only when the row is deleted or the item is newer. Instances never carry a `lifeId` (Google hands the master's private properties down to them). A new item gets `newId("event")` unless it carries a `lifeId` that no row has, in which case it takes that id.
- **Provider deletions.** `deleted: true` soft-deletes the row (`deletedAt`, status left as it was). A tombstone for a row already `cancelled` with the same etag is `unchanged`, so `event.cancel` survives the next sync. A deleted master deletes its exception rows. Sync never physically removes anything, D53.
- **Etag wins.** An item whose `external.etag` equals the row's is `unchanged`. Otherwise the provider's version replaces ours field by field; the log shows the patch. There is no merge and no local-wins, because the provider is the source, D44.
- **Cursor expired.** Drop the token, run a full sync from `since`, and soft-delete rows in that calendar that the full sync did not mention and whose start is after `since` (`outcome: "resynced"`).
- **Failures are per calendar.** One calendar's error does not stop the others. It lands in `syncError` and `SyncReport`, and the view that triggered the refresh reports it as a warning.
- **`refreshIfStale`** syncs every non-deleted calendar (or the given ones) of every connected account whose `syncedAt` is null or older than `maxAgeSeconds`. Views call it first unless told `fresh: false`. It swallows nothing: failures come back and the view carries them.

### Operations

`AccountOps` (return `Promise<Receipt<Account>>` unless noted; refs are an id, the identity email, or the label):

| Method | Behavior |
|---|---|
| `add({ provider: "google", label?, open }, ctx)` | Runs `adapter.connect`, then in one mutation creates the account (`primary: true` if it is the first), stores the credential under the new id, and runs `syncAccount`. An identity that already has a live account is re-authorised instead: the credential is replaced, status returns to `connected`, scopes merge, and the receipt is `updated`. The credential is adopted after the transaction commits; one that cannot be adopted is revoked at the provider and deleted. The sync report is attached to the receipt as `receipt.record` plus `warnings` on the CLI envelope. |
| `get(ref): Promise<Account \| null>`, `list(): Promise<Account[]>` | |
| `update(ref, { label? }, ctx)` | |
| `primary(ref, ctx): Promise<Receipt<Account>[]>` | Marks this account primary and clears the flag on the others in one transaction. |
| `sync(ref?, opts?: { full?: boolean }): Promise<SyncReport[]>` | One account or all connected ones. `full` discards cursors. Not a mutation in itself; its writes are the `*.sync` entries. |
| `remove(ref, ctx)` | Soft-deletes the account, its calendars, and their events; deletes the credential file. Rejected while it is primary and another account exists (choose a new primary first). |

`CalendarOps` (refs are an id, `<identity>/<name>`, or a name if unique among non-deleted calendars):

| Method | Behavior |
|---|---|
| `get(ref)`, `list(opts?: { includeHidden?: boolean })` | Sorted by account then `order`. |
| `update(ref, { labels?, hidden?, color? }, ctx)` | Ours only; `color` here is Life-OS's, provider colour is read on sync. Labels named but not registered are created, as on `task.add`. |
| `reorder(ids, ctx)` | Within one account. |
| `sync(ref)` | That calendar only. |

`EventOps` (return `Promise<Receipt<Event>>` unless noted; `ref` is an event id or an occurrence id; every write is write-through per D59):

| Method | Behavior |
|---|---|
| `add(input: EventAdd, ctx)` | `calendar` ref defaults to the primary account's `primaryOfAccount` calendar. Validates: writable calendar, end after start, both sides the same kind of `When`, a rule only with a timed or all-day start, timezone known. The id is `newId("event")`, or when `ctx.key` is set, `"e_" + base36(sha256(key)).slice(0, 10)` so a retry after a partial failure meets its own row (the row exists → `unchanged`) instead of creating twice. Calls `adapter.create`, stores the readback, receipt carries `external`. `ProviderUnavailable` → `rejected` with issue `provider_unavailable`, nothing stored. `ProviderRejected` → `rejected` with the provider's message. |
| `get(ref): Promise<Event \| Occurrence \| null>`, `list(opts: { from, to, calendars?, includeHidden?, includeDeleted? }): Promise<Occurrence[]>` | Expanded occurrences in the window, sorted by start. `list` does not refresh; the views do. |
| `update(ref, input: EventUpdate, ctx, opts?: { scope?: "this" \| "following" \| "all" })` | Title, notes, location, start, end, repeat, busy, status. On a repeating event `scope` is required (reject with `needs: { field: "scope", options: ["this", "following", "all"] }`). `this`: patch the provider instance, which yields an exception row. `all`: patch the master; after a time or rule change the exception rows are read back from the provider through `instances` and stored, never shifted locally. `following`: two provider calls in one mutation, patch the master's rule with `UNTIL` just before this occurrence and create a new master from this occurrence with the remaining rule; the new master is a new Life-OS id, returned as the receipt's record, and the receipt's `issues` stays empty but `warnings` names the truncated original. If the second call fails after the first succeeded, the mutation is `rejected` with `partial: true` and the next sync shows the truncated series; there is no compensating write. |
| `reschedule(ref, { start, end? }, ctx, opts?: { scope? })` | `update` limited to time; `end` keeps the duration when omitted. |
| `move(ref, calendarRef, ctx)` | Masters and single events only. Google moves keep the provider id; the row's `calendarId` and `accountId` change. Rejected across accounts (the provider cannot), with a hint to `duplicate` then `delete`. |
| `respond(ref, "accepted" \| "declined" \| "tentative", ctx, opts?: { scope? })` | Only when `myResponse` is not null. |
| `cancel(ref, ctx, opts?: { scope? })` | Only when `organizer.self`. Sets provider status cancelled; the row stays visible with `status: "cancelled"`, not deleted. `ctx.reason` required, as for tasks. |
| `delete(ref, ctx, opts?: { scope? })` | `adapter.delete`, then `deletedAt` on the row (and on exception rows for `all`). An occurrence delete with `this` is an exception row with status cancelled. |
| `restore(id, ctx)` | Masters and single events. `adapter.create` again with the stored fields and the same `lifeId`, new `external.id`; clears `deletedAt`. Exception rows are restored with their master. |
| `duplicate(ref, ctx, opts?: { calendar?: string })` | New row and provider event with the same fields except attendees, organizer, conferencing, external. |
| `history(id): Promise<LogEntry[]>` | |

`EventAdd`: `{ title, calendar?, start: When, end?: When, duration?: number (minutes, default 60 when end absent), notes?, location?, repeat?: string (RRULE), busy?: boolean }`. An all-day event is `start: { date }` and `end: { date }` exclusive or `duration` in days. `EventUpdate` is the same fields optional with `null` to clear notes, location, repeat.

### Views

```ts
type ScheduleEntry = { kind: "event"; occurrence: Occurrence } | { kind: "task"; task: Task };
type Freshness = { calendarId: string; name: string; syncedAt: string | null; ageSeconds: number | null; refreshed: boolean; error: string | null }[];
type Day = { date: string; allDay: ScheduleEntry[]; timed: ScheduleEntry[] };   // timed sorted by start, then title; allDay events first, then dated tasks
```

- `today(opts?: { date?, fresh?, includeHidden? })` keeps every field it has and adds `allDay`, `timed`, `freshness`, `warnings`. Events: occurrences overlapping the day in the display zone, `status !== "cancelled"` unless `myResponse === "declined"` in which case dropped, hidden calendars excluded. Tasks: the same open tasks the view already lays out; a task with `due.time` becomes a timed entry at that instant, one with only a date goes to `allDay`. With no accounts, `freshness` is empty and `timed` holds only timed tasks, so the todo-only behaviour is unchanged.
- `week(opts?: { from?, days? = 7, fresh?, includeHidden? })` → `{ from, to, timezone, days: Day[], freshness, warnings }`. One entry per day including empty days. Multi-day events appear on each day they cover. Overdue tasks are not carried into the week; that is `today`'s job.
- `slots(opts: { duration: number; from: string; to: string; hours?: { start: "HH:MM"; end: "HH:MM"; days?: number[] }; calendars?: string[]; fresh? })` → `{ slots: { start: string; end: string }[]; freshness; warnings }`. Busy time is every non-cancelled, non-declined occurrence with `busy: true` on every non-hidden calendar of every connected account, hidden ones included when named. Default hours 09:00 to 18:00 Monday to Friday in the display zone. Slots are the maximal free windows at least `duration` long, clipped to the hours, from `max(from, now)`.
- `trash()` gains `events`, `calendars`, `accounts`.

A view that refreshed reports it; a view whose refresh failed still answers from the copy and says so in `warnings` and `freshness[].error`. Never an empty answer standing in for a failed one.

### CLI additions

```text
life account add google [--label s]                # opens the browser; prints the account id and a sync report
life account list
life account get|remove <ref>
life account primary <ref>
life account sync [ref] [--full]
life calendar list [--hidden]
life calendar get|sync <ref>
life calendar update <ref> [--label name]...|--no-label [--hidden|--visible] [--color c|--no-color]
life calendar reorder <id> <id>...
life event add <title> (--start "YYYY-MM-DD HH:MM" [--end "YYYY-MM-DD HH:MM" | --duration min] [--tz zone | --floating] | --date YYYY-MM-DD [--end-date YYYY-MM-DD | --days n]) [--calendar ref] [--notes] [--location] [--repeat RRULE] [--free]
life event get <ref>
life event list --from d --to d [--calendar ref]... [--hidden] [--deleted]
life event update <ref> [--title] [--notes|--no-notes] [--location|--no-location] [--start] [--end] [--tz] [--date] [--end-date] [--repeat r|--no-repeat] [--busy|--free] [--scope this|following|all]
life event reschedule <ref> --start "..." [--end "..."] [--tz] [--scope ...]
life event move <ref> --calendar ref
life event respond <ref> accepted|declined|tentative [--scope ...]
life event cancel <ref> --reason "..." [--scope ...]
life event delete <ref> [--scope ...]
life event restore|duplicate|history <id>
life today [--date d] [--stale] [--hidden]         # --stale skips the refresh
life week [--from d] [--days n] [--stale] [--hidden]
life slots --duration min [--from d] [--to d] [--hours 09:00-18:00] [--days mon-fri] [--calendar ref]... [--stale]
life sync [--full]
```

Conventions: `--start` and `--end` take `YYYY-MM-DD HH:MM` in the display zone unless `--tz` names one; `--floating` stores no zone. Occurrence refs print as `e_xxxxxxxxxx@2026-09-10T16:00:00Z` in every list, so an agent can copy them straight into `update` or `respond`. A `needs` on `scope` becomes a question on a TTY and a rejection naming `--scope this|following|all` otherwise. Exit code 3 also covers `provider_unavailable`, with the error code `provider_unavailable` in the envelope; `provider_rejected` exits 1. `life doctor` adds: the Google client id present or not (never the secret), each account with status, credential file present, token refresh works, calendars and their copy age, the primary account, and a credential-files check that warns on pending or unreferenced files in `.local/google`. `life --help` lists the new groups; `life help event` prints the `When` formats and the scope rules.

Human output for `today` and `week`: the day's all-day line, then one line per timed entry with time range, an `E` or `T` marker, title, calendar or project, and for events awaiting an answer a `?` before the title. Freshness prints as one stderr line per stale or failed calendar, never on stdout in JSON mode.

### Skill

`skills/calendar/SKILL.md` mirrors the todo skill: when to reach for it (anything about the schedule, free time, an invitation, or an event Neel asks to add or move); always `--json --actor codex`; trust the view's freshness and run `life sync` only when Neel says something just changed; `life slots` before offering times, and quote the slots as given; never `respond` to an invitation, `cancel`, or `delete` without Neel's explicit word; `event add` and `task add` are different things and the skill says which is which (a commitment at a time with a place or people is an event, a thing to do is a task); report the receipt and the occurrence ref back.

### Tests that must exist

- `map.test.ts`: every field both ways, all-day and timed, floating, exception items, cancelled instances, attendees with self, reminders default versus overridden, transparency to `busy`, `lifeId` round trip.
- `expand.test.ts`: daily, weekly by day, monthly by day and by position, yearly, `COUNT`, `UNTIL`, intervals, exdates, exception rows replacing and cancelling occurrences, a weekly 9 AM across a DST change, a window that starts mid-series, an all-day series.
- `sync.test.ts`: full sync pages and cursor storage per page, incremental with created, updated, deleted items, unchanged etag writes nothing, `CursorExpired` triggers resync and prunes unmentioned rows, calendar added, renamed, removed, `labels` and `hidden` survive sync, per-calendar failure isolation, `refreshIfStale` thresholds.
- `events.test.ts`: write-through readback stored, `ProviderUnavailable` leaves no row and no log, key-derived id makes a retry `unchanged`, scope `needs` on a repeating event, `this` yields an exception row, `all` shifts, `following` splits with a new id and truncated original, `following` partial failure is `rejected` with `partial`, `move` within account and rejected across, `respond` only for attendees, `cancel` requires organizer and reason, `delete` and `restore` keep the id, `duplicate` strips people.
- `accounts.test.ts`: first account becomes primary, duplicate identity rejected, `primary` swaps in one transaction, `remove` guards the primary and deletes the credential.
- `schedule.test.ts`: merge order, multi-day events on each day, declined dropped, cancelled kept, hidden excluded, timed tasks placed, todo-only behaviour unchanged with no accounts, `slots` clipping, hours, weekdays, busy versus free, `from` in the past clipped to now, freshness and warnings on a failed refresh.
- `cli.test.ts` (extended): every new command reachable from help alone, the envelope on `provider_unavailable`, occurrence refs round-tripping, `doctor` with and without accounts. All against `FakeAdapter`; a separate manually run script `scripts/google-smoke.ts` exercises the real adapter against a throwaway calendar and is not part of `bun run test`.

## The library

The library spec is `docs/vision/LEISURE.md` (D67 to D101); read it first. This part of the brief fixes how it lands in this package. Everything above still applies: `core.mutate` for every write, the store's lock and snapshot rules, the receipt and log shapes, the CLI envelope and ergonomics. The library adds one record kind, one catalog adapter per medium, and a handful of views. No todo or calendar operation changes; `contract`, `core`, `store`, `tools`, and `cli` are extended as the module map says.

First cut (D101): titles and entries, derivation, catalog lookup for all four media (TMDB, Open Library, IGDB), `year` and `time` views, `merge`, entry corrections, the four medium groups and `life media`, the skill. Second cut: `worth-getting`, `import`, named lists, the Google Books description fallback.

### Conventions that change or extend

- **Environment.** New optional settings in the root `.env`: `LIFE_TMDB_KEY` (a TMDB v4 read access token, sent as a bearer), `LIFE_IGDB_CLIENT_ID` and `LIFE_IGDB_CLIENT_SECRET` (a Twitch developer app), `LIFE_REGION` (default `US`). A missing key disables that source: lookups for its media throw `CatalogUnconfigured`, which `add` turns into a warning naming the variable and `lookup` into a rejection. Nothing fails for lack of a key.
- **Credentials.** The IGDB app token lives in `.local/igdb/token.json` (`{ accessToken, expiresAt }`), resolved from the repository root like `.local/google`. Never in a record, the log, a receipt, or stderr.
- **Network.** Only `src/media/catalog/*` talks to the sources, through the global `fetch`. `src/media/catalog/net.ts` holds its own copy of the 20 second per-request timeout and JSON reading (the calendar's helpers stay where they are), plus one retry on 429 after `Retry-After`. A whole `resolve` (search, detail, editions, availability) shares one 20 second budget through a single `AbortSignal`; when it runs out the title is created without a catalog and the warning says so. Lookups run before the write transaction, never inside it. Tests never touch the network: they use `FakeCatalog`.
- **Dates with precision.** Every date flag in the library (`--on`, `--started-on`, `--finished-on`, `--since`, `--until`) takes the precision inside the value: `2026-09-07` (day), `2026-09-07~w` (the ISO week containing that day), `2026-09` (month), `2026` (year), `?` (unknown). There is no `--approx` or `--undated`. The parser lives in `src/media/on.ts` and is reused by every command.
- **Refs by name.** Wherever a library command takes `<ref>`, it is a title id or a name. A name resolves by `normalizeTitle` among non-deleted titles of the group's medium (any medium under `life media`), then among `aliases`, then as a case-insensitive substring of `name`; exactly one hit resolves; several → `rejected` with `needs: { field: "ref", options: [ids] }` and title candidates; none → `not_found`, and when the name exists in another medium the hint names it (`found as book m_x; use life book`). Codex never has to `list` just to find an id.
- **Compact output.** `list` and every view return `TitleSummary = { id, medium, name, year, status, ownership, priority, rating, liked, timeFit, moodFit, lastEntry: { type, on, text } | null }` unless `--full`; `get` always returns the full record with `entries` and `facts`. A backlog is readable by an agent in a few hundred tokens.
- **Actors.** `import:vault` for the second-cut backfill. Everything else is `neel`, `codex`, or `agent:<name>` as usual.
- **Ids.** `ID_PREFIXES` gains `title: "m"`; `recordId`'s prefix class gains `m`. Entries carry `n_` plus ten characters from `randomSuffix()` exported by `core.ts` (one alphabet, one rejection loop), checked by a separate `entryId` regex in `contract.ts`; entries are not a store kind. `ml_` is reserved for lists.
- **Dependencies added.** None.

### Module map additions

| Module | Owns | Depends on |
|---|---|---|
| `src/contract.ts` (extended) | title, entry, facts, availability schemas and inputs; `CatalogSource`; `ID_PREFIXES.title`; `entryId`; `export type Origin` (today only the schema is exported) | |
| `src/db/schema.ts` (extended), `drizzle/0002_library.sql` (`npx drizzle-kit generate --name library`; the snapshot is generated, not written) | `titles` table with `recordColumns()` and indexes on `(json->>'medium')`, `(json->>'status')`, `(json->>'ownership')`, `(lower(json->>'name'))`, `((json->'catalog'->>'externalId'))` | |
| `src/store.ts` (extended) | `Kind`, `RecordOf`, `TABLES` gain `title` | db |
| `src/core.ts` (extended) | `SCHEMAS.title`; `randomSuffix()` exported | |
| `src/media/on.ts` | pure: the date-with-precision parser and formatter | |
| `src/media/derive.ts` | pure: entry ordering, progress and ownership derivation, current take, cycles, `allowed`, `finalize` | contract |
| `src/media/catalog/adapter.ts` | `CatalogAdapter`, `Candidate`, `Detail`, errors, `FakeCatalog` | contract |
| `src/media/catalog/net.ts` | timeout, JSON, 429 retry, shared budget | |
| `src/media/catalog/tmdb.ts`, `openlibrary.ts`, `igdb.ts` | one adapter each; `igdb.ts` owns the Twitch token | net |
| `src/media/catalog/links.ts` | pure: constructed search links (Audible, Libby, Kindle, store templates by source uid) and image URL rewriting | |
| `src/media/lookup.ts` | normalization, confidence rule, `resolve`, refresh with `edited`, ref resolution by name | adapters |
| `src/media/titles.ts` | `TitleOps` and `TitleReceipt` | core, derive, lookup |
| `src/media/views.ts` | `MediaViews` | titles, derive |
| `src/tools.ts` (extended) | `title` and `media` on the facade; `Tools.open({ catalogs })`; `export()` gains `titles`; `views.trash()` gains `titles` | |
| `src/cli.ts` (extended) | `movie`, `show`, `game`, `book`, `media` groups (`GroupName`, `GROUP_INFO`, `RefKind`, `POS.titleId`, `AnyReceipt`, `describe()`); `EnvelopeError.candidates` widened; `ask()` renders candidate tables; `doctor` gains catalog rows and `--online`; group help gains a notes hook; `ErrorCode` gains `catalog_unavailable`; `EXIT_MEANING[3]` reworded | tools |
| `../../skills/leisure/SKILL.md` | guidance for Codex and agents | the CLI |

Each module has a matching `*.test.ts`. `derive.ts`, `links.ts`, and each adapter's mapping functions are pure and get the densest tests.

`Tools.open({ catalogs })` defaults to one adapter per source, each reading its variables lazily and throwing `CatalogUnconfigured` on first use; tests pass `FakeCatalog` through the same option, and the CLI through a new `CliIo.catalogs`.

### Records

```ts
type Medium = "movie" | "show" | "game" | "book";
type Progress = "curious" | "backlog" | "active" | "paused" | "done" | "dropped";
type Ownership = "none" | "owned" | "service" | "borrowed";
type Precision = "day" | "week" | "month" | "year" | "unknown";
type On = { date: string | null; precision: Precision };     // YYYY-MM-DD, YYYY-MM, or YYYY by precision; null only with "unknown"; weeks are ISO weeks (Monday), the week containing the date
type Rating = 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;
type BookFormat = "audiobook" | "physical" | "kindle";
type CatalogSource = "tmdb" | "openlibrary" | "igdb";
type Money = { amount: number; currency: string };

type EntryType =
  | "want" | "start" | "progress" | "finish" | "pause" | "resume" | "drop" | "again" | "note"   // progress facet
  | "buy" | "borrow" | "return" | "service";                                                   // ownership facet

type Entry = {
  id: string;                         // n_ + 10
  type: EntryType;
  on: On;
  at: string;                         // recorded, ISO UTC
  actor: string;
  text: string | null;                // note text; on finish the review; on drop the reason, which doubles as the review
  progress: string | null;            // free text, D84
  format: BookFormat | null;          // books: on start, again, finish
  rating: Rating | null;              // finish and drop only, D80
  minutes: number | null;             // progress-facet entries, D100
  spend: Money & { kind: "purchase" | "iap" | "rental" } | null;   // ownership-facet entries
  where: string | null;               // buy, borrow, service
  evidence: string[];
};

type Availability = { kind: "stream" | "rent" | "buy" | "play" | "borrow" | "listen"; name: string; url: string; region: string; price: Money | null; constructed: boolean };

type Facts = {
  synopsis: string | null; genres: string[];
  people: { role: string; name: string }[];
  released: string | null;
  runtime: number | null; pages: number | null; episodes: { seasons: number; episodes: number } | null; playtime: number | null;  // minutes, pages, counts, hours
  series: { name: string; position: number | null; entries: { externalId: string; name: string; position: number | null; released: string | null }[] } | null;
  platforms: string[]; formats: string[]; language: string | null;
  links: { label: string; url: string }[];
  availability: Availability[];
  sourceRating: { value: number; scale: number; count: number | null } | null;
};

type Title = {
  id: string; medium: Medium;
  name: string; aliases: string[]; year: number | null; creators: string[]; cover: string | null;   // aliases: the names Neel used that differ from the catalog name; searched by ref resolution and list --text
  length: { minutes?: number; pages?: number; hours?: number; seasons?: number; episodes?: number } | null;
  facts: Facts | null;
  catalog: { source: CatalogSource; externalId: string; pulledAt: string } | null;
  edited: string[];                   // factual fields Neel changed by hand, kept whether or not a catalog is linked (D93)
  series: { name: string; position: number | null } | null;   // hand-set wins over facts.series
  status: Progress; ownership: Ownership;                      // derived, stored for indexing
  ownershipDetail: { where: string | null; since: On | null; price: Money | null } | null;   // derived
  priority: "now" | "soon" | "later" | null;
  moodFit: ("comfort" | "immersive" | "social" | "learning" | "low-energy")[];
  timeFit: "short" | "medium" | "long" | null;
  notes: string | null;
  detail: { format: BookFormat | null; platform: string | null; where: string | null };
  rating: Rating | null; review: string | null;   // derived
  liked: boolean;                                 // a plain title field, set by like, unlike, and --liked (D80)
  entries: Entry[];
  origin: Origin;
  version: number; createdAt: string; updatedAt: string; deletedAt: string | null;
};
```

Storage: one row per title in `titles`; entries live inside the row like comments on a task. `status`, `ownership`, `ownershipDetail`, `rating`, `review` are derived. Every `TitleOps` write returns its record through `finalize(before, after)` in `derive.ts`, which recomputes them, and `titleSchema.superRefine` rejects a record whose stored derived fields differ from `derive(entries)`, so `mutate` catches a forgotten recompute. `medium`-specific `detail` fields that do not apply are always `null`.

### Derivation (D91)

```ts
export function orderEntries(entries: Entry[]): Entry[];
export function deriveProgress(entries: Entry[]): Progress;
export function deriveOwnership(entries: Entry[]): { ownership: Ownership; detail: Title["ownershipDetail"] };
export function deriveTake(entries: Entry[]): { rating: Rating | null; review: string | null };
export function cycles(entries: Entry[]): { opened: Entry | null; closed: Entry | null; entries: Entry[] }[];
export function allowed(type: EntryType, progress: Progress, ownership: Ownership): { ok: true } | { ok: false; issue: string; hint: string };
export function finalize(title: Title): Title;
```

Order: `on` (unknown first; then date; coarser precision first on an equal date), then `at`, then type rank, then `id`. Type rank: `note` = `progress` = 0, then `want` < `start` < `again` < `resume` < `pause` < `drop` < `finish`, then the ownership types `buy` < `borrow` < `service` < `return`.

Progress is the target of the last progress transition: `want` → backlog, `start`/`again`/`resume` → active, `pause` → paused, `drop` → dropped, `finish` → done; none → curious. Ownership is the target of the last ownership entry: `buy` → owned, `borrow` → borrowed, `service` → service, `return` → none; none → none. `ownershipDetail` comes from that same entry: `where`, `since: on`, `price` from `spend` when its kind is `purchase`; `null` when ownership is `none`. `rating` is the latest closing entry (`finish` or `drop`, in order) whose `rating` is non-null; `review` is the latest closing entry whose `text` is non-null, independently.

`allowed` is judged against the title's current derived state, since that is what Neel is talking about, and applied when an entry is appended:

| Type | Allowed from | Refused with hint |
|---|---|---|
| `want` | curious | "already wanted; use start" |
| `start` | curious, backlog, paused, dropped | "already active" / "already done; use again" |
| `again` | done | "not finished; use start" |
| `resume` | paused | "not paused; use start" |
| `pause` | active | "not active" |
| `finish` | curious, backlog, active, paused, dropped | "already done; use again" |
| `drop` | backlog, active, paused | "already dropped" / "never wanted; use delete to dismiss" / "already done" |
| `progress`, `note` | any | |
| `buy`, `borrow`, `service` | any | |
| `return` | owned, borrowed, service | "nothing to return" |

When the appended entry is not last in `orderEntries` (a backdated entry), the receipt carries a warning naming the derived status and the later entry that decides it. `amend` and `unlog` skip `allowed` and re-derive; any sequence is legal after a correction.

`cycles`: an opener (`start`, `again`) opens a cycle; the next closer (`finish`, `drop`) closes it; an opener while a cycle is open closes the previous with `closed: null`; a closer with no open cycle is a cycle of one. A cycle's format is its opener's `format`, else its closer's.

### The catalog adapter

```ts
export type Candidate = { source: CatalogSource; externalId: string; name: string; year: number | null; creators: string[]; category: string | null; cover: string | null; editionCount: number | null; sourceRating: number | null; inLibrary: string | null };   // inLibrary: the title id already linked to this externalId, filled by lookup.ts
export type Detail = { name: string; year: number | null; creators: string[]; cover: string | null; length: Title["length"]; facts: Omit<Facts, "availability"> };
export class CatalogUnavailable extends Error { constructor(message: string, readonly status?: number) }
export class CatalogUnconfigured extends Error { constructor(readonly variable: string) }

export interface CatalogAdapter {
  readonly source: CatalogSource;
  readonly media: Medium[];
  search(medium: Medium, text: string, opts?: { year?: number; signal?: AbortSignal }): Promise<Candidate[]>;   // at most 10, source order
  detail(medium: Medium, externalId: string, opts?: { signal?: AbortSignal }): Promise<Detail>;
  availability(medium: Medium, externalId: string, region: string, opts?: { signal?: AbortSignal }): Promise<Availability[]>;
}
```

`lookup.ts`: two normalizations, named once. `normalizeTitle` from `tasks.ts` (lowercase, collapse spaces, no article stripping) is the duplicate check's; `normalizeLookup` (additionally strips punctuation and leading articles) is the confidence rule's. Confidence (D94): auto-link when exactly one candidate's `normalizeLookup(name)` equals the input's, its year matches when the caller gave one, and its `category` is a main work; otherwise the candidates come back, and `needs.message` names the test that failed (`several exact matches`, `no exact name match`, `year differs`) so an agent can retry with `--year` instead of asking. `resolve(medium, text, opts)` = search, confidence, `detail`, `availability`, then `links.ts` adds constructed entries (`constructed: true`). `refresh` re-pulls `detail` and `availability`, writes every factual field not in `edited` and not the hand-set `series`, and compares the result excluding `catalog.pulledAt`: when nothing differs the outcome is `unchanged` and `pulledAt` is updated with `tx.put` without a log entry or version bump, as the calendar's quiet bookkeeping does.

Source specifics, kept inside each adapter:

- **TMDB** (`movie`, `show`): `search/movie?query&year&include_adult=false&language=en-US` or `search/tv?query&first_air_date_year`; `movie/{id}` or `tv/{id}` with `append_to_response=credits,watch/providers` (valid for both); movies with `belongs_to_collection` fetch `collection/{id}` and order `parts` by `release_date` for series entries; shows have no series. Image URLs come from `configuration`, fetched once per process. Providers for `LIFE_REGION`: `flatrate`, `free`, `ads` → `stream` with `price: null`; `rent`; `buy`; every row carries the region's single JustWatch `link`. Runtime from `runtime`, or the first `episode_run_time`, else `last_episode_to_air.runtime`; shows fill `episodes` from `number_of_seasons` and `number_of_episodes`. Category is `null` for movies; a show's `type` is informational and never blocks auto-link.
- **Open Library** (`book`): `search.json?q=…&fields=key,title,author_name,first_publish_year,cover_i,edition_count,number_of_pages_median` with a descriptive `User-Agent`; `detail` fetches `works/{id}.json` (description is a string or `{ type, value }`), up to five `authors/{key}.json` for `creators`, `year` from `first_publish_date` else the earliest edition `publish_date`, and `works/{id}/editions.json?limit=50` for ISBNs and `physical_format` mapped to `formats` (`audiobook` when the text mentions audio, `kindle` for Kindle or ebook, else `physical`). Series is `null` from this source; `series.set` fills it. Duplicate works are the norm, so auto-link additionally requires the top candidate to have at least three times the `edition_count` of the second.
- **IGDB** (`game`): Twitch client-credentials token from `id.twitch.tv/oauth2/token`, cached in `.local/igdb/token.json`, refreshed within a day of expiry or on 401; every request carries `Client-ID` and the bearer. POST `games` with an Apicalypse body requesting `name, first_release_date, cover.url, summary, genres.name, themes.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, platforms.name, collections.name, collections.games.name, collections.games.id, collections.games.first_release_date, websites.url, websites.type, websites.category, external_games.uid, external_games.external_game_source, external_games.category, game_type, category, aggregated_rating, aggregated_rating_count` (both the current and deprecated type fields; the build pins whichever the API returns); `game_time_to_beats` by `game_id`, `playtime = round(normally / 3600, 1)` since values are seconds. `game_type` maps to `main`, `dlc`, `expansion`, `remake`, `remaster`, `port`, or `other`; only `main`, `remaster`, and `port` auto-link. Series entries are the collection's games ordered by `first_release_date`, `position` null. Cover URLs are rewritten from `//images…/t_thumb/` to `https://…/t_cover_big/`. Store links are built by `links.ts` from `external_games` uids through a per-source URL template (Steam, GOG, Epic, PlayStation Store, Xbox; eShop when IGDB supplies it), falling back to `websites` when no template applies. Rate limit 4 per second: the adapter serializes its own calls with a 250 ms floor.

`FakeCatalog` holds candidates and details in memory per medium, records every call, and can be told to throw `CatalogUnavailable` or `CatalogUnconfigured` or return several candidates for a text.

### Operations

```ts
export type TitleReceipt = Receipt<Title> & {
  warnings?: string[];
  candidates?: Candidate[];                       // on a catalog needs rejection
  candidateKind?: "title" | "catalog";           // on duplicate and catalog rejections
  next?: { externalId: string; name: string; position: number | null; titleId: string | null };   // on finish, when the title is in a series
};
```

The CLI lifts `TitleReceipt.warnings` into the envelope's `warnings` and nowhere else; `result` carries the receipt without them.

`TitleOps` (return `Promise<TitleReceipt>` unless noted; every entry op takes `EntryInput = { on?: On; text?; progress?; format?; rating?; liked?; minutes?; spend?; where?; evidence? }`, `on` defaulting to today at day precision; `liked` on an entry input sets the title's `liked`, not an entry field):

| Method | Behavior |
|---|---|
| `add(input: TitleAdd, ctx)` | `TitleAdd = { medium, name, year?, catalog?: externalId, lookup?: boolean (default true), want?, started?: EntryInput \| true, finished?: EntryInput \| true, seenBefore?: On \| true, liked?, priority?, moodFit?, timeFit?, notes?, detail?, allowDuplicate? }`. `seenBefore` writes a `finish` dated as given (default `?`) before the other entries, so "rewatched Arrival, still a 5" on a title not yet in the library is one call. Order: (1) in a read, the name duplicate check over every non-deleted title of the medium by `normalizeTitle`; `duplicate` with `candidateKind: "title"` unless `allowDuplicate`. (2) Outside any transaction, lookup unless `lookup: false` or `catalog` given: an auto-link or a given id yields the `Detail`; several candidates → `rejected` with `needs: { field: "catalog", options: [externalIds], message }`, `candidates`, `candidateKind: "catalog"`, nothing written; none, `CatalogUnavailable`, `CatalogUnconfigured`, or budget exhausted → no catalog and a warning. (3) In the write transaction: the externalId duplicate check (same `catalog.externalId`, any non-deleted title), then create the title (`curious`) with the detail's fields (`name` replaced by the catalog name when every token of the input appears in it, and the input kept in `aliases` when it differs), append `want` if `want`, `start` if `started`, `finish` if `finished` (a `finished` alone is a cycle of one), set `liked`, `finalize`, persist. `detail.format` on a book also becomes the `format` of the `start` or `finish` entry created here. |
| `get(ref): Promise<Title \| null>` | Deleted included. Full record. |
| `list(filter?: TitleList): Promise<TitleSummary[] \| Title[]>` | `{ medium?, status?: Progress[], ownership?: Ownership[], priority?, moodFit?, timeFit?, format?, text?, includeDeleted?, full? }`. `text` is a case-insensitive substring over `name`, `aliases`, and `creators` only; `search` is the wide one. `medium` optional, so `life media list` exists. Default excludes deleted and `dropped`, and the help text for `--status` says so. Sort: status order (active, paused, backlog, curious, done, dropped), then priority (now, soon, later, none), then name. |
| `update(id, input: TitleUpdate, ctx)` | `name, year, creators, cover, length, series, priority, moodFit, timeFit, notes, detail`; `null` clears. A change to `name`, `year`, `creators`, `cover`, or `length` adds that field to `edited`, linked or not. |
| `want`, `start`, `resume`, `pause`, `progress`, `note`, `buy`, `borrow`, `return`, `service` `(ref, input: EntryInput, ctx)` | Append one entry of that type after `allowed`; `progress` requires `progress`; `note` requires `text`; `start` and `resume` accept `progress` too, so "started it, two hours in" is one entry; `text` on any of them is the entry's note text; `buy` accepts `spend` and `where`; `minutes` is time spent in that sitting, never cumulative. `progress` or `note` on a title that is not `active` succeeds with a warning `title is <status>; use start if he is on it`. `finalize`, persist. |
| `again(ref, input, ctx, opts?: { finished?: boolean })` | Opens a new cycle; with `finished` also closes it in the same transaction with the input's `rating`, `text`, `minutes`, so a one-sitting rewatch is one call. |
| `finish(ref, input, ctx, opts?: { queueNext?: boolean })` | As above; accepts `rating`, `text` as the review, `format`, `minutes`, `liked`. When the title is in a series, the receipt carries `next` and a warning naming it; `queueNext` creates the next entry as a `backlog` title (with `want`) through `applyIn` under `itemCtx(ctx, 1)` in the same transaction, evidence `series:<titleId>`. |
| `drop(ref, input, ctx)` | Requires `text` (the reason, which is also the review, so the skill says to quote Neel fully); accepts `rating`, `liked`. |
| `amend(ref, entryId, patch, ctx)`, `unlog(ref, entryId, ctx)`, `relog(ref, entryId, into, ctx)` | `amend` changes any field including `type` and `on`; `unlog` removes the entry and returns it as `removed` on the receipt; `relog` moves the entry to another title of the same medium in one transaction, re-deriving both. No `allowed` check. |
| `rate(id, rating, ctx, opts?: { entry? })`, `unrate`, `review(id, text, ctx, opts?: { entry? })` | Sets the field on the named entry, else the last closing entry; `rejected` with hint `finish or drop first` when there is none. |
| `like(id, ctx)`, `unlike(id, ctx)` | Sets `liked` on the title. |
| `catalog.search(medium, text, opts?: { year?, availability?: boolean }): Promise<Candidate[]>` | No write. With `availability`, the auto-link match (or each candidate, at most three) carries its `availability` list, so "where can I watch X" needs no title. Throws `CatalogUnavailable` and `CatalogUnconfigured`. |
| `catalog.link(id, externalId, ctx)`, `catalog.unlink(id, ctx)` | Link pulls `detail` and `availability` and fills every factual field not in `edited`; unlink clears `catalog` and `facts`, keeps the top-level fields. |
| `catalog.refresh(ref, ctx)`, `catalog.availability(ref \| { status: "backlog" }, ctx)` | As in `lookup.ts`; on a title with no `catalog`, `refresh` runs the full `resolve` with the same `needs` path, so recovery after a missing key is one call. A source failure is `rejected` with an issue prefixed `catalog_unavailable:` (the events pattern), which the CLI maps to exit 3. Availability over the backlog runs one title per transaction so a failure stops nothing else and returns `{ refreshed, failed }`. |
| `where(ref \| { catalog: externalId, medium }): Promise<Availability[]>` | A read of `facts.availability`, or for a catalog id a live `availability` call. |
| `next(id): Promise<{ seriesEntry, title: Title \| null } \| null>`, `series(id): Promise<{ name, entries: { position, name, externalId, title: Title \| null }[] }>` | Reads. `next` is the entry after this title's position, or after its `released` when positions are null, by `series` then `facts.series`. |
| `merge(id, into, ctx)` | Moves `id`'s entries onto `into` (ids kept), unions `moodFit`, keeps `into`'s other facets, soft-deletes `id` with `notes` gaining `merged into <into>`. Both same medium. |
| `delete(id, ctx)`, `restore(id, ctx)`, `history(id)` | As for tasks. |

"Wanted again" is a done title with a `priority`; `want` is not allowed from `done`. The skill says "wants to replay X" is `update --priority`.

`MediaOps` (cross-media): `import(items, ctx, { dryRun })` is second cut (items are `TitleAdd` plus `entries: (EntryInput & { type })[]`; actor must be `import:vault`; report shape `ImportResult`). `export` is on `Tools.export()`.

### Views

`MediaViews` (all `Promise`, medium optional on each):

- `now(medium?)` → active and paused titles, active first, then by last entry `at` descending.
- `curious(medium?)` → curious titles, newest first.
- `backlog(medium?, opts?: { mood?, fit?, format?, service?, wantedAgain? })` → backlog titles with ownership not `none`, plus done titles with a `priority` when `wantedAgain`; `service` filters on `facts.availability` names; sorted priority then name.
- `buy(medium?)` → backlog titles with ownership `none`, each with `availability` filtered to `buy`, `rent`, `play`, `listen`, `borrow` and the lowest price when any.
- `shelf(medium?)` → owned titles grouped `{ done, inProgress (active, paused), untouched (backlog, curious), dropped }`.
- `diary(opts?: { medium?, since?, until?, limit? })` → `{ entries: (Entry & { titleId, titleName, medium })[] }` newest first by `on` then `at`; unknown-precision entries excluded.
- `series(id)` → as `TitleOps.series`.
- `time(opts?: { medium?, since?: On, until?: On, weeks? = 8 })` → `{ from, to, total: Bucket, weeks: (Bucket & { from, to })[], unplaced: number }` where `Bucket = { minutes: { [medium]: number }, spend: { [currency]: { purchase, iap, rental } }, titles: { id, name, minutes }[] }`, over ISO weeks; `since` and `until` clip the range so "this month" is answerable, and `total` sums the clipped range. Entries are placed by `on` at day and week precision; month, year, unknown count in `unplaced`.
- `year(year, medium?)` → `{ finished: { title, entry }[], dropped: { title, entry }[], again: number, byMedium: { medium: { count, avgRating } } }`; a finish placed by its `on` year at any precision but unknown.
- `search(text)` → non-deleted titles where name, creators, notes, review, or any entry text contains the text.

The existing `Views.trash()` gains `titles`; there is no separate media trash.

### CLI additions

Four groups sharing one command table, generated per medium with the flags that do not apply to that medium left out (so `--platform` on `book` is a usage error): `life movie`, `life show`, `life game`, `life book`. `GroupName` gains the four and `media`; `GROUP_INFO` describes each; `RefKind` gains `title`.

```text
life <medium> add <name> [--year n] [--catalog id] [--no-lookup] [--want] [--started] [--finished] [--started-on d] [--finished-on d] [--on d] [--seen-before [d]] [--rating r] [--liked] [--review s] [--progress s] [--minutes n] [--priority now|soon|later] [--mood m]... [--fit short|medium|long] [--format audiobook|physical|kindle] [--platform s] [--watched-on s] [--notes s] [--allow-duplicate]
life <medium> get <ref>
life <medium> list [--status a,b] [--ownership a,b] [--priority p] [--mood m] [--fit f] [--format f] [--text s] [--deleted] [--full]
life <medium> update <ref> [--name] [--alias s]...|--no-alias [--year|--no-year] [--creators a,b] [--cover url|--no-cover] [--series "Name" [--position n]|--no-series] [--priority p|--no-priority] [--mood m]...|--no-mood [--fit f|--no-fit] [--format f|--no-format] [--platform s|--no-platform] [--watched-on s|--no-watched-on] [--notes s|--no-notes]
life <medium> want|pause <ref> [--on d] [--text s]
life <medium> start|resume <ref> [--on d] [--progress s] [--minutes n] [--format f] [--text s]
life <medium> again <ref> [--on d] [--finished] [--rating r] [--liked] [--review s] [--minutes n] [--format f] [--text s]
life <medium> progress <ref> <text> [--on d] [--minutes n]
life <medium> note <ref> <text> [--on d]
life <medium> finish <ref> [--on d] [--rating r] [--liked] [--review s] [--format f] [--minutes n] [--queue-next]
life <medium> drop <ref> <text> [--on d] [--rating r] [--liked]
life <medium> buy <ref> [--where s] [--price n] [--currency USD] [--kind purchase|iap|rental] [--on d]
life <medium> borrow <ref> --where s [--on d]
life <medium> return <ref> [--on d]
life <medium> service <ref> --where s [--on d]
life <medium> rate <ref> <rating> [--entry n_id]
life <medium> unrate <ref> [--entry n_id]
life <medium> review <ref> <text> [--entry n_id]
life <medium> like|unlike <ref>
life <medium> where <ref> | --catalog <externalId>
life <medium> next <ref> [--queue]
life <medium> series <ref>
life <medium> lookup <text> [--year n] [--where]
life <medium> link <ref> <externalId>
life <medium> unlink|refresh <ref>
life <medium> merge <ref> <into>
life <medium> amend <ref> <entryId> [--type t] [--on d] [--text s] [--progress s] [--rating r|--no-rating] [--minutes n] [--format f] [--where s]
life <medium> unlog <ref> <entryId>
life <medium> relog <ref> <entryId> --to <ref>
life <medium> curious
life <medium> backlog [--mood m] [--fit f] [--format f] [--service s] [--wanted-again]
life <medium> buy-list
life <medium> shelf
life <medium> delete|restore|history <ref>
life media list [--medium m] [--status a,b] [--ownership a,b] [--priority p] [--text s] [--full]
life media get <ref>
life media now | curious | backlog | buy-list | shelf   [--medium m] [...]
life media diary [--since d] [--until d] [--medium m] [--limit n]
life media time [--since d] [--until d] [--weeks n] [--medium m]
life media year <yyyy> [--medium m]
life media search <text>
life media availability [--backlog | <ref>]
```

Conventions: every date flag takes the precision inside the value (`2026-09-07`, `2026-09-07~w`, `2026-09`, `2026`, `?`); `--on` defaults to today, and on `add` it is the default for whichever of `--started-on` and `--finished-on` is absent, each of which carries its own precision. `--rating` and `--review` on `add` require `--finished` or `--again`; `--liked` is allowed anywhere since it sets the title. `--progress` and `--minutes` on `add` go on the `start` entry and require `--started`. `--currency` defaults to `USD` (from `LIFE_REGION`) and `--kind` to `purchase`. `<rating>` and `--rating` accept `4.5` or `4½`. `--format` on `add` sets the wanted format and the created entry's format. `--watched-on` is the movie and show detail field; `--where` on `buy`, `borrow`, and `service` is the store, lender, or service. `like` and `unlike` are separate command definitions. `<ref>` accepts an id or a name everywhere. `--json` on a TTY never asks: a `needs` is a rejection like anywhere else.

A `needs` on `catalog` carries `candidates`; `ask()` renders them as a numbered table (`#  id  name (year)  creators  category`) and accepts either the id or the 1-based number, mapping it to `options[i-1]`; without a TTY the rejection names `--catalog <id>`. The answer re-runs `add` from scratch with `--catalog`, so the externalId duplicate check then applies. `EnvelopeError.candidates` becomes `Task[] | Title[] | Candidate[]` with `candidateKind: "task" | "title" | "catalog"`; `receiptError` and `receiptText` branch on the kind: title duplicates print id, name, year, status and name `--allow-duplicate`; catalog candidates print the table. `CatalogUnavailable` thrown by `lookup` exits 3 with error code `catalog_unavailable`; `refresh` and `availability` rejections prefixed `catalog_unavailable:` map to the same through `providerCode()`; `CatalogUnconfigured` on `lookup` exits 1 naming the variable; on `add` both are warnings. `EXIT_MEANING[3]` becomes "database, calendar provider, or catalog unavailable". `life doctor` adds: each catalog variable present or not, the IGDB token file present and not expired, `LIFE_REGION`, and with the new `--online` flag one live `search` per configured source. `life --help` lists the new groups and documents `error.candidates` as `Task[] | Title[] | Candidate[]` with `candidateKind`; `life help <medium>` for all four prints the date forms, the rating scale, the ref rule, the entry types with their allowed states, that `minutes` is per sitting, that `list` hides `dropped` by default, and where entry ids come from (`get` and `history`), through the group-help notes hook; `life help book` adds that audiobooks are books with a format.

Human output for a title: name, year, medium, status and ownership on one line, then rating, liked, priority, fits, then the diary newest first, one line per entry with date and precision marker (`~w`, `~m`, `~y`, `?`), type, and text. `where` prints one line per availability with kind, name, price, and a `*` on constructed links.

### Skill

`skills/leisure/SKILL.md` follows the todo and calendar skills: when to reach for it, how to run it, how to read the envelope, then the required behaviors. The behaviors:

- Always `--json --actor codex`. Use the name as the ref (`life book finish "Skyward"`); `list --text` only when the name is ambiguous or a `needs` on `ref` comes back. Never `list` just to find an id.
- Attach `--evidence "chat:2026-09-12 \"<his words>\""` on every write, as the todo skill requires; `--reason` on corrections, `unlog`, `relog`, and `delete`.
- On his word only: `want`, `start`, `again`, `pause`, `resume`, `finish`, `drop`, `buy`, `borrow`, `return`, `service`. Freely from what he says: `progress`, `note`, `like`. "Going into X", "started X", "on S2E4 of X" are `start` (then `progress`); "on Audible" or "on Game Pass" is `service --where` only when he says he has it, otherwise nothing; "will buy on the eShop" goes in `--notes` until `buy`.
- A mention with interest is `add` without `--want` (`curious`); a want is `--want`; a title Codex itself suggested is never added until he reacts (D99). Dismissing a `curious` title is `delete`; a wanted or active title he rejects is `drop` with his words, and the drop text becomes the title's review, so quote him fully. Check the status in the receipt or with `get` before choosing.
- Dates are when it happened: `?` for any past with no nameable month ("a while ago", "years ago"); `2026-09` or `2026` when he names one; `~w` for a weekly review; ask only when he is clearly describing a recent specific day he did not name.
- A rating only when he gives a number; "loved it" is `--liked`; "loving it so far" on an unfinished title is `like`; a mild positive ("comfy listen") is `--review` with his words, not a rating. `minutes` is one sitting's time, never cumulative: "10 hours in" is `progress` text without `--minutes`.
- A dated reflection about a title is a `note` with its full text; it does not go to the vault (D98). "Wants to replay X" is `update --priority`. A rewatch is `again --finished` in one call, or `add --seen-before --finished` when the title is new.
- Group choice: an audiobook is `book --format audiobook`; a mobile game is `game --platform`; movies are never `--started`, but a rewatch is `again`; ask when show versus movie is unclear.
- A catalog `needs` (`error.candidates`, `candidateKind: "catalog"`): pick without asking when exactly one candidate fits what he said (his year, the sequel number, the author); otherwise ask him with the candidates' names and years, then re-run with `--catalog <id>`. Retry with `--year` first when `needs.message` says `year differs` or `several exact matches`. A candidate with `inLibrary` set means the title exists: use it.
- "Where can I watch X" with no title is `lookup "X" --where`; do not `add` just to answer. After an `add`, the receipt already carries availability, so no `where` call.
- Fix a wrong title with `relog`, a wrong field with `amend`, never by re-adding. When an `add` warned `created without a catalog`, tell him which variable is missing and that `refresh` links it once the key exists.
- When a `finish` receipt carries `next`, mention it once and add it only if he says so. Report the receipt: outcome, id, status.

### Tests that must exist

- `derive.test.ts`: every sequence in the LEISURE lifecycle section; `add --finished` alone; `again` on done; `finish` after `finish` refused; `drop` from curious refused; `return` from owned; `unlog` of the only `start` leaving `progress` entries; precision ordering (unknown first, week before day on the same date); same-day start and finish; equal `at` broken by rank then id; a backdated entry warning; ownership independence and `ownershipDetail`; per-cycle rating with the title showing the latest non-null; cycle format from opener else closer; `cycles` on corrected sequences; `superRefine` rejects a stale derived field.
- `lookup.test.ts`: auto-link on a single exact match; year mismatch → candidates; DLC or edition never auto-links; Open Library edition-count rule; `CatalogUnconfigured` and `CatalogUnavailable` and budget exhaustion → created with warning on add; `edited` honored on refresh and on link; hand-set series wins; `unchanged` refresh writes only `pulledAt` without a log entry.
- Adapter mapping tests per source against recorded fixtures (JSON under `src/media/catalog/fixtures/`, no network): TMDB movie and show detail, providers by region including `free` and `ads`, collection entries ordered by release; Open Library search, work with string and object descriptions, authors, editions to formats; IGDB game with collection, external stores through templates, type mapping including `other`, cover rewrite, seconds to hours, token refresh on 401 and `Client-ID` on every request; `links.ts` for every constructed link.
- `on.test.ts`: every date form parses and formats back; ISO week containing a date; rejections for `2026-9`, `2026-09-31`, `~m`.
- `titles.test.ts`: ref by id, exact name, alias, substring, ambiguous name → `needs` on `ref`, other-medium hint; `again --finished` in one transaction; `seenBefore`; `relog` re-derives both titles; `unlog` returns `removed`; name replacement and alias on link; `progress` on a curious title warns; duplicate by name (read, before lookup) and by external id (in the transaction); `add` with `want`, `started`, `finished`, `liked`; `queueNext` under `itemCtx`; `merge` moves entries and deletes; `rate` with and without a closing entry; `catalog.link` fills only fields not in `edited` and `unlink` keeps top-level fields; `amend` changing `type` and `on`; `catalog.availability` over the backlog isolates failures; every mutation logs once and `unchanged` logs nothing.
- `views.test.ts`: summaries by default and `--full`; `time` with `since`/`until` and spend by kind; `list --text` over aliases; `now` ordering; `backlog` excludes ownership none and curious, includes wanted-again; `buy` lowest price; `shelf` four buckets; `diary` excludes unknown; `time` ISO-week placement with `unplaced`; `year` by any known precision; `search` over entry text; `trash` includes titles.
- `cli.test.ts` (extended): every new command reachable from help alone for each of the four groups and `media`; inapplicable flags are usage errors per medium; the catalog `needs` envelope, the numbered answer on a TTY, and the `--catalog` retry; a title duplicate at exit 2 with title candidates rendered; exit 3 on `lookup` when the source is down and exit 1 when unconfigured; every date form including `?` and `~w`; `4½`; `lookup --where`; `where --catalog`; `doctor` with and without keys and with `--online` against `FakeCatalog`. A manually run `scripts/catalog-smoke.ts` exercises the real sources with the keys in `.env` and is not part of `bun run test`.
