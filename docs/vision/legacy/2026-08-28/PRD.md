# Life-OS v2 — PRD (draft)

Status: DRAFT v0.6 — 2026-08-28. Companion to `VISION.md` (v0.5); system layout in `SYSTEM-LAYOUT.md`. Sources: raw dump #1–31, decisions D1–D36 (D33–D36 are working decisions from the layout pass), and lessons inferred from the prototype vault (reference implementation). Gaps are marked **[OPEN]** rather than guessed.

---

## 1. North star

Replicate Neel as an agent. Life-OS models how Neel interprets his life, what he'd decide, and what he'd do next — closely enough to act on his behalf, with him in the loop only where it matters. Single user, forever (D1).

Success looks like: inputs flow in without Neel filing anything; each life area maintains a current, correct understanding of itself; the todo list is populated and largely executed by agents under the safe/unsafe/review policy; the calendar reflects reality without manual planning; artifacts appear when they're useful; and every correction Neel makes leaves telemetry the system can later learn from.

## 2. Concepts

| Concept | Definition |
|---|---|
| **Root orchestrator** | The top agent. Ingests inputs, routes to agents, owns cross-area memory, triages todos into buckets, slots the calendar, detects cross-area patterns and project candidates (#23). Thinks over specialists' *claims* plus unclaimed raw evidence only — never specialists' raw in-scope data (D35, working). |
| **Life-area agent** | A **full agent** (D9) for one life area: own instructions, own memory (sole writer), own connectors, own schedule, own views. Eight at launch: Creativity, Health, Home/Household, Learning, Leisure, Finance/Money, Relationships, Work. |
| **Project agent** | Same anatomy as an area agent, but time-bounded with a deadline and lifecycle (planning → running → done → reflection) (#22). Linked to 1+ areas. Own data inputs (#21). Prototype precedent: Job Sweep. |
| **Todo** | One item on the single master list (D3). Carries bucket, provenance, state, optional calendar slot. |
| **Artifact** | A typed output for the user to view: report, text, markdown, HTML, sheet, doc, PDF (#29). |
| **Claim** | One unit of interpreted knowledge in memory, with confidence, evidence links, and timestamps (adopted from the July spec — the piece the prototype never implemented). |
| **Connector** | Typed adapter to an external system; declared in / out / both; owned by one agent or root. Life-OS-owned fallback when not connected (D6 pattern). |
| **Skill** | A versioned, bounded capability an agent runs (manifest: scopes, workflow, verification). Agents may create/update their own skills post-MVP (layer 5, D10). |
| **Run** | One execution of an agent/pipeline/skill, with structured record. |

## 3. Agent anatomy (#2–#4)

Every agent has exactly three parts:
1. **Application surface** — its views inside the one shell (D2): inputs in, outputs (todos, artifacts, memory inspection) out.
2. **Data sources** — connectors and feeds it owns or is scoped into.
3. **Memory** — multi-layered (see §5.2), owned solely by that agent.

Plus, cross-cutting: its **instructions** (versioned; agent-editable per D10), its **skills**, and its slice of the **policy** (safe/unsafe/review rules that apply to its actions — user-approved only).

## 4. Layer 1 — Data (stimulus)

### 4.1 Capture contract (inherited, strongest prototype pattern)
- Every user message, on every surface, is persisted raw **before any other mutation**. Per-message opt-out ("don't save this"). Failure to persist halts everything else.
- Raw entries carry: id, timestamp, source surface, attachments, status (`pending | processed | partial | transient | superseded`), destinations, processing summary. Corrections are new events that supersede, never edits.
- Raw is temporary recovery evidence: links point outward only; pruned only after verified consumption.

### 4.2 Connectors (#28)

| Connector | Direction | Owner | MVP? | Notes |
|---|---|---|---|---|
| Gmail | in | root, per-agent scoped queries | yes | Scoping rule per agent (Finance sees receipts, Travel sees confirmations); root sees nothing by default. Prototype lesson: unscoped mail is noise. |
| Google Calendar | in + out | root | yes | Life-OS owns the schedule model, mirrors to Google (D6). |
| Todo list | native | — | yes | **Decided (D15): Life-OS-owned canonical list; Todoist as optional mirror connector** (same pattern as calendar). |
| Apple Health | in | Health agent | yes | **Decided (D16): signed Mac helper app** — HealthKit is available on macOS 26+, so no iPhone app is needed. Requires Apple Developer code-signing + iCloud Health sync. |
| Plaid / automated pull | in | Finance agent | yes | **Decided (D17): automated pull required** — Plaid or another automation (Gmail statement/alert parsing via Finance's scoped mail access, scripted fetch). File-drop is fallback only. |
| Drive / files | in | per-agent | later | Relevance-bounded, prototype-proven pattern. |
| GitHub / Linear | in | Work agent, project-linked | later | Prototyped in Gather. |
| Leisure bundle | in | Leisure agent | yes | **Decided (D23/D27):** captures + on-demand review interview; Goodreads/StoryGraph (reading) + Steam/PSN (gaming) + manual inputs; calendar + scoped Gmail bookings; Mac screen/app usage (sensitive — privacy handling required). |
| [OPEN] | — | Creativity, Learning, Home, Relationships, Work | — | Non-MVP lenses; Neel to specify later. |

Non-connector inputs: user messages (capture), the **review interview — kept, on-demand only (D25)**, documents dropped into the filesystem store.

### 4.3 Ingestion pipeline
Connector pulls run on each connector's own cadence (owner agent's schedule). Every normalized input becomes an **evidence record** in the raw substrate: stored once, immutable, content-hashed, sensitivity-tagged (D4). Real source documents are retained (D11). No-signal semantics are typed: `no-evidence | not-checked | stale | connector-failed | permission-denied | ambiguous` — never conflated.

## 5. Layer 2 — Brain

### 5.1 Interpretation fan-out (#8, #9)
New evidence → root ingests → routed to every agent whose scope matches → each agent interprets through its own lens and writes **claims** into its own memory. Same input, different interpretations per agent, by design. The root also interprets at the top-level view: cross-area patterns, project candidates, priorities (#23) — reading specialists' claims, and raw evidence only for its lens areas and unclaimed items (D35, working); baseline routing is mechanical scope-matching, root's judgment handles only what scope-matching can't place.

### 5.2 Memory model (per agent, incl. root — D4)
Tiers inherited from the prototype (survived every rewrite) with structure the prototype lacked:
- **Short-term** — compact current context; loaded by default.
- **Long-term** — durable preferences, ways of working, priorities, stable context; promotion needs explicit statement or repeated independent evidence.
- **Behavioral synthesis** ("subconscious") — cautious cross-time patterns; never diagnosis or coaching; excluded from execution decisions.
- **Decision log** — every introduce/refine/reinforce/promote/contradict/weaken/retire/correct, with reason and evidence (the Dream Log, structured).
- Every memory item is a **claim**: `{ text, kind, confidence: high|medium|weak, evidenceIds[], contradictedByIds[], firstObservedAt, lastConfirmedAt, supersedes }`. Fixes the prototype's biggest memory gap (hedging prose, nothing queryable/ageable).
- **Signal accumulator** per agent (Signal Ledger generalized): weak observations cluster with `strength: weak → emerging → confirmed → routed | contradicted | retired`.
- Boundary (hard, inherited): memory never contains operational/system state; memory is never used to determine operational state; memory never overrides policy or direct instructions.

### 5.3 Triage and priority (D5, D13)
- **Gate 1 — creation:** agent inference → todo requires evidence and lands as `proposed` (evidence-gated; "no signal count alone justifies promotion"). **Before creating, the agent checks the list for an existing equivalent — duplicate check is mandatory (D18).** Direct user asks skip to `accepted`.
- **Gate 2 — execution:** every actionable todo gets a bucket: `safe` (act autonomously), `review` (ask first), `unsafe` (hard-blocked by user-written rules). Everything defaults to `review`; graduates to `safe` through approval history. Bucket policy is user-owned; agents may only propose changes (D10).
- Root assigns priority/ordering and **auto-slots todos into the calendar** (#17), respecting deadlines (projects, #22).

### 5.4 Project detection and lifecycle
Promotion gate inherited: concrete outcome, finish condition, next milestone, related area(s), user ownership, duplicate check — but a candidate that clears most gates becomes a **proposed project** for review rather than silently dropped (prototype promoted zero in 21 runs; too strict without a proposal path). Lifecycle: planning → running → done → reflection; closing reconciles todos, distills history, archives; revival is explicit.

## 6. Layer 3 — Execution (hands and legs)

- **The todo list is the working surface** (#11–#13): one master list; projects and areas are views (D3). Todo fields: title, bucket, state (`proposed | accepted | in-progress | blocked | done | dropped`), provenance (agent + evidence), area/project links, deadline, calendar slot, executor (agent or Neel). **Life-items only (D36, working):** routines/runs are operational state, never todo items; agents auto-execute safe items, or Neel assigns an item's executor.
- Agents execute safe/approved todos via **skills and tools**: connector writes, bookings (#22), scripts. Every execution follows Ground → Discover → Plan → Authorize → Execute → Verify → Report (inherited skill phases), producing a run record.
- Semantic firewall (inherited): passing data forward never grants mutation rights; each mutation class (generated write, focused durable write, external create, external state change, archive, destructive delete) has its own authorization; enforced **in code**, not prompts.
- Failure honesty: partial results reported as partial; auth failure ≠ nothing happened; ambiguity blocks destructive action, not reporting.

## 7. Layer 4 — Artifact

- **One shell** (D2), area/project views inside shared chrome: Today (todos + calendar), Inbox/review queue (proposed todos, review-bucket actions, proposed projects, policy proposals), per-agent views, memory inspector, artifact gallery. Conversation defaults to the root agent; Neel can explicitly address any specialist (D34, working).
- **Artifacts** (#29): typed outputs — report, markdown, HTML, sheet, doc, PDF. Metadata: producing agent, generating run, evidence links, `regenerable | precious`, `snapshot | live`. Regenerable artifacts can be re-derived and pruned; precious ones (reflections) never auto-deleted.
- External apps count as artifact surfaces (mirrored calendar, optional Todoist mirror).
- **Memory inspector** (from July spec): claims by layer, evidence per claim, correct/delete/pin, first-seen/last-confirmed, why promoted, rebuild after correction. Corrections feed layer 5.
- Every dashboard/view is a query over data. No hand-maintained "latest" (prototype pain).
- Surfaces (D16, D22): web app + installable PWA (capture + review queue on mobile) in MVP; signed Mac helper app for HealthKit. No native iOS in MVP.

## 8. Layer 5 — Reconciliation / re-alignment

MVP scope = **telemetry capture only** (#30); acting on it (evolution) is post-MVP (D10 note).

Captured from day one: every correction (before/after, producing agent); every review decision (approve/decline/modify + latency); every override; every execution outcome (succeeded/failed/undone; calendar slot kept/moved/ignored); artifact engagement (viewed/ignored/edited/exported); instruction + policy version history; full run records (model, inputs, outputs, cost).

Post-MVP: agents adapt instructions and skills from this stream (D10: memory + instructions autonomous with versioning/rollback; policy changes proposed).

## 8b. Cadence, notification, and models

- **Cadence (D29):** one sequential nightly pipeline per the prototype lesson (launchd scheduled wake); lightweight connector ingestion may run during the day. One **morning brief** pushed via PWA; otherwise quiet except safe-bucket action confirmations and time-sensitive review items.
- **Models (D28):** multi-provider via **ai-sub-proxy** — Neel's local OpenAI/Anthropic-compatible proxy that routes calls through logged-in CLI subscriptions rather than metered API keys. Runs on the same Mac as the daemon (fits D22). Capability-based model selection per step (cheap tier for mechanical work, strong tier for interpretation); v1-style usage/cost telemetry retained.

## 9. Policy and authority

**Initial unsafe rules (D31, policy v1 — hard-blocked for every agent):**
1. No money movement: payments, transfers, purchases, subscriptions. Bookings are therefore always review-bucket, never safe.
2. No sending email/messages to anyone on Neel's behalf. Drafting is allowed; sending is review at most.
3. No destructive deletion of Neel's data anywhere — archive/trash with manifest only.
4. No account or credential changes: sign-ups, logins on new services, password/permission changes, access grants.

Authority order (inherited, adapted): (1) Neel's direct instruction → (2) safety policy (unsafe rules; unweakenable) → (3) root policy → (4) agent policy (specializes, never weakens) → (5) approved automation scope → (6) skill instructions → (7) canonical records + connector state → (8) short-term → (9) long-term → (10) behavioral memory → (11) model inference. Rules live in policy artifacts, versioned; the vault is a reference implementation only — Neel's stated decisions win (#27).

## 10. Storage (D12/D20 — confirmed: "right tool for the right choice")

| Store | Canonical for |
|---|---|
| **Filesystem** (or object store) | Raw captures, source documents (D11), artifacts. Human-readable projection of memory/policy exportable at all times (kept the prototype portable). |
| **Relational DB** | Claims, todos, projects, runs, telemetry, policy versions, connector cursors, evidence index, calendar model. |
| **Vector index** | Retrieval over evidence + claims + artifacts. Derived, rebuildable, never canonical. |

## 11. MVP boundary (decided 2026-08-28, D15–D22)

**In (updated per D15–D22):** capture contract + raw substrate; root orchestrator + three full area agents — **Health, Finance/Money, Leisure** (D21) — + 1 project agent (**2026 Travel Plan**, D24); all other areas as root-maintained memory lenses; Gmail + Calendar connectors; **Mac HealthKit helper**; Finance automated pull (D17); **native todo list** with buckets, both gates, duplicate check; calendar slotting; claims-based memory with inspector; artifacts (markdown/report/sheet minimum); the shell as web app + PWA (Today, review queue, agent views); full telemetry; nightly per-agent pipeline with readiness gates (one sequential run — prototype lesson). Runtime: **Mac-first daemon + tunnel for the PWA** (D22), launchd scheduled wake for nightly runs.
**Out:** evolution acting on telemetry (telemetry captured only); remaining full area agents (lenses graduate later); native iOS app; Plaid production hardening (if the other automation path wins); skill marketplace anything; multi-user anything.

## 11b. MVP acceptance criterion (D30)

**The morning brief is the proof.** MVP is done when Neel wakes up to a brief that shows: today's calendar with auto-slotted todos; what Health, Finance, and Leisure noticed yesterday; the Travel Plan project's state and gaps; proposals waiting in review — every line traceable to evidence, produced autonomously overnight.

## 12. Open items

1. Per-area connectors for the non-MVP lenses (Creativity, Learning, Home, Relationships, Work) — later.
2. Which media services feed Leisure (D23 names them as a class only).
3. Evolution details Neel said he'd add (D7/D10 — post-MVP design, telemetry already specced).
4. Plaid vs alternative automation for Finance — implementation choice within D17.

## 13. Persona (D8, D26)

Core persona = the Vault Voice Lab voice spec (versioned, with its test set), ported as the system's language. No separate behavioral persona doc — conduct comes from policy. Per-area tonal modulation on top (D8). **Dual voice (D33, working):** outward-facing output (drafts, messages) is written *as Neel*, in his voice; with Neel the system speaks in its own voice while modeling his judgment.
