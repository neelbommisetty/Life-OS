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

## Run
- From repo root: `bun --filter=./apps/web test:e2e`
- Single spec: `bun --filter=./apps/web test:e2e -- tests/e2e/notes-selection.e2e.ts`
