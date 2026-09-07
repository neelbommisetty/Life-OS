---
name: todo
description: Use the `life` CLI to add, change, schedule, complete, or look at tasks in Life-OS's todo list. Reach for this any time Neel asks about tasks directly, or when a workflow surfaces something worth doing that isn't yet tracked.
---

# Todo list (`life` CLI)

Life-OS owns one canonical todo list (Inbox, nested projects, sections, tasks,
labels, filters) in Postgres. The `life` CLI is the only sanctioned way for
Codex or any agent to read or write it. Never write to the database directly.

## When to use it

- Neel asks you to add, change, schedule, complete, cancel, or delete a task.
- Neel asks what's due, overdue, upcoming, or in some project/label/filter.
- A workflow you're running surfaces something worth doing (a follow-up, a
  fix, a thing to check later) — land it as a task instead of just mentioning
  it and forgetting it.

## How to run it

From the repo root:

```
bun run life <group> <command> [args] [flags] --json --actor codex
```

or directly:

```
node packages/tools/bin/life.js <group> <command> [args] [flags] --json --actor codex
```

Always pass `--json` (parseable output) and always pass `--actor codex` (or
`--actor agent:<name>` if you are a named sub-agent). Never pass
`--actor neel` — that's reserved for Neel typing at a shell himself, and it
changes default behavior (see below).

Exit codes: `0` ok, `1` rejected/invalid, `2` duplicate candidates, `3`
database unavailable, `64` usage error.

## Required behaviors

- **Search or list before adding.** Run `life task list --text "..."` or
  `life search "..."` first so you don't create a duplicate. The CLI also
  detects near-duplicate titles and returns exit code 2 with candidates —
  when that happens, look at the candidates and either reuse one or pass
  `--allow-duplicate` if it's genuinely a new task.
- **Always attach `--evidence` and `--reason`** where the command accepts
  them, especially for `cancel` (reason required) and anything inferred
  rather than directly requested — evidence should point at what prompted
  the task (a file, a message, a command output).
- **Status on add:** land a task you inferred as `proposed` (the default for
  any non-`neel` actor). Land a task Neel directly asked for as `accepted`
  by passing `--status accepted`.
- **Never complete a task** unless Neel said it's done or you personally
  performed the action it describes. Don't guess.
- **Never delete a task** unless Neel asked you to. Cancel or leave proposed
  tasks alone otherwise.
- **Report the receipt back to Neel**: outcome (`created`, `updated`,
  `unchanged`, etc.) and the task `id`, so he can find it later.
- **Handle exit codes and `needs` rejections.** A `needs` rejection (e.g.
  deleting a task with open sub-tasks) carries `options` and a `message` —
  don't guess an answer; ask Neel the question the rejection carries and
  retry with the flag it names (e.g. `--subtasks complete|leave`).
  Exit 3 means the database is unavailable — tell Neel, don't retry in a
  loop.

## Filter grammar cheat sheet

Used by `life task list --filter "<query>"`, `life filter run <query>`, and
`life filter add <name> <query>`. It is a Todoist-like subset; anything
outside it is rejected with a message (exit 1), never guessed.

- Dates: `today`, `tomorrow`, `yesterday`, `overdue`, `no date`, `7 days`
  (due within the next 7 days), `due: 2026-09-10`, `due before: +3d`,
  `due after: today`, `deadline: today`, `deadline before: 2026-10-01`,
  `no deadline`
- Where: `#health` (that project only), `##health` (with its sub-projects),
  `#health/dental` (a slug path), `@health` (a label carried directly or
  through the project)
- What: `p1`..`p4` (priority, p1 highest), `no priority`, `subtask`,
  `recurring`, `assigned to: agent:codex` (or `executor: neel`)
- Status: `status: proposed`, `open`, `done`, `cancelled`, `all`. A query that
  says nothing about status sees open tasks only.
- Text: `search: dentist` (title, notes, comments; case-insensitive)
- Combine with `&` (and), `|` (or), `!` (not), and parentheses:
  `today & @health`, `(overdue | today) & !subtask`, `##health & status: proposed`
- `life filter run <ref|query>` tries a saved filter's name or id first, then
  parses the argument as a query, so never name a saved filter after a
  grammar term such as `overdue` or `today`.

## Worked examples

**Add something you noticed while working (inferred, not asked):**

```
life task add "Renew car registration" --project inbox \
  --evidence "found expiry notice in mail export" \
  --reason "surfaced while processing inbox" --json --actor codex
```
(status defaults to `proposed`)

**Add something Neel directly asked for:**

```
life task add "Book dentist for Mia" --project health/dental --due tomorrow \
  --status accepted --json --actor codex
```

**Look at what's due today:**

```
life today --json --actor codex
```

**Search before adding, to avoid duplicates:**

```
life task list --text "car registration" --json --actor codex
```

**Complete a task you just finished performing:**

```
life task complete t_abc123def0 --json --actor codex
```

**Handle a `needs` rejection (task has open sub-tasks):**

```
life task delete t_abc123def0 --json --actor codex
# exit 1, needs: { field: "subtasks", options: ["delete","leave"] }
# -> ask Neel, then:
life task delete t_abc123def0 --subtasks leave --json --actor codex
```

**Cancel (reason required):**

```
life task cancel t_abc123def0 --reason "no longer needed, superseded by X" \
  --json --actor codex
```
