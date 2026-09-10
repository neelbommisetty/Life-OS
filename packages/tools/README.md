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
