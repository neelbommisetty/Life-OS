# Hands: the todo list and calendar core

Working design, September 6, 2026; calendar section added September 9. Status: todo list and calendar spec agreed and both implemented in `packages/tools` (library, `life` CLI, and `skills/todo` and `skills/calendar`). The calendar's Google adapter is built; iCloud remains deferred with no build approval recorded in the current scope. This is the details level for the piece Neel calls **hands**: an agnostic, Life-OS-owned todo list, and later a calendar, with one contract that Codex, future agents, the app, and Neel from a shell all use to populate, read, update, and act. It is orthogonal to the Health and life-area experiences in [Current Vision](../vision/VISION.md); those interface with it later. It is not fancy and not published as a product: one hosted database, one repository, and that is enough.

D-numbering continues from D36 in the [August dump](../vision/legacy/2026-08-28/raw-dump.md). Each decision is marked **confirmed** (Neel said it) or **proposed** (a working position until he confirms or corrects).

Current approval and delivery are tracked in [STATUS.md](../STATUS.md). Confirmed decisions and later proposals below do not expand the approved implementation brief.

## Why hands first

Perspective and the area homes are the part of Life-OS that sees. Hands are the part that does. A todo list and a calendar are the most deterministic part of the app: their state, transitions, and queries are well understood, so they can be built once and trusted. Everything less deterministic sits on top as a client: Codex today, dedicated agents later, the phone UI, and mirrors to Todoist and Google. If an interfacing mechanism turns out wrong, it is swapped without touching what the hands hold.

## The pieces

| Piece | What it is |
|---|---|
| The todo list | One canonical list shaped like Todoist's model: Inbox, nested projects, sections, tasks with sub-tasks, comments, labels, filters. Owned by Life-OS. |
| The calendar | One schedule over connected Google calendars, iCloud next, with dated tasks shown beside events. The provider is the source; Life-OS keeps a synced copy and writes through. |
| The contract | The operations every client uses, with the rules that make them safe to call from anywhere. |
| The library | Server-side domain code over PostgreSQL. The API calls it; the CLI and web consume HTTP, as specified by the [API milestone](API.md). |
| The CLI | A client of the contract for a shell: Codex, agents, and Neel. |
| The skills | Guidance that tells Codex or an agent when and how to use the CLI. Enforcement stays in code. |
| Interfacing, later | Phone surfaces, Todoist import and mirror, agent gates, reminders. |

## The todo list

The shape follows Todoist's information architecture (D48), trimmed for one person (D50). A task lives in exactly one project. Projects nest. Sections partition a project. Tasks nest one level or more as sub-tasks. Labels are life areas (D49). Filters are the saved cross-project views.

### Records

| Record | Fields |
|---|---|
| Project | `id`, `name`, `slug`, `parentId` (nullable), `color` (optional), `layout` (`list` or `board`), `order`, `labels` (its life areas), `archived`, `system` (true only for Inbox), bookkeeping |
| Section | `id`, `projectId`, `name`, `order`, `archived`, bookkeeping |
| Task | `id`, `title`, `notes` (markdown), `projectId`, `sectionId` (optional), `parentId` (optional), `order`, `status`, `executor`, `bucket` (optional), `due` (nullable), `repeat` (optional), `deadline` (nullable date), `duration` (optional minutes), `priority` (1 to 4, optional), `labels`, `comments`, `occurrences`, `origin`, `external`, bookkeeping, `completedAt`, `deletedAt` |
| Comment | `actor`, `at`, `text`, `attachments` as name plus URL or path |
| Label | `id`, `name`, `color` (optional), `order`, bookkeeping. A label is a life area; nothing stops other uses. |
| Filter | `id`, `name`, `query`, `order`, bookkeeping |

Bookkeeping is `version`, `createdAt`, `updatedAt`. Every id is Life-OS's own, prefixed by kind (`t_`, `p_`, `s_`, `l_`, `f_`; comments live inside their task), never provider-derived.

Inbox is a system project that always exists and is the default project when `add` names none. It cannot be archived or moved.

A task's effective life areas are its own labels plus its project's labels, so a task in a Health project reads as Health without labeling each one.

### Scheduling fields

- `due` is when Neel plans to do it: a date, with an optional time that requires a timezone. A date stays a date.
- `deadline` is when it must be done by. A date only. Independent of `due` (D51).
- `repeat` is an RRULE subset: daily, weekly with days, monthly, yearly, each with an interval. A repeating task needs a due date.
- `duration` is optional whole minutes (1–43,200). The web task editor can set or clear this estimate independently of a due date. Task lists and calendar agendas show the estimate; timed task blocks use that many elapsed minutes, including across midnight or daylight-saving transitions. Date-only tasks remain all-day entries. This is calendar presentation, not a provider event or a change to free-slot calculations.

### Lifecycle

```text
proposed --accept--> accepted --start--> in_progress --complete--> done
    |                   |                    |                      |
    +------cancel-------+------cancel--------+      uncomplete <----+
```

- A task created by Neel, or by Codex relaying Neel's direct words, lands `accepted`. A task any other actor adds lands `proposed` unless it says otherwise (D13 carried). Proposed tasks are the review queue until a review surface exists.
- `complete` on a repeating task records the occurrence and advances `due`; the task stays `accepted`. `uncomplete` on a repeating task rewinds that last occurrence, using the log, at any later time rather than only from a toast.
- `uncomplete` on a done task returns it to `accepted`.
- `cancel` requires a reason and means "decided not to do this": a declined proposal or a dropped commitment. It stays visible in closed lists and history.
- `delete` is always soft (D53). It sets `deletedAt`, hides the task from every view except Trash, and keeps status and history intact so `restore` puts it back exactly as it was. Projects, sections, labels, and filters delete and restore the same way. Nothing is ever physically removed.
- Completing or deleting a parent whose sub-tasks are still open is a question, not a default (D54). The contract rejects the call until the caller says what to do with them: complete or delete them too, or leave them open. The CLI asks on an interactive terminal; the app asks in place; a script passes the choice explicitly.

### Operations

| Task | Project, section, label, filter |
|---|---|
| `add` (with duplicate check), `get`, `list` | `project.add`, `project.get`, `project.tree`, `project.update`, `project.move`, `project.reorder`, `project.archive`, `project.unarchive` |
| `update` (title, notes, priority, labels, due, deadline, duration, repeat) | `section.add`, `section.update`, `section.reorder`, `section.archive` |
| `move` (project, section, parent; a parent moves its subtree) | `label.add`, `label.update`, `label.reorder`, `label.remove` (only when unused) |
| `reorder` (an ordered list of ids within one scope) | `filter.add`, `filter.update`, `filter.remove` |
| `duplicate` (copies fields and sub-tasks, not comments or occurrences) | |
| `accept`, `start`, `complete`, `uncomplete`, `cancel`, `delete`, `restore` | |
| `assign` (executor, bucket), `reschedule` (due), `note` (a comment) | |
| `history`, `batch`, `import`, `export` | |

`batch` runs several task operations in one transaction and returns one receipt per item. By default each item succeeds or fails on its own, which is what bulk select needs; `atomic` makes it all or nothing (D52).

### Views

Views are operations in the contract, so the CLI, the app, and Codex all see the same answer.

| View | What it returns |
|---|---|
| `today` | Tasks due today or overdue, and tasks with a deadline today. |
| `upcoming` | The next N days grouped by day. Undated tasks are excluded. |
| `label` | Open tasks carrying a label, directly or through their project. |
| `filter` | The result of a saved or ad hoc query. |
| `search` | Text over title, notes, and comments. |
| `trash` | Deleted tasks, projects, sections, labels, and filters, with when and by whom, and `restore` from there. Deliberately out of the way. |

The filter grammar is a Todoist-like subset: `today`, `tomorrow`, `overdue`, `no date`, `no deadline`, `N days`, `due before: DATE`, `due after: DATE`, `deadline before: DATE`, `#project` (the project only) and `##project` (with sub-projects), `@label`, `p1` to `p4`, `assigned to: agent:name`, `status: proposed`, `search: text`, combined with `&`, `|`, `!`, and parentheses. Anything outside the subset is rejected with a message, not guessed.

## The calendar

Working design, September 9, 2026, settled with Neel question by question. The reference model is Fantastical's feature set, which Neel pasted and which is trimmed here for one person the way Todoist's was for the todo list (D55). What survives in this cut: several Google accounts in one schedule, dated tasks beside events, finding free time, answering invitations, repeating events read and written, time zones. What waits or is cut is listed at the end. Decisions are marked confirmed or proposed in the table at the end of the document.

### Authority: the provider is the source (D44)

The todo list is Life-OS canonical because nothing else wrote to it. Events are different: invitations, conferencing links, and phone alarms live in the accounts. So the source of every event is a Google or iCloud calendar, and Neel sees it no other way. There is no Life-OS-owned calendar; anything Neel authors goes on a calendar in one of the accounts. Every event still has a Life-OS id and sits in the same contract, log, and views, so the todo list and the calendar are one system to a caller even though their authority differs.

### Reads: a synced copy (D64)

Life-OS keeps a copy of every connected calendar in Postgres and every view reads the copy: accounts and tasks merge locally, search and history work from it, and each answer carries the copy's age per calendar. Sync is a pull, incremental with Google's sync tokens. A view first refreshes any calendar whose copy is older than a threshold (five minutes to start), so answers are near-live at the cost of an occasional slow first call, and a scheduled job on the Mac pulls every few minutes so the threshold is rarely hit. `sync` forces it. A failed sync is reported in the answer, not hidden, the same rule as "no silent empties".

### Writes: through the provider or not at all (D59)

A mutation calls the provider first, reads the event back, stores the copy, and returns a receipt carrying the provider id and etag. If the provider is unreachable or refuses, the operation is `rejected` and nothing is stored. There is no outbox and no pending state; a retry with the same idempotency key is the recovery. What the account cannot do, Life-OS does not pretend to do: a read-only calendar rejects writes.

### Accounts (D56, D66)

Google first, several Google accounts from the first cut, iCloud in the next pass through the same adapter interface. An account is a connection: provider, identity, a credential kept outside the database, the calendars it exposes, and when each was last synced. One account is marked primary and is the default target for new events. Google access is Life-OS's own OAuth client with the desktop flow: `life account add google` opens the browser, Neel picks the account, and the refresh token lands in `.local/`, once per account.

Task accounts. iCloud Reminders, Todoist, and Google Tasks are not task sources for the schedule. The schedule reads the Life-OS list only (D57), and those providers reach it by import or mirror into the list, later.

### Records

| Record | Fields |
|---|---|
| Account | `id`, `provider` (`google`, later `icloud`), `identity` (the email), `label`, `primary` (default target for new events), `status`, `syncedAt`, bookkeeping. Credentials live in `.local/`, never in a record. |
| Calendar | `id`, `accountId`, `name`, `color`, `timezone`, `labels` (its life areas), `writable`, `hidden`, `order`, `external` (provider id, sync cursor), `syncedAt`, bookkeeping |
| Event | `id`, `calendarId`, `title`, `notes`, `location` (text), `start`, `end`, `allDay`, `timezone` (null means floating), `repeat` (the rule and exception dates), `overrides` (per-instance changes), `status` (`confirmed`, `tentative`, `cancelled`), `organizer`, `attendees` (name, email, response), `myResponse`, `conferencing` (kind, url, read only), `reminders` (the provider's alarms, carried for the iOS app), `origin`, `external` (provider, id, etag), bookkeeping, `deletedAt` |

Ids: `a_` account, `c_` calendar, `e_` event. `v_` is reserved for sets. An occurrence of a repeating event is identified by event id plus original start, so one instance can be moved, cancelled, or answered on its own; `overrides` holds those per-instance changes, the way the providers do (D60).

### Time

Start and end are instants with a zone. An all-day event is a date span. A floating event has no zone and happens at its wall-clock time wherever Neel is. Views render in a display zone from `--tz`, `LIFE_TZ`, or the machine.

### Tasks beside events (D58)

`today` and `week` show dated tasks next to events: a task with a due time sits at its time, a task with only a due date sits in the day's all-day row. That is the whole task-to-calendar link in this cut. Time blocks, meaning events created from tasks, are out of scope and will be revisited; the record keeps no `taskId` until then.

### Capture: always explicit (D65)

There is no guessing between task and event. `life task add` and `life event add` are the entry points; Codex decides which to call and a human types one more word. An event needs a title and a start; the end defaults to one hour later, the calendar to the primary account's main calendar, and `--calendar` picks another.

### Operations

| Event | Account and calendar |
|---|---|
| `event.add`, `event.get`, `event.list`, `event.update` (title, notes, location, time, all-day, zone, repeat), `event.move` (calendar), `event.reschedule` (start, end) | `account.add` (runs the OAuth flow), `account.list`, `account.primary`, `account.sync`, `account.remove` |
| `event.respond` (accept, decline, tentative, on an invitation) | `calendar.list`, `calendar.update` (labels, hidden, order), `calendar.sync` |
| `event.cancel` (an event Neel organises; attendees are notified by the provider), `event.delete` (through the provider; the copy stays in Trash), `event.restore` (recreates at the provider under the same Life-OS id) | `sync` (every account) |
| `event.duplicate`, `event.history` | |
| `slots` (free windows of a duration inside a date window and working hours, across every connected calendar) | |

Repeating events are read and written in full (D60): `event.add` accepts a rule, and any operation on a repeating event takes `scope`, one of `this`, `following`, or `all`, the Google model. Attendees are read and answered, not authored, in this cut (D61): creating events with attendees, sending invitations, and attaching Google Meet stay in Google's own UI. The contract rules apply unchanged: actor, reason and evidence, idempotency key, receipt, log, `ifVersion`.

### Views

| View | What it returns |
|---|---|
| `today` | Today's events and dated tasks merged and ordered, plus the todo `today` lists. Invitations awaiting an answer are marked in place. |
| `week` | The same for seven days from a date, grouped by day. |
| `slots` | As above. |
| `trash` | Deleted events, with `restore`. |

Every answer carries the copy age per calendar and any sync failure. `agenda` over an arbitrary range, an `invites` list, and `search` over events come in a later pass; month, quarter, and year are the app's renderings of longer ranges once `agenda` exists. Light and dark appearance is an app concern.

### Later and cut (D62, D63)

- Later: task blocks (events created from tasks and the coupling between them); iCloud adapter; calendar sets; `agenda` over any range, `invites`, `search`; authoring attendees and Google Meet; Reminders and Google Tasks integrations; travel time, map preview, and navigation handoff, with `location` kept as text meanwhile.
- Notifications are out of scope for the web app and in scope for the iOS app later (D63). Until then the phone alarms from Google. The event record carries the provider's reminders so the iOS app has them.
- Cut: weather, location-triggered tasks, location-based set switching, favourite time zones and zone overrides beyond the `--tz` flag, public booking pages. Premium features are out of scope for now.

### Stack additions

Google Calendar API through Life-OS's own OAuth client, desktop flow, refresh tokens in `.local/`. A calendar adapter interface with Google as the first implementation and iCloud through CalDAV as the second. RRULE expansion by a library, because provider events arrive with arbitrary rules. Tables `accounts`, `calendars`, and `events` in the same store, writing to the same log. A scheduled `life sync` on the Mac. `skills/calendar/SKILL.md` follows the todo skill's pattern: rely on the view's freshness and run `sync` when it matters, `slots` before offering times, `--actor codex`, evidence on anything inferred, never `respond` to an invitation without Neel's word.

## The contract rules

These apply to every operation regardless of caller. They are what make the core safe to hand to an agent.

- **Actor on every mutation.** `neel`, `codex`, `agent:<name>`, or `import:<provider>`. No anonymous writes.
- **Reason and evidence, optional but kept.** A free-text reason and evidence references (vault paths, message ids, record ids). Required by skill for agent-created tasks; not enforced by code yet.
- **Idempotency key.** Any mutation may carry one. The same key returns the same receipt and applies nothing twice. Retries are safe.
- **Duplicate check on add (D18).** A similar title among open tasks returns candidates instead of creating. Creation proceeds only with an explicit allow-duplicate flag.
- **Receipt for every mutation.** `{ ok, id, version, outcome, issues[] }` where outcome is `created`, `updated`, `unchanged`, `duplicate`, or `rejected`. The receipt is what a caller stores and shows.
- **Append-only change log.** Every mutation writes `{ seq, at, actor, op, recordKind, recordId, patch, reason, evidence, key }`. `history` reads it. Corrections are new entries, never edits. Unchanged writes do not log.
- **Versions and optimistic concurrency.** Each record's version increments per mutation. A caller may pass `ifVersion`; a mismatch is `rejected` with the current record.
- **Validation in code.** Dates, timezones, references, and status transitions are checked before anything is written. Invalid input is rejected with issues, not coerced.
- **No silent empties.** A `list` distinguishes an empty result from a failed read. Bulk `import` reports counts and rejections per item.

"Act on" in the contract means a state transition. The world-changing work behind a task, such as booking or sending, is the executor's job; the executor records what it did through `note` and `complete` with evidence. The core never pretends an action happened.

## The CLI

Name: `life`. A thin client of the contract with conventions that make it usable by a program.

```sh
life task add "Schedule six-month dental cleaning" --due 2026-10-21 --project health/dental
life task add "Follow up on lab results" --actor codex --label health \
  --evidence "vault:Areas/Health.md#2026-09-04" --reason "Sep 4 update mentions pending labs"
life task list --filter "today & @health" --json
life today
life upcoming 7
life task complete <id>
life task move <id> --project inbox
life task history <id>
life project tree
life label add health --color green
```

Conventions: `--json` output (default when stdout is not a terminal); stable exit codes (0 ok, 1 rejected, 2 duplicate candidates, 3 database unavailable, 64 usage); `--actor` from the flag or `LIFE_ACTOR`, defaulting to `neel` only in an interactive shell; `--key` for idempotency; `--dry-run` on import; ids printed on create; timezone from `--tz`, `LIFE_TZ`, or the machine.

## The library, not a service

The contract is a TypeScript library over one hosted Postgres database (D47). The CLI imports it; the web app imports it; a future agent runtime imports it or shells out to the CLI. Nothing of ours listens on a port for this piece. If something ever needs an HTTP surface, it becomes one more client of the same library.

## The skills

`skills/todo/SKILL.md` tells Codex when to reach for the CLI and how to behave (`skills/calendar/SKILL.md` follows the same pattern once the calendar is built): always pass `--actor codex`; `list` or `search` before `add`; attach evidence; land inferred tasks as `proposed` and Neel's direct asks as `accepted`; never `complete` a task without either Neel's word or an action the executor actually performed; report the receipt back. A skill is guidance. Validation, deduplication, idempotency, and the log are in code and apply regardless of who calls.

## Interfacing, later

Each its own pass, in no fixed order. The core starts empty; nothing here is a prerequisite for building it.

- **Import from Todoist.** One-way, dry-run first. The mapping is direct because the model matches.
- **Other task integrations.** iCloud Reminders and Google Tasks, after Todoist, by the same import-then-mirror route (D57).
- **Phone surfaces.** Today, Upcoming, project list and board, as library clients inside the app.
- **Future area Plan views** can use a `label` view over the core.
- **Mirrors.** Todoist as a two-way mirror per D15, with reconciliation designed before enabling.
- **Reminders**, a notification interface over `due` and `deadline`.
- **Agent gates.** Bucket enforcement (D14).

## The stack

| Concern | Decision |
|---|---|
| Database | One hosted Postgres (Neon or Supabase), used from everywhere including local development (D47). Connection string in the ignored `.env` as `LIFE_DATABASE_URL`. Tests run in a throwaway schema on the same database. |
| Where the core lives | `packages/tools`: record schemas, validation, the store, the operations, the filter grammar. Nothing else in the repo defines what a task is. |
| Store | One table per record kind, each a JSON row plus a few indexed columns, plus `log` and `receipts`. Behind a small store interface so the driver can change without the operations knowing. |
| Runtime | Node for everything, since the Next app runs on Node and Node 26 runs TypeScript directly. Bun stays the package manager and script runner. |
| CLI | `life`, an entry in `packages/tools`, exposed as a workspace `bin`. Hand-rolled argument parsing. |
| Tests | `node:test`: validation, transitions, idempotency, duplicates, recurrence, filter grammar, log integrity, batch semantics, CLI smoke. |
| Personal data | Lives in the hosted database. `export` writes a JSON file for backup or inspection. |

## Working decisions

| # | Decision | Status |
|---|---|---|
| D37 | Build hands first: an agnostic, Life-OS-owned todo list, and later a calendar, with one contract that Codex, agents, and surfaces all use to populate, read, update, and act. Interfacing mechanisms can be tweaked afterward. Health and life-area experiences are orthogonal and come later. | Confirmed, Sept 6 |
| D38 | Life-OS is canonical for tasks from the start. Todoist becomes an import, then a mirror. Reaffirms D15; for this piece it supersedes the Sept 5 vision's provider-authoritative first phase. The calendar's authority is decided with the calendar. | Confirmed by D37 |
| D39 | One contract, many clients: operations are defined once; the CLI, the app, and skills all sit on it. | Proposed |
| D40 | Every mutation carries an actor, may carry reason, evidence, and an idempotency key, returns a receipt, and lands in an append-only change log. | Proposed |
| D41 | Task lifecycle proposed, accepted, in progress, done or cancelled, with uncomplete. Neel's asks land accepted; other actors' additions land proposed (carries D13). Duplicate check on add (carries D18). | Proposed |
| D42 | Each task has an executor; the bucket is stored now and enforced later (carries D14, D36). | Proposed |
| D43 | Superseded by D48. | Withdrawn |
| D44 | The source of every event is a Google or iCloud calendar. Life-OS keeps a continuously synced copy and writes through with readback; there is no Life-OS-owned calendar, and self-authored events go on a calendar in one of the accounts. Every event has a Life-OS id in one contract, log, and set of views. | Confirmed, Sept 9 |
| D45 | Recurrence is a rule on the record with per-occurrence completion; RRULE subset, bounded. | Proposed |
| D46 | Not fancy, not published as a product. No sign-in or network layer of our own until something needs it. | Confirmed, Sept 6 |
| D47 | One hosted Postgres from the start, used from local development too. No local database. | Confirmed, Sept 6 |
| D48 | The todo list follows Todoist's information architecture: Inbox, nested projects, sections, tasks with sub-tasks, comments with attachments, labels, filters; cross-project views Today, Upcoming, Labels, Filters, Search. Projects are containers; filters are the saved slices. Supersedes D3 and D43. | Confirmed, Sept 6 |
| D49 | Labels are life areas. A task may carry several; a project carries its areas too. | Confirmed, Sept 6 |
| D50 | Trimmed for one person: no reminders in this cut, no shareable links, no collaborators, sharing, or workspaces, no Karma. Comments keep their actor because agents write them too. | Confirmed, Sept 6 |
| D51 | `deadline` is distinct from `due`; `duration` is minutes. | Proposed |
| D52 | `move`, `reorder`, `duplicate`, and `batch` are contract operations. Uncomplete of a recurring task is a log-based rewind. | Proposed |
| D53 | Delete is always soft, with restore from an out-of-the-way Trash view. Nothing is physically removed. `cancel` remains a distinct status meaning "decided not to do this". | Confirmed, Sept 6 (cancel distinction proposed) |
| D54 | Completing or deleting a parent with open sub-tasks asks what to do with them rather than cascading or refusing by default. | Confirmed, Sept 6 |
| D55 | The calendar follows Fantastical's feature set, trimmed for one person. | Confirmed by the answers below, Sept 9 |
| D56 | Connected accounts are Google and iCloud. Google first, and Google alone is enough to start; iCloud is the next pass behind the same adapter interface. Several accounts per provider is mandatory from the first cut; one account is primary and is the default target for new events. | Confirmed, Sept 9 |
| D57 | The schedule reads tasks from the Life-OS list only. Todoist, iCloud Reminders, and Google Tasks reach it by import or mirror into the list, later. | Confirmed, Sept 9 |
| D58 | Dated tasks show beside events in the views, and that is the only task-to-calendar link in this cut. Time blocks created from tasks are out of scope, to be revisited. (An earlier answer, one coupled block per task on a Life-OS calendar, was withdrawn the same day.) | Confirmed, Sept 9 |
| D59 | Writes go through the provider first with readback. An unreachable or refusing provider is a rejection with no local change; the idempotency key is the retry. No outbox, no pending state. | Confirmed, Sept 9 |
| D60 | Repeating events are read and written in full: rule and exception dates on the event, per-instance overrides, an occurrence identified by event id plus original start, and edits with a scope of this, following, or all. | Confirmed, Sept 9 |
| D61 | Invitations are read and answered through the account in this cut. Authoring attendees, sending invitations, and attaching Google Meet stay in Google's UI for now. Finding free time returns slots, never a booking page. | Confirmed, Sept 9 |
| D62 | Later: calendar sets, `agenda` over any range, `invites`, `search`, travel time, map preview. Cut: weather, location-triggered tasks, location-based set switching, favourite time zones, booking pages. Premium features are out of scope for now. | Confirmed, Sept 9 |
| D63 | Notifications are out of scope for the web app and in scope for the iOS app later. Reminder data is kept on the event record so nothing is lost before then. | Confirmed, Sept 9 |
| D64 | Views read a synced copy in Postgres. A view refreshes any calendar whose copy is older than a threshold before answering, a scheduled pull runs on the Mac, and every answer carries the copy age and any sync failure. | Confirmed, Sept 9 |
| D65 | Capture is always explicit: `life task add` and `life event add`. No guessing between task and event. | Confirmed, Sept 9 |
| D66 | Google access is Life-OS's own OAuth client with the desktop flow, one refresh token per account in `.local/`. | Confirmed, Sept 9 |

## Open points

None for the todo list. None for the calendar: D44 and D55 to D66 are confirmed. Next step is the calendar implementation brief in `packages/tools/README.md`.
