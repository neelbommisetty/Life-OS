# Inbox Capture Layer - Product and System Design

Date: 2026-02-13
Owner: Life-OS

## Summary

`Inbox` is a dedicated capture layer, not a project. Users save quick notes as `InboxItem`s. Each item is processed by agents that propose actions (for example, create a KB note or create todos). Users approve or decline each proposal output. After all outputs are resolved, the item becomes processed and is automatically archived after 7 days to reduce visual clutter.

## Goals

- Provide a fast, low-friction capture surface for unstructured thoughts.
- Convert captured text into structured outputs through agent proposals.
- Keep user control explicit via per-output approve/decline actions.
- Reduce UI clutter with automatic archival while preserving history.

## Non-Goals (V1)

- Inbox as a hidden project.
- Editing or versioning `InboxItem`s after save.
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

### Capture

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
