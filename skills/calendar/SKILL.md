---
name: calendar
description: Use the `life` CLI to read and change Neel's schedule — accounts, calendars, events, free time — across his connected Google (and later iCloud) calendars. Reach for this any time Neel asks about his schedule, free time, or an invitation, or when a workflow surfaces an event to add or move.
---

# Calendar (`life` CLI)

Every event lives on a real Google (or, later, iCloud) calendar; Life-OS keeps
a synced copy in Postgres and every read comes from that copy. The `life` CLI
is the only sanctioned way for Codex or any agent to read or write it. Never
write to the database directly, and never talk to Google's API directly —
every write goes through the provider from inside the CLI.

This skill says when to use the CLI and what Neel expects of you. It is not
the manual: the CLI documents itself. Start from `life --help`, then
`life help <group>` (account, calendar, event) and `life help <group>
<command>` for every flag, its type and allowed values, examples, and exit
codes. `life help event` also prints the `When` formats and the scope rules
for repeating events. `life doctor` checks the setup when anything looks
wrong (Google client id present, each account's status and token refresh,
calendar copy ages).

## When to use it

- Neel asks what's on his schedule, today, this week, or on some date.
- Neel asks for free time, or asks you to find or offer a time.
- Neel asks you to add, move, reschedule, cancel, or delete an event.
- Neel asks about an invitation (whether he's accepted, what's pending).
- A workflow you're running surfaces something that belongs on the calendar
  as a commitment at a time — land it as an event, not a task.

`event add` and `task add` are different things: a commitment at a time with
a place or people is an event (`life event add`); a thing to do, with no
fixed slot, is a task (`life task add`). When it's ambiguous, ask.

## How to run it

From the repo root: `bun run life ...` or `node packages/tools/bin/life.js ...`.

Always pass `--json --actor codex` (or `--actor agent:<name>` if you are a
named sub-agent). Never pass `--actor neel`: that is reserved for Neel at a
shell.

## Reading the output

Same envelope as the todo list:

```
{ ok, command, exitCode, result?, error?: { code, message, issues, hint?, needs?, candidates? }, warnings? }
```

- `result` is the library's return value: a receipt
  (`{ ok, outcome, id, version, record, issues }`), a record, a list, or a view
  (`today`, `week`, `slots` carry `freshness` and `warnings` too).
- Exit codes: `0` ok, `1` rejected/invalid/not found, `2` duplicate
  candidates, `3` database or calendar provider unavailable, `64` usage
  error. `3` also covers `provider_unavailable` (the provider couldn't be
  reached); `provider_rejected` (the provider refused the write) exits `1`.
  Either way nothing was stored — retry with the same `--key` once the
  problem is fixed.

## Required behaviors

- **Trust the view's freshness; don't sync just to be sure.** `today`,
  `week`, and `slots` refresh any calendar whose copy is older than
  `LIFE_CAL_MAX_AGE` (5 minutes) before answering, and report `freshness`
  and any refresh failure in `warnings` — they never hide a stale or failed
  answer behind an empty one. Run `life sync` only when Neel says something
  just changed and you need it reflected immediately; don't run it as a
  reflex before every read.
- **Run `life slots` before offering times, and quote the slots as given.**
  Never invent a free window and never turn a slot into a booking page or
  link — just read it back (`life slots --duration 30 --json`).
- **Never `event respond` to an invitation without Neel's explicit word.**
  Same for `event cancel` and `event delete`: only on his direct instruction,
  never because a workflow inferred it would help. `event cancel` also
  requires `--reason`.
- **Occurrence refs.** Every list prints an occurrence ref
  (`e_xxxxxxxxxx@2026-09-10T16:00:00Z`) for a repeating event's instance;
  copy it straight into `update`, `reschedule`, `respond`, `cancel`, or
  `delete` rather than reconstructing it. A bare event id (`e_...`) means the
  whole series.
- **Scope on a repeating event.** `update`, `reschedule`, `cancel`, and
  `delete` need `--scope this|following|all` on a repeating event; without
  it you get a `needs` error naming the options — ask Neel rather than
  guessing which scope he means. `respond` takes `--scope this|all`.
- **Report the receipt back to Neel**: the outcome (`created`, `updated`,
  `unchanged`, `rejected`) and the event id or occurrence ref, so he can find
  or reference it later.
- **Attendees are read and answered, not authored.** Don't try to invite
  people or attach a Google Meet link through this CLI — that stays in
  Google's own UI in this cut.
- **Exit 3 means the database or the calendar provider is unavailable.** Run
  `life doctor`, tell Neel what it reports, and don't retry in a loop.
- **Bad references:** `error.hint` sends you to `life account list` or
  `life calendar list --hidden`; run it and use the id, identity, or label it
  shows.

## Worked examples

```
# What's on today, and this week:
life today --json --actor codex
life week --from tomorrow --days 5 --json --actor codex

# Free time before offering a slot:
life slots --duration 30 --from tomorrow --to +5d --json --actor codex

# Neel asked for a meeting to be added:
life event add "Dentist" --start "2026-09-15 16:00" --duration 45 \
  --location "12 Main St" --actor codex --json

# An all-day event:
life event add "Team offsite" --date 2026-09-20 --days 2 \
  --calendar work@example.com/Work --actor codex --json

# Moving something Neel asked to move:
life event reschedule e_abc123def0 --start "2026-09-16 10:00" \
  --actor codex --json

# A repeating event needs a scope, then the retry with the flag the hint named:
life event update e_abc123def0 --location "New office" --actor codex --json
#   -> exit 1, error.code "needs", error.needs.options ["this","following","all"]; ask Neel, then:
life event update e_abc123def0 --location "New office" --scope all --actor codex --json

# Something is off: check the setup, or see what went wrong in detail.
life doctor --json
life event add "x" --start today --json --actor codex --verbose
```
