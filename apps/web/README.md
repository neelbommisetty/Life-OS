# Life-OS web

The shared Life-OS web shell includes `/todo` and `/calendar`. Tasks have Todoist-style interactions, using Life-OS colors and typography. The task slice talks exclusively to the existing Tools HTTP API; it has no database or provider access.

See [current state and approved scope](../../docs/STATUS.md) for delivery status and future-slice boundaries.

## Run

From the repository root:

```sh
bun install
bun run api          # existing API, port 4319
# in another terminal
bun run web          # website, http://127.0.0.1:4320/todo
```

The default local connection uses the existing `.local/api/token` on the server. For another API, set `LIFE_API_URL` and `LIFE_API_TOKEN` in the website server's environment. Remote APIs require HTTPS. The API must already be migrated. Credentials never enter browser bundles or browser storage. The website has its own process and build and only requires HTTP access to the API.

```sh
bun run web:build
bun run web:start    # serve the production build at the same URL
```

`LIFE_WEB_PORT` changes the website port (default `4320`). Both development and production bind to loopback. This is a personal local website, not a multi-user or publicly authenticated deployment. Add a real user/session authentication boundary before any future hosting; do not expose the local bridge publicly.

## Task workflows

- Inbox, Today (committed due/overdue tasks), Upcoming, All tasks, review of proposed tasks, Completed, and Trash.
- Add and edit titles, descriptions, due dates/times, priority, labels, deadlines, and daily/weekly/monthly/yearly recurrence. Existing custom recurrence rules are preserved.
- Complete and reopen tasks; choose what happens to subtasks. Recurrence advances through the existing API.
- Projects and project sections; edit/archive projects; move tasks between projects/sections; list and board layouts.
- Search titles, descriptions, and comments through the API; label views include inherited project labels; save and run filters using the API's query grammar.
- Add subtasks and comments; accept proposed tasks or mark accepted tasks in progress; soft-delete and restore tasks.
- Quick add with `Q`, search with `⌘K`/`Ctrl+K`, mobile navigation, accessible modal/menu primitives, loading/empty/error states.

Writes inspect domain receipts, use idempotency keys and version checks, and never auto-retry. Form retries with unchanged input reuse their key. Duplicate creation requires an explicit separate-task choice. A stale edit is rejected; close and reopen the task to load the current version. Data refreshes on focus and every minute.

The board groups by project sections or view date groups. Drag-and-drop ordering, natural-language date parsing, collaboration, and notifications are not implemented in the task slice. Scheduled tasks also appear in the calendar slice. Existing task data is displayed as it is; there is no automatic Todoist import or real-data seeding.

## Calendar workflows

Open `/calendar` for a Fantastical-inspired layout using the current Tools calendar API. This is explicit form entry, with no natural-language parsing or AI service.

- Day, week, month, and 30-day agenda views; mini month navigation, Today, calendar visibility filters, and search within the displayed date range.
- Existing connected calendars, read-only calendars, and scheduled tasks. Task items open their existing task editor in `/todo`.
- Timed and all-day events, multi-day spans, display/event timezones, floating times, location, notes, busy/free status, and daily/weekly/monthly/yearly recurrence. Existing custom rules are preserved.
- Event creation, editing, and confirmed deletion. Recurring changes require a choice of this occurrence, following occurrences, or the entire series, using the API's scope contract.
- Dragging/resizing opens an editor for review; only Save writes the change. Keyboard users can edit the same times through event details.
- Invitation responses, organizer/guest details, and existing conference links. Invitations cannot be authored by this API milestone.
- Last-copy sync warnings, manual refresh, and periodic/focus refresh. `N` opens New event, `T` returns to today, and `⌘K`/`Ctrl+K` focuses search outside input fields.

The API still owns recurrence expansion, sync, provider write-through and validation. Writes use receipt checks, stable retry keys and record versions; a failed or uncertain write stays in the editor. All-day “Last day” is inclusive in the UI and converted to the API's exclusive end date. Ambiguous or nonexistent times at a daylight-saving transition require an explicit unambiguous time (UTC is available). Calendar filter selections are local to the current page. Connect/reconnect accounts through the existing CLI; the website does not add an OAuth flow, attendee authoring, weather, notifications, or scheduling proposals.

FullCalendar provides the calendar grid and overlap/drag behavior; Luxon handles named timezones. Calendar code loads only when visiting the calendar route. On phones, day view opens by default; week/month grids scroll inside their own region and the shared drawer holds the date picker and calendars.

## Shared shell and future slices

Read the [Life-OS design system](../../docs/DESIGN.md) before building another slice. It records the finalized ocean-blue palette, typography, spacing, shared components, states, responsive behavior, and extension rules. This is the shared identity for all Life-OS web slices: light cool surfaces and pale blue primary controls with readable blue text.

- `src/tokens.css`: primitive and semantic design tokens, exported to `docs/DESIGN.json`.
- `src/theme.css`, `src/shell.css`: shared typography, controls, overlays and responsive workspace frame.
- `src/ui.tsx`: shared Button, IconButton, Badge and Radix overlay primitives.
- `src/Shell.tsx`: Life-OS identity, workspace framing, and navigation slots.
- `src/App.tsx`, `TaskEditor.tsx`, `todo.css`, `model.ts`: the todo slice.
- `src/CalendarApp.tsx`, `EventEditor.tsx`, `calendar-model.ts`, `calendar.css`: calendar views, explicit event forms, date conversion, and slice styling.
- `src/data.ts`: shared typed HTTP client and task query loading.
- `server/bridge.ts`: explicit allowlist for implemented task and calendar operations. The bridge keeps the API token on the server, checks same-origin JSON requests and Host/Origin, blocks redirects, and does not proxy unrelated operations.
- `server/index.ts`: independent Node web server with Vite development middleware or built static assets.

Future `/projects` or other slices can reuse the shell, design tokens, and HTTP client. Add their actual navigation and allowlisted operations when those slices are implemented. No placeholder pages or unrelated API services are introduced here.

## Verification

```sh
bun run typecheck
bun run test
bun run web:build
```

Web tests cover the bridge's credential/origin boundary, domain rejection passthrough, no write retries, date/view semantics, calendar date/DST semantics, recurring changes, invitation responses, failed refreshes, and the full task lifecycle through real HTTP into a disposable PostgreSQL schema. They use fake providers and do not call external services.

For manual browser verification with disposable, clearly synthetic data:

```sh
bun run --cwd apps/web test:preview
# open http://127.0.0.1:4321/todo or /calendar
# Ctrl+C drops the disposable schema and stops its servers
```

Build first. This fixture uses an isolated schema, not the personal/public schema. Screenshots or other personal runtime artifacts belong in ignored `.local/`.

## Design system development

```sh
bun run --cwd apps/web design:dev
# http://127.0.0.1:4322/design-system.html
bun run --cwd apps/web design:tokens  # export after changing tokens.css
bun run --cwd apps/web design:check   # verify the export stays in sync
```

The development catalog uses real shared components and synthetic examples with no API access. It is not part of product navigation or the production build. Read [docs/DESIGN.md](../../docs/DESIGN.md) for contracts, examples, accessibility, responsive behavior and extension rules.

The [palette showcase](http://127.0.0.1:4322/palettes.html) displays the finalized ocean-blue theme using the real shared tokens. Its sample content has no API access.
