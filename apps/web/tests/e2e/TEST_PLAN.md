# Web E2E Test Plan

## Scope
- Validate critical user flows for the web app using Playwright against a deterministic mock API.

## Covered Scenarios
1. Pricing page renders model catalog
   - Navigate to `/pricing`.
   - Verify pricing page header and catalog text are visible.
   - Spec: `tests/e2e/pricing.e2e.ts`

2. Notes page auto-selects first note when nothing is selected
   - Navigate to `/notes` without a `noteId` query param.
   - Verify URL is updated to include the first note id (`note-first`).
   - Verify first note content is rendered in editor preview.
   - Verify second note content is not rendered by default.
   - Spec: `tests/e2e/notes-selection.e2e.ts`

3. Chat thread switch resets to latest message after manual scroll-up
   - Navigate to `/chat` and wait for a scrollable message history.
   - Scroll up in thread A, then switch to thread B from the desktop thread list.
   - Verify latest thread B message is visible and the container is pinned near the bottom.
   - Spec: `tests/e2e/chat-thread-switch-scroll.e2e.ts`

4. Inbox proposal output review behavior (planned)
   - Navigate to `/inbox` with seeded review/progress/processed items.
   - Verify `Resolve All as No` is hidden for `PROCESSED` and `ARCHIVED` items.
   - Verify `Resolve All as No` is disabled when selected item has no unresolved outputs.
   - Verify `todo_list` outputs render structured task previews (title + optional metadata) from payload.
   - Verify malformed todo payload does not crash rendering and falls back to standard preview text.
   - Spec: `tests/e2e/inbox-proposal-review.e2e.ts` (to be added)

## Run
- From repo root: `bun --filter=./apps/web test:e2e`
- Single spec: `bun --filter=./apps/web test:e2e -- tests/e2e/notes-selection.e2e.ts`
