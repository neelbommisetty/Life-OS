# Task duration from editor to calendar

Status: complete locally
Owner: Codex for Neel
Last updated: September 29, 2026
Branch/worktree: `codex/task-duration` in `/Users/neel/products/Life-OS`
Approval: Neel's September 29 request to find and build one thing end to end, within the existing approved todo/calendar web slices.
Related contracts: [Hands](../specs/HANDS.md), [architecture](../architecture/ARCHITECTURE.md), [web guide](../../apps/web/README.md).

## Outcome and boundaries

Create, edit and clear a task's estimated duration in minutes; show it in task lists and calendar agendas; render timed calendar tasks with their saved duration. Reuse existing task API validation, version checks, receipts and persistence. Date-only tasks remain all-day entries. Tasks without duration retain the calendar's default display length. No provider events or free-slot calculations change.

## Remaining work

None for this slice. Authentication/connector/agent work remains in its separate approved plan.

## Acceptance and verification

Creation and reopening preserve minutes; edits change the calendar block; clearing removes the estimate. Only whole minutes from 1 through 43,200 are valid. An unscheduled estimate does not schedule a task. Verify `bun run typecheck`, `bun run test`, `bun run web:build`, and design export consistency. Browser checks use the disposable preview only.

Actual results:

- `bun run typecheck`, `bun run web:build`, and `bun run --cwd apps/web design:check` passed.
- `bun run test`: 636 tools tests passed. The added web integration initially expected HTTP 400 for invalid duration; the existing contract returns an HTTP 200 envelope containing a rejected receipt. Corrected that assertion; `bun run test:web` then passed all 16 web tests (652 tests across both packages).
- Integration checks cover create/readback, schedule data, resize, idempotent retry, stale version rejection, clearing, an unscheduled estimate, and invalid values 0, -1, 1.5 and 43,201 through the web bridge and real HTTP API with a disposable database.
- Calendar mapping tests cover explicit and fallback timezones, midnight, both DST transitions, missing estimates and date-only tasks.
- Browser at desktop and 390×844: created 45 minutes, reopened, edited to 90 minutes at 2 PM, verified calendar 2–3:30 PM and agenda metadata, followed the calendar task back to the editor, rejected fractional minutes, cleared/saved/reopened with an empty estimate. Shared phone layout and keyboard field navigation were visually checked. Evidence: ignored `.local/task-duration-calendar.png`.

## Completion

Developed on `codex/task-duration`; Neel subsequently explicitly requested committing and pushing this delivery to `main`. Updated STATUS, Hands, web runbook and design field guidance. The existing API/CLI duration contract, server responsibilities and architecture boundaries are unchanged, so no architecture or API/CLI skill edits were needed. No dependencies or theme tokens changed. No deployment or personal-data changes.
