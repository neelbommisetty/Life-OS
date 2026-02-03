# iOS Companion App (Capture + Inbox) — Design Plan (v0 → v2)

Date: 2026-02-03  
Project: Life-OS  
Scope: iOS companion focused on input flow + (later) notifications

## 1) Summary

Build a native iOS companion app with:
- **One editable “canvas”** that supports typing + voice dictation
- A **Submit → Inbox** flow where each submission becomes a **Note** in Life-OS
- An **Inbox list** showing prior submissions from iOS
- Per-inbox-item actions to:
  1) Extract **tasks** from the inbox note (AI) → user approves → tasks created
  2) Extract **knowledge notes** from the inbox note (AI) → user approves → notes created
  3) Offer “Mark processed” as part of the approval flow
- Once processed, the underlying inbox note is **soft-deleted after 30 days** using the same “auto-archive during list fetch” approach used for Tasks

Notifications are explicitly **v1/v2**, not v0.

## 2) Goals / Non-Goals

### Goals
- Fast capture with minimal friction (“open → speak/type → submit”).
- Robust drafting UX (don’t lose text on failures).
- Inbox is “project-adjacent”: capture first, categorize later.
- AI extraction with user approval and idempotent outcomes.
- Simple retention: processed inbox notes auto-archive after 30 days.

### Non-Goals (v0)
- Push notifications (APNs).
- Background processing or background uploads.
- Full “Projects/Tasks/Notes” management UI in iOS (beyond inbox processing).

## 3) User stories

### Capture
- I can type text into a single canvas.
- I can tap a mic icon and speak; transcribed text is appended to the **end** of the canvas.
- I can edit any part of the canvas at any time.
- I can submit the canvas, clearing it only when the submission succeeds.

### Inbox
- I can see past inbox items that I entered from iOS.
- I can open an inbox item and review it.
- I can run “Extract tasks” and “Extract notes”.
- I can approve proposals (individual + approve all).
- During approval I can optionally mark the inbox item processed.

### Retention
- Once an inbox item is processed, it will be archived (soft-deleted) after 30 days.

## 4) iOS app UX spec (v0)

### Screen A — Canvas
- Full-screen editable text canvas (`TextEditor`).
- Mic icon:
  - Requests Speech + Microphone permissions as needed.
  - Voice transcription appends to the **end** of the canvas (never inserts at cursor).
  - If permission denied, show inline explanation + link to Settings.
- Submit button:
  - Creates an inbox note (server) and clears canvas on success.
  - On failure, keep canvas text and show retry.

**Append rule**
- “Always append at end” for voice transcription.

### Screen B — Inbox list
- List of inbox items (default: open/unprocessed).
- Each row shows title, preview snippet, created time, processed badge if applicable.
- Tap → Inbox detail.

### Screen C — Inbox detail (v0)
- Shows note title + full content.
- Editing allowed only while “pre-extraction” (v0 has no extraction yet; v1 will enforce locking).

## 5) Backend data model (Prisma)

Current core models: `Project`, `Task`, `Note`, `Chat*`, `AiCall`.

### Add: InboxItem (project-adjacent)

Purpose: track “this Note came from iOS inbox” + processing lifecycle while keeping the content in `Note`.

Proposed fields:
- `id: String @id @default(cuid())`
- `userId: String`
- `noteId: String @unique`
- `source: String` (start with `"IOS"`)
- `lockedAt: DateTime?` (set once extraction begins; prevents edits)
- `processedAt: DateTime?`
- `createdAt: DateTime @default(now())`
- `updatedAt: DateTime @updatedAt`

Relations:
- `InboxItem.note -> Note` (1:1)
- `Note.inboxItem -> InboxItem?`

### Add: Proposal tables (v1)

These make approvals idempotent and auditable.

`InboxProposedTask`:
- `id`, `inboxItemId`
- fields mirroring `Task`: `title`, `description?`, `dueDate?`, `priority?`
- `suggestedProjectId?`, `finalProjectId?`
- `approvedAt?`, `rejectedAt?`
- `createdTaskId?` (set once created; prevents duplicates)
- timestamps

`InboxProposedNote`:
- `id`, `inboxItemId`
- fields mirroring `Note`: `title`, `content`
- `suggestedProjectId?`, `finalProjectId?`
- `approvedAt?`, `rejectedAt?`
- `createdNoteId?`
- timestamps

### Extend: AiCallType (v1)

Add:
- `INBOX_EXTRACT_TASKS`
- `INBOX_EXTRACT_NOTES`

## 6) Auth for iOS (MVP)

You requested “Full Neon Auth login”.

Constraint: the current web app uses Neon Auth with Next.js session/cookies; a native iOS app generally needs a token-based API auth mechanism for reliable `URLSession` requests.

Decision:
- iOS performs Neon Auth login via `ASWebAuthenticationSession` to the existing `/auth/*` flow.
- After login, iOS mints a **Companion API token** (revocable) and uses `Authorization: Bearer <token>` for subsequent API calls.

Add model:
- `CompanionToken`:
  - `id`, `userId`, `tokenHash`, `deviceName?`, `lastUsedAt?`, `revokedAt?`, timestamps

Add web handoff flow:
- `GET /auth/companion` (web):
  - Requires Neon Auth session.
  - Mints token and deep-links back to iOS (`lifeos://auth?token=...`), or displays a QR for scanning.

API auth rule:
- Accept Neon Auth cookie session (web) OR companion bearer token (iOS).

## 7) API surface (Next.js App Router)

Add `src/app/api/inbox/**` routes.

### v0 routes

`POST /api/inbox/items`
- Body: `{ content: string }`
- Server derives title from first non-empty line:
  - `title = firstLine.trim().slice(0, 500)`
  - `content = full canvas` (enforce note max length; reject > 100k or truncate with a marker)
- Creates `Note` + `InboxItem`.

`GET /api/inbox/items?status=open|processed|all&cursor&limit`
- Returns list for the authenticated user.

`GET /api/inbox/items/:id`

`PATCH /api/inbox/items/:id`
- Allowed only if `InboxItem.lockedAt IS NULL` AND `processedAt IS NULL`.
- Updates the note content + re-derives the title from first non-empty line.

### v1 routes

`POST /api/inbox/items/:id/extract/tasks`
- Sets `lockedAt` if null.
- Runs extractor; writes `InboxProposedTask[]`.

`POST /api/inbox/items/:id/extract/notes`
- Sets `lockedAt` if null.
- Runs extractor; writes `InboxProposedNote[]`.

`POST /api/inbox/items/:id/approve`
- Body includes:
  - `approveTaskIds: string[]`
  - `approveNoteIds: string[]`
  - `projectOverrides?: Record<string, string | null>`
  - `markProcessed?: boolean`
- Creates Tasks/Notes for newly-approved proposals only (idempotent via `createdTaskId/createdNoteId`).
- If `markProcessed`, sets `processedAt = now`.

## 8) AI extraction services (v1)

Add new server-side services registered in the existing AI registry (not user-configurable UI):
- `extractTasksFromInboxNote(noteContent, userProjects, userContext?)`
- `extractNotesFromInboxNote(noteContent, userProjects, userContext?)`

Model selection:
- “Cheapest + failover fallback” internally.
- Configurable later by you (admin/dev), not by end users.

Output schemas:
- Tasks: `{ title, description?, dueDate?, priority?, suggestedProjectId? }[]`
- Notes: `{ title, content, suggestedProjectId? }[]`

## 9) Processing state machine

States for an InboxItem:
- `OPEN`: `processedAt = null`
- `LOCKED`: `lockedAt != null` (no editing)
- `PROCESSED`: `processedAt != null`

Rules:
- Editing is allowed only while OPEN and not LOCKED (i.e., before first extraction).
- Extraction sets LOCKED.
- Approval can optionally set PROCESSED (“Mark processed” option in approval flow).

## 10) Archiving (Task-style auto-archive)

Requirement: “use the same logic as tasks for archiving notes as well”.

Implement opportunistic auto-archive on list fetch paths (no cron):
- In `listNotes(...)` and in the inbox list API handler:
  - `now = new Date()`
  - `thirtyDaysAgo = now - 30 days`
  - `updateMany` to set `Note.deletedAt = now` for notes where:
    - `userId` matches
    - `deletedAt IS NULL`
    - linked `inboxItem.processedAt < thirtyDaysAgo`

This makes processed inbox notes disappear from default lists naturally, since existing note queries already filter `deletedAt: null`.

## 11) iOS + Web processing UI (v1)

You want “Either” (iOS + web can process).

Inbox detail shows:
- Source note content (read-only after lock)
- Buttons: Extract tasks, Extract notes
- Proposal sections with checkboxes + “Approve all”
- Approve action includes “Mark processed” option

## 12) Milestones

### v0 — Capture + Inbox (no extraction)
- iOS: Canvas + Inbox list + detail
- Backend: create/list/update inbox notes with locking rule stubbed

### v1 — Extraction + Approval + Processed
- Backend: proposal tables, extraction services, approval endpoint
- UI (iOS + web): extract + review + approve + mark processed

### v2 — Notifications
- Start with local notifications (daily inbox reminder / stale item nudge).
- Consider APNs later if needed.

## 13) Tests / acceptance

Backend (Bun):
- Inbox create/list/update permissions (401 unauth)
- Update disallowed after locked or processed
- Extraction writes proposals and sets `lockedAt` once
- Approval idempotency (no duplicate tasks/notes on re-approve)
- Auto-archive sets `deletedAt` for eligible processed inbox notes (during list)

Manual:
- Voice transcription appends at end and does not clobber edits
- Submit clears canvas only on success
- Inbox list reflects new submission
- Post-extraction: editing disabled
