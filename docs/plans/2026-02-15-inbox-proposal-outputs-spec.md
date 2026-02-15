# Inbox Proposal Outputs - Agents + CRUD Specs

Date: 2026-02-15
Owner: Life-OS
Status: Draft

This document defines V1 specs for:
1. **Agent proposal generation** (how proposals are produced and stored).
2. **Proposal output CRUD + approval workflow** (how proposals are reviewed, resolved, and turned into real artifacts).

This doc extends `docs/plans/2026-02-13-inbox-capture-layer-design.md` and assumes `InboxItem` exists.

---

## Shared Definitions (Applies to Both Specs)

### Terminology

- **InboxItem**: Immutable captured text, owned by a user.
- **Proposal Output** (or **Proposal**): An agent-produced suggestion tied to an InboxItem. Proposals do not mutate user data until approved.
- **Created Artifact**: A real record created as the side-effect of approving a proposal (e.g., Note, Task).

### Inbox Item State Gate (V1)

`InboxItem` transitions (as described in the capture layer doc):
- `SAVED -> PROCESSING -> REVIEW -> PROCESSED -> ARCHIVED`

For V1 proposal outputs:
- `REVIEW` means the server has finished proposal generation (or recorded failures) and the user can decide on each output.
- `PROCESSED` means every proposal output is terminal (`APPROVED`, `DECLINED`, or `SKIPPED`).
- Auto-archive rule remains: `ARCHIVED` when `now >= processed_at + 168 hours`.

### Proposal Output States (V1)

Terminal states are required to compute `InboxItem.processed`:
- `PENDING`: awaiting user decision.
- `APPROVED`: accepted; side effect executed successfully.
- `DECLINED`: rejected; no side effect.
- `FAILED`: side effect failed (retryable).
- `SKIPPED`: user explicitly ignored a failed output.

### Deterministic Ordering (Required)

Proposal ordering must be stable to avoid UI jitter:
- Primary: `agent_key` (string)
- Secondary: `output_index` (int)
- Tertiary: `created_at` (timestamp)

### Idempotency (Required)

Approval operations must be idempotent to prevent duplicates from retries/double-clicks.

Required invariant:
- The system must guarantee: “Approving the same proposal output twice creates at most one artifact.”

Recommended mechanism:
- Each proposal output action (`approve`, `decline`, `retry`, `skip`) includes an `Idempotency-Key` header or request field.
- Server stores idempotency keys per proposal output + action and returns the prior result on duplicate key.

### Security / Ownership (Required)

All reads and writes must enforce:
- `InboxItem.userId` matches authenticated user.
- Proposal outputs are only accessible via their parent item’s ownership.
- Created artifacts must be owned by the same user.

---

## Spec A: Agent Proposal Generation

### Goal

Generate proposal outputs for each `InboxItem` without mutating user data until explicit approval.

### Non-Goals (V1)

- Streaming partial proposals to the UI.
- User-configurable agent sets or ordering.
- Re-running agents for `PROCESSED` or `ARCHIVED` items.

### Agent Runtime Contract (Conceptual)

Agent input:
- `inbox_item_id`
- `user_id`
- `content` (immutable)
- Optional context (future): project list, recent notes, tasks

Agent output (one agent run may emit multiple proposals):
- `agent_key`: stable identifier (e.g., `kb_note`, `todo_list`)
- `outputs[]`: ordered list of proposals with:
  - `output_index`: 0..N-1
  - `payload`: machine-usable JSON for later execution on approval
  - `payload_preview`: human-readable summary for UI

### Agent Execution Model

V1 requirements:
- Runs in background after InboxItem creation.
- Must be time-bounded (timeout) and failure-tolerant (one agent failing does not invalidate the item).
- Must be safe to retry (same item should not create duplicate proposal records).

Recommended design:
- Transition item to `PROCESSING`.
- For each configured agent:
  1. Run agent with timeout.
  2. Upsert its proposal outputs by `(inbox_item_id, agent_key, output_index)` uniqueness.
  3. Record agent-level error metadata if generation fails.
- When all agents have either succeeded or failed:
  - Transition item to `REVIEW`.

### Handling Hung Processing (Required)

If proposal generation “hangs” past a timeout:
- Item remains in `PROCESSING`.
- UI exposes a manual recovery action (exact UX TBD) that allows:
  - Transition item to `REVIEW` with whatever proposals exist.
  - Recording a processing error marker for visibility (no global failure state).

### Proposal Creation Guardrails

- Proposal creation must never create user artifacts.
- Proposal payloads must be validated and versioned:
  - Include `payload_version` (int) for each proposal output to support future migrations.
- Proposal outputs must include enough info to execute without re-running the agent (approval-time execution should not require LLM).

### Suggested V1 Agent Set (Informative)

Not required to implement now; included to anchor payload shapes:
- `kb_note`: propose creating a Note with a title + markdown content.
- `todo_list`: propose creating one or more Tasks with `projectId = null` in V1.

---

## Spec B: Proposal Output CRUD + Approval Workflow

### Goal

Provide API/UI primitives to:
- List and display proposal outputs for an InboxItem.
- Approve/decline each proposal output.
- Retry failed proposals.
- Skip failed proposals.
- Bulk approve/decline.
- Track created artifacts and link them back to the InboxItem.

### Non-Goals (V1)

- Editing proposals in-place.
- Partial approvals that mutate proposal payloads.
- Deleting proposals (only resolve them).

### Domain Model (Conceptual)

#### ProposalOutput

Fields:
- `id`
- `user_id` (redundant for indexing/authorization)
- `inbox_item_id`
- `agent_key`
- `output_index`
- `payload_version`
- `payload` (JSON)
- `payload_preview` (string)
- `state` (`PENDING|APPROVED|DECLINED|FAILED|SKIPPED`)
- `error_message` (nullable string)
- `resolved_at` (nullable timestamp)
- `created_artifacts` (nullable JSON list; see below)
- `created_at`, `updated_at`

Uniqueness:
- Unique `(inbox_item_id, agent_key, output_index)`

Indexing:
- `(user_id, inbox_item_id)`
- `(user_id, state, created_at)`

#### Created Artifact Reference (V1)

Represented as JSON array stored on ProposalOutput:
```json
[
  { "type": "note", "id": "cuid...", "href": "/notes?noteId=cuid..." },
  { "type": "task", "id": "cuid...", "href": "/tasks" }
]
```

Notes:
- `href` is optional; UI can generate deep links client-side from type/id.
- Storing JSON keeps V1 schema small; can be normalized later if needed.

### API Contract (V1)

All routes exist in both `/...` and `/api/...` forms following existing patterns.

#### Read

- `GET /api/inbox/:itemId/outputs`
  - Returns ordered proposal outputs for item.
  - Ordering: `(agent_key, output_index, created_at)`.

#### Resolve (Per Output)

- `POST /api/inbox/outputs/:outputId/approve`
  - Header: `Idempotency-Key: <uuid>` (required)
  - Side effect: create artifacts based on payload, update output state, set `resolved_at`, populate `created_artifacts`.
  - If already approved with same idempotency key: return prior success result.
  - If already approved with a different key: return current approved state and artifacts (no new side effects).

- `POST /api/inbox/outputs/:outputId/decline`
  - Header: `Idempotency-Key` required
  - Side effect: set state to `DECLINED`, set `resolved_at`.

- `POST /api/inbox/outputs/:outputId/retry`
  - Only valid when state is `FAILED`.
  - Header: `Idempotency-Key` required
  - Side effect: rerun *execution* step (not the agent) using stored payload.

- `POST /api/inbox/outputs/:outputId/skip`
  - Only valid when state is `FAILED`.
  - Header: `Idempotency-Key` required
  - Body: `{ reason?: string }` optional in V1.
  - Side effect: set state to `SKIPPED`, set `resolved_at`.

#### Bulk Resolve

- `POST /api/inbox/:itemId/outputs/approve-all`
- `POST /api/inbox/:itemId/outputs/decline-all`

Rules:
- Bulk actions apply output-by-output under the hood.
- Bulk endpoints must be safe if partially applied:
  - If some outputs fail approval, return a multi-status payload describing which outputs succeeded/failed.
  - Outputs already in terminal states are left unchanged.

### Inbox Item Processed Gate (V1)

The server must compute and persist `InboxItem.state` transitions:
- After any output resolution action, check all outputs for the item:
  - If all outputs are terminal (`APPROVED|DECLINED|SKIPPED`), set item state to `PROCESSED` and set `processed_at` if missing.
  - If any output is `FAILED`, item must not be `PROCESSED`.

If an item has zero proposal outputs:
- Item can move to `PROCESSED` immediately after proposal generation ends (i.e., once it reaches `REVIEW`).

### Execution Semantics (Approval-Time)

Each `agent_key` maps to a deterministic executor that can run without LLM calls.

Examples:
- `kb_note` executor:
  - Validate payload shape.
  - Create `Note` with `title`, `content`, `projectId = null` (unless later expanded).
  - Store `{type:'note', id:<noteId>}` in `created_artifacts`.

- `todo_list` executor:
  - Validate payload shape.
  - Create one or more `Task` records.
  - Ensure `projectId = null` in V1.

### Error Handling

If execution fails:
- Set output state to `FAILED`.
- Set `error_message`.
- Do not mutate item to `PROCESSED` until failures are resolved (retry) or skipped.

### Acceptance Criteria (V1)

1. Proposal outputs can be listed and shown for an InboxItem.
2. User can approve/decline proposals; approvals create artifacts; declines do not.
3. Approval actions are idempotent (no duplicates on retries).
4. Failed approvals can be retried; failed outputs can be explicitly skipped.
5. Bulk approve/decline endpoints exist and provide per-output results.
6. Item transitions to `PROCESSED` only when all outputs are terminal.
7. Created artifacts are shown as deep links after approval.

### Open Questions

- Should `Skip` require a reason in V1?
  - Recommendation: optional.
- Should bulk endpoints be async jobs if output count is large?
  - Recommendation: synchronous in V1 with a reasonable max outputs limit.

