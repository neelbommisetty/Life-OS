# Inbox Capture Layer + iOS Companion App (MVP)

Date: 2026-02-13
Updated: 2026-02-15
Owner: Life-OS

## Summary

This document is the **current source of truth** for:

- The product concept of `Inbox` as a capture layer, and
- The **iOS companion app MVP** flow and screens for Capture + Inbox.

It supersedes older iOS companion planning docs (notably `2026-02-03-ios-companion-inbox-design.md`).

## iOS Companion App (MVP)

### Launch flow

1. App always starts on a Splash / bootstrapping screen.
2. During splash, check whether a user session exists.
3. If not logged in → show the existing login experience.
4. If logged in → show a 3-tab app:
   - Capture (default)
   - Inbox
   - Settings (keep existing screen)

### Tabs

#### 1) Capture (default)

UI requirements:

- A single “canvas” for typing.
- A single primary mic button.
- Real-time transcription should appear in the canvas while recording.
- A **discoverable Save** action persists the capture as an Inbox item.
- Ignore all other UI elements from reference screenshots.

Behavior:

- Tap mic → request Speech + Microphone permissions and begin transcription.
- Tap mic again → stop transcription.
- Save → creates a new `InboxItem` and clears the capture canvas.

#### 2) Inbox

UI requirements:

- Shows all saved Inbox items (newest first).
- Tap item → detail screen with full content.

#### 3) Settings

- Keep the existing settings/account UI and sign-out behavior.

### MVP data model (iOS)

- `InboxItem`
  - `id`
  - `created_at`
  - `content` (plain text)

### Persistence / sync

- MVP is **local-first**: saving must work offline and be instant.
- Server sync is a follow-up:
  - best-effort upload on save when authenticated
  - fetch + merge on app start / inbox open

## Inbox (Product Concept)

`Inbox` is a dedicated capture layer, not a project. Users save quick notes as `InboxItem`s.

## Goals

- Provide a fast, low-friction capture surface for unstructured thoughts.
- Convert captured text into structured outputs through agent proposals.
- Keep user control explicit via per-output approve/decline actions.
- Reduce UI clutter with automatic archival while preserving history.

## Non-Goals (V1)

- Inbox as a hidden project.
- Editing or versioning `InboxItem`s after save (beyond the initial MVP editor).
- Multi-user or shared-workspace permissions.
- Global search integration for Inbox content.
- Automatic project assignment for created todos.
- Re-running agents for processed or archived items.

## Core Concepts

### Inbox Entity

- `Inbox` is a first-class entity of its own, separate from projects.
- `Inbox` is capture-only and has dedicated views.
- `InboxItem` behavior mirrors current note behavior for content entry/rendering.

### Agent Outputs

- Agents do not directly mutate user data before approval.
- Agents generate proposal outputs shown to the user.
- Example outputs in V1:
  - Add to knowledge base (create note).
  - Create todo list (todos default to `project_id = null`).

### Created Outputs

- Approved outputs create real artifacts (notes/todos).
- Each `InboxItem` shows a `Created Outputs` section with deep links.

## Lifecycle and State Machine

> Note: The state machine and agent processing below describe the **future platform capability**. The iOS MVP ships only the `saved` experience (Capture → Inbox list).

### Item States

1. `saved`: initial state after user submits.
2. `processing`: agents run in background immediately after save.
3. `review`: proposals are ready for user decisions.
4. `processed`: all outputs resolved and failures either recovered or explicitly skipped.
5. `archived`: auto-transition 7 days after processed.

### Output States

- `pending`: awaiting user action.
- `approved`: user accepted; side effect executed.
- `declined`: user rejected.
- `failed`: operation failed (retryable).
- `skipped`: user explicitly ignored a failed output.

### Transition Rules

- Save action starts processing immediately; editing is disabled after save.
- `processed` gate:
  - Every output is terminal (`approved`, `declined`, or `skipped`).
  - Any `failed` output must be retried or explicitly skipped.
- No global failure state exists for an item.
- Auto-archive rule: archive when `now >= processed_at + 168 hours`.

## User Experience

### Capture (platform)

- User writes content and clicks Save.
- Item becomes immutable.
- UI shows processing state.

### Review

- Outputs are presented in deterministic order.
- Actions:
  - Per-output `Approve` / `Decline`.
  - Retry for failed outputs.
  - Explicit `Skip` for failed outputs.
  - Bulk `Approve All` / `Decline All` (applies output-by-output under the hood).

### Processed

- Item remains visible in Inbox for 7 days.
- `Created Outputs` section displays all created artifacts with deep links.

### Archived

- Archived items are viewable in an Inbox `Archive` tab.
- Archived state is for decluttering, not deletion.
- Deletion is not supported in V1.

## Data and Side-Effect Rules

- Side effects occur only on approval.
- Todo outputs create todos with `project_id = null` in V1.
- Future extension can add project inference or approval-time project picker.

## Reliability and Guardrails

### Idempotency (Required)

- Approval operations must be idempotent to prevent duplicate artifact creation from retries or double-clicks.
- Each approval action should carry an idempotency key scoped to item + output + action.

### Hung Processing (Required)

- If processing hangs past timeout, UI exposes manual recovery action.
- Recovery should allow marking specific outputs failed, then retry/skip from review.

### Deterministic Ordering

- Output ordering should be stable (for example by agent and output index) to avoid UI jitter and accidental misclicks.

## V1 API/Domain Contract (Conceptual)

### Inbox Item

- `id`
- `content`
- `state` (`saved | processing | review | processed | archived`)
- `processed_at` (nullable)
- `archived_at` (nullable)
- `created_at`, `updated_at`

### Proposal Output

- `id`
- `inbox_item_id`
- `agent_type` (for example `kb_note`, `todo_list`)
- `payload_preview`
- `state` (`pending | approved | declined | failed | skipped`)
- `error_message` (nullable)
- `resolved_at` (nullable)
- `created_artifact_refs` (nullable list of links/ids)

## Open Question

- Should `Skip` require a reason in V1 or stay optional?
  - Current recommendation: optional in V1; add required reason later if quality tuning needs it.

## Acceptance Criteria (V1)

1. User can save an Inbox item and processing starts immediately.
2. Saved Inbox items cannot be edited.
3. Review screen shows all outputs with per-output actions.
4. Failed outputs support retry and explicit skip.
5. Item reaches `processed` only when all outputs are terminal.
6. Approvals create artifacts; declines do not create artifacts.
7. Todo artifacts default to `project_id = null`.
8. `Created Outputs` is visible with deep links after creation.
9. Bulk approve/decline actions are available.
10. Processed items auto-archive after 7 days.
11. Archived items are visible in Inbox `Archive` tab.
12. No deletion flow exists for Inbox items in V1.
