---
name: todo
description: Use the `life` CLI to add, change, schedule, complete, or look at tasks in Life-OS's todo list. Reach for this any time Neel asks about tasks directly, or when a workflow surfaces something worth doing that isn't yet tracked.
---

# Todo list (`life` CLI)

Life-OS owns one canonical todo list (Inbox, nested projects, sections, tasks,
labels, filters) in Postgres. The `life` CLI is the only sanctioned way for
Codex or any agent to read or write it. Never write to the database directly.

This skill says when to use the CLI and what Neel expects of you. It is not the
manual: the CLI documents itself. Start from `life --help`, then
`life help <group>` (task, project, section, label, filter) and
`life help <group> <command>` for every flag, its type and allowed values,
examples, and exit codes. `life help filter` prints the query grammar.
`life doctor` checks the setup when anything looks wrong.

## When to use it

- Neel asks you to add, change, schedule, complete, cancel, or delete a task.
- Neel asks what's due, overdue, upcoming, or in some project/label/filter.
- A workflow you're running surfaces something worth doing (a follow-up, a
  fix, a thing to check later): land it as a task instead of just mentioning
  it and forgetting it.

## How to run it

From the repo root: `bun run life ...` or `node packages/tools/bin/life.js ...`.

Always pass `--json` and `--actor codex` (or `--actor agent:<name>` if you
are a named sub-agent). Never pass `--actor neel`: that is reserved for Neel
at a shell, and it changes defaults (his tasks land `accepted`).

## Reading the output

With `--json` (or whenever stdout is not a terminal) stdout holds exactly one
JSON object and nothing else; diagnostics go to stderr:

```
{ ok, command, exitCode, result?, error?: { code, message, issues, hint?, needs?, candidates? }, warnings? }
```

- `result` is the library's return value untouched: a receipt
  (`{ ok, outcome, id, version, record, issues }`), a record, a list, or a view.
- `error.code` is one of `usage`, `rejected`, `duplicate`, `needs`,
  `not_found`, `db_unavailable`, `internal`. `error.hint` always says what to
  do next: read it before retrying.
- Exit codes: `0` ok, `1` rejected/invalid/not found, `2` duplicate
  candidates, `3` database unavailable, `64` usage error (unknown command or
  flag, missing argument; the message suggests the closest name and stderr
  shows that layer's help).

## Required behaviors

- **Search or list before adding.** Run `life search "..."` or
  `life task list --text "..."` first so you don't create a duplicate. The CLI
  also detects near-duplicate titles: exit `2`, `error.code: "duplicate"`,
  the candidates in `error.candidates`. Reuse one, or pass `--allow-duplicate`
  if it is genuinely new.
- **Always attach `--evidence` and `--reason`** (both are global flags on
  every write), especially for `task cancel` (`--reason` required) and for
  anything inferred rather than directly requested. Evidence points at what
  prompted the task: a file, a message, a command output.
- **Status on add:** a task you inferred lands `proposed` (the default for any
  non-`neel` actor). A task Neel directly asked for gets `--status accepted`.
- **Never complete a task** unless Neel said it's done or you personally
  performed the action it describes. Don't guess.
- **Never delete a task** unless Neel asked you to. Cancel or leave proposed
  tasks alone otherwise.
- **Report the receipt back to Neel**: the outcome (`created`, `updated`,
  `unchanged`) and the task `id`, so he can find it later.
- **Handle `needs` errors.** `error.code: "needs"` (for example completing or
  deleting a task with open sub-tasks) carries `error.needs`
  `{ field, options, message }`. Don't guess: ask Neel the question in
  `message`, then retry with the flag `error.hint` names
  (`--subtasks complete|leave`, `--contents delete|inbox`, ...).
- **Exit 3 means the database is unavailable.** Run `life doctor`, tell Neel
  what it reports, and don't retry in a loop.
- **Bad references:** `error.hint` sends you to `life project tree`,
  `life label list`, or `life filter list`; run it and use the id or path it
  shows. A rejected filter quotes the grammar line that applies.

## Filter grammar cheat sheet

Used by `life task list --filter "<query>"`, `life filter run <query>`, and
`life filter add <name> <query>`; the full version is `life help filter`.

- Dates: `today`, `tomorrow`, `yesterday`, `overdue`, `no date`, `7 days`,
  `due: 2026-09-10`, `due before: +3d`, `due after: today`,
  `deadline: today`, `deadline before: 2026-10-01`, `no deadline`
- Where: `#health` (that project), `##health` (with sub-projects),
  `#health/dental` (a slug path), `@health` (a label, direct or via project)
- What: `p1`..`p4` (p1 highest), `no priority`, `subtask`, `recurring`,
  `assigned to: agent:codex`
- Status: `status: proposed`, `open`, `done`, `cancelled`, `all`; a query that
  says nothing about status sees open tasks only
- Text: `search: dentist` (title, notes, comments; case-insensitive)
- Combine with `&`, `|`, `!`, parentheses: `(overdue | today) & !subtask`

## Worked examples

```
# Inferred while working (lands proposed):
life task add "Renew car registration" --project inbox \
  --evidence "found expiry notice in mail export" \
  --reason "surfaced while processing inbox" --json --actor codex

# Neel asked for it directly:
life task add "Book dentist for Mia" --project health/dental --due tomorrow \
  --status accepted --json --actor codex

# What's due today; search before adding:
life today --json --actor codex
life search "car registration" --json --actor codex

# Complete something you just did; cancel with a reason:
life task complete t_abc123def0 --json --actor codex
life task cancel t_abc123def0 --reason "superseded by X" --json --actor codex

# A needs error, then the retry with the flag the hint named:
life task delete t_abc123def0 --json --actor codex
#   -> exit 1, error.code "needs", error.needs.options ["delete","leave"]; ask Neel, then:
life task delete t_abc123def0 --subtasks leave --json --actor codex

# Something is off: check the setup, or see what went wrong in detail.
life doctor --json
life task add "x" --project health --json --actor codex --verbose
```
