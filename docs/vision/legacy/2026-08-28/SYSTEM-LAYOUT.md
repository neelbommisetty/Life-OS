# Life-OS v2 — System Layout

Status: DRAFT v0.1 — 2026-08-28. Companion to `VISION.md` (v0.5) and `PRD.md` (v0.6). Produced in the layout pass; hardened by a two-angle adversarial review. Sources: decisions D1–D36 only — this document invents no new product decisions. **No technology choices live here** — pieces, contracts, and flows only; engines/runtimes are a later pass.

Build principle: **set up for everything, implement a subset.** The structures below are the full system; the MVP (§Build) is only which subset gets implemented first — nothing in the setup knows it's "MVP."

Vocabulary: **schedule** = when · **routine** = what · **run** = one recorded execution.

## The frame — 7 structural pieces + 2 cross-cutting aspects

The five layers (Data / Brain / Execution / Artifact / Reconciliation) are the system's *verbs* (in / think / act / show / learn). These pieces are its *nouns*. Described abstractly: no agent names, no connector names, no counts.

Structural pieces:

| # | Piece | One line |
|---|---|---|
| 1 | **Root agent** | The face Neel talks to + the behind-the-scenes orchestrator. Persona lives here. |
| 2 | **Specialist agents** | Any number, two kinds: **area agents** (open-ended lens on one life area) and **project agents** (same anatomy + deadline and lifecycle, linked to areas). Uniform anatomy. |
| 3 | **The data layer** | The shared world: evidence → memories (claims) → artifacts (incl. the two special ones: todo list, calendar) → system records. |
| 4 | **Connectors** | Pipes to the outside world: inbound ones write evidence in; mirrors project canonical artifacts out and carry external changes back in as evidence. |
| 5 | **The shell** | Neel's one window; agents contribute views inside shared chrome (D2). |
| 6 | **The agent runner** | The one code path that executes every agent turn/routine: load agent record → governance check → execute → telemetry record. |
| 7 | **The heartbeat** | The system's clock: fires schedules, nothing more. |

Cross-cutting aspects, woven through every agent (one core, per-agent slice — same pattern as persona):

| # | Aspect | One line |
|---|---|---|
| 8 | **Governance** | Every agent carries its policy slice; the runner enforces checks in code; the **rulebook** is one shared, user-owned, versioned core. |
| 9 | **Telemetry** | The runner records identically around every run; the **ledger** is one shared append-only core no agent owns, feeding later self-evolution. |

```
 OUTSIDE WORLD                                              NEEL
 (mail, calendar, health,                            (talk, capture, review,
  money, leisure, …)                                  correct — anywhere)
      │      ▲                                            │      ▲
   in │      │ mirrors (two-way: projection out,    shell │      │ views, brief,
      │      │ external changes back as evidence)         │      │ artifacts,
      ▼      │                                            ▼      │ notifications
 ┌───────────────────────────────────────────────────────────────────────┐
 │                              DATA LAYER                               │
 │  evidence (what happened) → memories/claims (what it believes)        │
 │  → artifacts (what Neel sees & works: incl. TODO LIST + CALENDAR)     │
 │  + system records (the system's own state)                            │
 │            per-agent scoped read/write, enforced HERE                 │
 └───────────────────────────────────────────────────────────────────────┘
            ▲                     │ in-scope work queues        ▲
            │ claims, todos,      ▼                             │
            │ artifacts   ┌────────────────────────────┐        │
            └──────────── │  AGENT RUNNER (one path)   │────────┘
                          │  governance check → execute│
                          │  → telemetry record        │
                          │   ┌──────┐ ┌─────────────┐ │   agents are data,
                          │   │ ROOT │ │ SPECIALISTS │ │ ← born at runtime
                          │   └──────┘ └─────────────┘ │   via the factory
                          └────────────────────────────┘
        RULEBOOK (before) · LEDGER (after) · HEARTBEAT (fires schedules)
```

### Key relationships

- **Two planes.** Root is the interactive front — what Neel converses with, any time (D34). Background routines (COB fetch, memory upkeep, skill runs) ride the clock. The nightly pipeline is housekeeping, not the system's identity.
- **Blackboard + direct queries.** Agents coordinate through the shared world; they may also directly query one another. Query rule: the queried agent answers only from its own scope; answers are derived interpretations, never raw-data hand-offs; every query+answer lands in the ledger; anything durable the asker keeps becomes a claim in its own store, linking back.
- **Scoped data access.** Connectors write; all read **and** write access to data is scoped per agent, declared and enforced at the data layer — never by connector plumbing or agent politeness. Sole-writer memories, mail-invisibility-by-default, and mutation-class authorization are instances of this one mechanism. "Sole writer" means sole *agent* writer — Neel acts above it per the authority order; his correction is a superseding event the owning agent ingests.
- **Routing mostly dissolves.** An agent's work queue is simply "in-scope evidence not yet processed" — mechanical, at the data layer. Root's routing *judgment* exists only for what scope-matching can't place: ambiguous, cross-area, unclaimed evidence.

## The pieces, one level down

### 1. Root agent

- **Made of:** conversation handling (the default face; Neel can explicitly switch to any specialist, D34); persona — versioned voice spec with per-area modulation (D8/D26), **dual voice** (D33): outward output written *as Neel*, conversation with Neel in its own voice; cross-area memory, including a **lens** per not-yet-instantiated area (lens = memory namespace + its data scope, held by root *in trust*); orchestration duties — judgment routing for unclaimed evidence, todo triage (buckets), prioritization, calendar slotting, project-candidate detection, brief authoring.
- **Root's view (D35):** synthesizes cross-area patterns from specialists' *claims*; reads raw evidence only in its lens scopes and for unclaimed evidence — never specialists' raw in-scope data. Effective scope = all agents' claims + lens scopes + unclaimed evidence.
- **Contract:** every actionable todo gets a bucket and (when due) a calendar slot; a daily brief, every line evidence-traceable (D30); direct user asks become `accepted` todos immediately.

### 2. Specialist agents (uniform anatomy, D9)

- **Made of:** versioned instructions (self-editable, D10); claim memory (sole agent-writer); a declared data scope; skills; views contributed to the shell; own schedules.
- **Contract:** interprets in-scope evidence through its lens into claims — every move logged with reason + evidence; proposes todos only through gate 1; executes only what governance allows; answers direct queries per the query rule.
- **Project agents add:** deadline; lifecycle `planning → running → done → reflection` with explicit close/revive; area links — cross-reads per scope, nothing copied (D14/D19).

### 2b. The factory — agent creation

**Agents are data, not code.** The runner + anatomy + contracts are code; each agent instance is a **system record** — versioned instructions, declared scope, memory namespace, skills, schedules, views config — instantiated at runtime from a template. Two birth paths, one mechanism:

- **User-initiated:** Neel tells root to start a project (conversation or shell flow) → root walks the promotion gate with him (concrete outcome, finish condition, first milestone, linked areas, duplicate check) → factory instantiates: record + template-seeded instructions + scope grant + rulebook inheritance + lifecycle `planning`. Direct ask → no review.
- **Root-proposed:** cross-area interpretation detects a candidate → promotion gate → **proposed project** in the review queue (near-passes are proposed, never silently dropped) → approval triggers the same path.

**Graduation** (lens → area agent) is an **ownership transfer**: the lens namespace *and its scope* move from root's trust to the new agent — a rename, not a copy. **Closing** is the reverse: reconcile todos, distill, archive (linked areas keep claim links); revival is explicit.

**Day zero (system birth):** install policy v1 (Neel's initial hard rules, D31), seed the persona (D26), authenticate connectors, optionally seed memory from the prototype vault. The rulebook and ledger exist before any agent does.

### 3. The data layer

One rule above all: **every fact has one home; everything else links.** Scoped per-agent read/write access is a property of this layer, enforced here.

- **Evidence (what happened):** every input — capture, pull, document, inbound mirror change — stored once, immutable, content-hashed, sensitivity-tagged; corrections supersede, never edit; typed no-signal records (`no-evidence | not-checked | stale | connector-failed | permission-denied | ambiguous`) — never conflated, never silent; real source documents kept as files (D11); raw pruned only after verified consumption.
- **Memories / claims (what the system believes):** claim = `{ text, kind, confidence, evidenceIds[], contradictedByIds[], firstObservedAt, lastConfirmedAt, supersedes }`; tiers short-term / long-term / behavioral / decision log, plus the signal accumulator (`weak → emerging → confirmed → routed | contradicted | retired`); sole agent-writer per store, cross-reads per scope, nothing copied; behavioral tier never diagnoses or coaches and is excluded from execution decisions; memory never holds or decides operational state and never overrides policy or direct instruction.
- **Artifacts (what Neel sees and works with):** typed (report, markdown, HTML, sheet, doc, PDF); metadata: producing agent, generating run, evidence links, `regenerable | precious`, `snapshot | live`; ordinary artifacts have one writer each; regenerable ones can be re-derived and pruned, precious ones never auto-deleted.
  - **Two special artifacts** — singleton, live, structured, canonical (never regenerable), all-agent working surfaces:
    - **The todo list** — holds **life-items only** (D36): every todo is Neel-meaningful, with an **executor** (Neel, or an agent — auto-done when safe, or assigned by Neel); agents' internal chores are routines/runs in system records, never todos. **Gate 1** (creation: evidence required + mandatory duplicate check → lands `proposed`; direct user asks skip to `accepted`) is this artifact's write path, enforced here. It *stores* each todo's bucket; **gate 2** (execution by bucket) is enforced by the runner at act time. Areas and projects are saved views — nothing to sync (D3).
    - **The calendar** — Life-OS owns the schedule model (D6); root slots todos into it; external calendars mirror it; every slot's fate (kept / moved / ignored) is recorded.
- **System records (the system's own state):** agent records, the schedule registry, run records, connector cursors, review-queue items (proposed todos ride the todo list; review-bucket actions, proposed projects, and policy proposals live here), the rulebook, the ledger. Distinct from memory by the memory-never-holds-operational-state boundary.
- **Derived indexes:** retrieval indexes over evidence + claims + artifacts — always derived, always rebuildable, never canonical (D20 assigns storage *roles*, not engines).
- **Contract:** human-readable projection of memory + policy exportable at all times (D12); distill before archive; deletion only with a manifest and a survival cycle.

### 4. Connectors

Typed adapters declared `in | out | both`. Two distinct mechanisms, both real:

- **Ingestion filters** (connector-owned): what is worth capturing into evidence at all — the "unscoped mail is noise" lesson.
- **Access scopes** (data-layer): who may read/write what was captured.

Inbound: normalize + hash-dedup into evidence with provenance and cursor tracking; empty, failed, or denied pulls write typed no-signal records — never silence. **Mirrors are two-way (D6):** outward, a projection of the canonical artifact (never a source of truth); inward, external changes arrive as evidence and reconcile into the canonical artifact — carrying *Neel's* authority when he made them (completing a todo in a mirror is a direct user action, not an agent inference).

### 5. The shell

- **Made of:** capture + conversation (defaults to root; any specialist explicitly addressable, D34); **Today** (todos + calendar); the **review queue** — the only place decisions are asked of Neel (proposed todos, review-bucket actions, proposed projects, policy proposals); **per-agent views** (each agent defines its own, inside shared chrome, D2); **memory inspector** (claims by tier, evidence per claim, correct/delete/pin, why-promoted, rebuild-after-correction); **artifact gallery**; the on-demand **review interview** (D25 — never scheduled); notifications — daily brief, safe-action confirmations, time-sensitive review items, quiet otherwise (D29).
- **Contract:** step zero of every turn, the shell writes Neel's words as raw evidence directly to the data layer, before any other mutation — failure halts the turn; per-message opt-out honored. Every view is a live query over the data layer — no hand-maintained "latest." Reachable wherever Neel is, privately (authenticated).

### 6. The agent runner

- **Made of:** the one code path every agent execution goes through — interactive turn, scheduled routine, or skill run: load agent record → assemble context (memory tiers, working artifacts, retrieval) → governance check (before) → execute → telemetry record (after). Skills run **Ground → Discover → Plan → Authorize → Execute → Verify → Report** inside it, producing a run record.
- **Contract:** no agent executes outside the runner; checks and recording cannot be skipped or altered by any agent's instructions. **Failure honesty:** completion requires completion evidence — absent ≠ done; auth failure = incomplete evidence, never zero work; partial reported as partial; ambiguity blocks destructive action, never reporting.

### 7. The heartbeat

- **Made of:** the schedule registry's firing mechanism — every schedule (agent routines, connector cadences, maintenance such as index rebuilds and pruning) fired reliably; wakes the system when needed.
- **Contract:** it never knows what the work *is*. Schedules are **data in system records** — authored by agent records and by Neel — and may declare dependencies and **readiness gates** ("after X", "only if Y produced output"); the clock honors declared order (D29's sequential lesson) and reports every firing. The "nightly COB run" is not the heartbeat — it's the biggest composed routine riding on it.

### 8 & 9. Governance and telemetry — before and after

> Governance is the **before** of every agent action ("may this happen?" — deterministic, in code). Telemetry is the **after** ("what happened, and what did Neel do about it?"). Both are enforced by the runner around every execution. Evolution (post-MVP) closes the loop between them; today's one narrow link is trust graduation, which runs on the approval history the ledger captures.

**Governance**
- *Per agent:* its policy slice (graduated action types, specializations — specialize, never weaken) lives in its agent record; every action passes the runner's checks.
- *Shared core — the rulebook:* Neel's hard rules (→ `unsafe`, hard-blocked, unweakenable); bucket policy + trust graduation (`review` → `safe` from approval history, D5); the 11-level authority order; per-mutation-class authorization (generated write / durable write / external create / external state change / archive / destructive delete) — passing data forward never grants mutation rights.
- *Contract:* enforced in code, never prompts; consulted on every action; sits outside every agent's self-editable substrate (D10: agents propose, never edit); inherited automatically at agent birth; fully versioned.

**Telemetry**
- *Per agent:* the runner records identically around every run — no agent chooses what gets recorded or how.
- *Shared core — the ledger:* every correction (before/after + producing agent), review decision (+ latency), override, execution outcome, calendar-slot fate, artifact engagement, direct query+answer, instruction/policy/persona version history, full run records (model, inputs, outputs, cost).
- *Contract:* append-only; capture-complete from day one so evolution is never blocked by missing telemetry (#30); read by nothing until evolution exists.

## The four flows

- **A. Neel talks** — shell persists his words as evidence (step zero) → runner executes root's turn: context assembled, conversation in persona; root may direct-query specialists (query rule); his asks become `accepted` todos; corrections supersede + land in the ledger.
- **B. The world changes** — a connector pulls through its ingestion filter (or a document drops, or a mirror reports an external change) → normalized evidence → lands in matching agents' queues mechanically (scope match); unclaimed or ambiguous evidence goes to root's judgment; time-sensitive items surface to the review queue immediately.
- **C. The cycle runs** — the clock fires scheduled routines honoring declared dependencies and readiness gates: fetch routines land COB data → each specialist's routine (in the runner) interprets in-scope evidence into claims and proposes todos through gate 1 → root's routines triage (gate 2 buckets), prioritize, and slot the calendar → safe todos execute as skill runs (seven phases, failure honesty, run records) → artifacts render → root's brief routine composes the morning brief.
- **D. The morning** — brief pushed → Neel works Today + the review queue → approve / decline / modify / correct (in the shell or in a mirror — both carry his authority) → the ledger captures everything → the system is slightly more him tomorrow.

## Build: the first implemented subset

Per PRD §11 (D15–D24, D30): area agents **Health, Finance/Money, Leisure**; project agent **2026 Travel Plan**; all other areas as root lenses. Connectors: Gmail (in), Google Calendar (mirror, two-way), Apple Health via signed Mac helper (in, D16), Finance automated pull (in, D17), Leisure bundle (in, D23/D27), Todoist (mirror, two-way, optional, D15). Shell as web app + PWA; runtime Mac-first (D22). Evolution = telemetry capture only. **Acceptance: the morning brief (D30).**

## Parked — deliberately not in this document

1. **Details phase:** per-flow mechanics, claim-op semantics, skill manifest format, scope declaration format, ingestion-filter format, mirror reconciliation mechanics, interpretation timing, todo-write concurrency, review-queue state machine.
2. **Stack phase:** language/runtime, storage engines (D20 assigns roles — filesystem / relational / vector — not engines), runner implementation, shell tech, process model, model-gateway wiring (D28), tunnel/auth mechanism.
3. **PRD open items:** Leisure media specifics beyond D27, Plaid vs alternative (D17), non-MVP area connectors, evolution design (D7/D10).

## Appendix — decision coverage

| Decisions | Where they land |
|---|---|
| D1 (single user) | Header; whole document assumes one Neel |
| D2, D34 | Shell; root agent (conversation default) |
| D3, D13, D18, D36 | The todo list (special artifact, gates, life-items, executor) |
| D4, D14, D19, D35 | Evidence + memories; root's view |
| D5, D10, D31 | Governance (rulebook, graduation, proposals; D31 = policy v1 content, installed at day zero) |
| D6, D15 | The calendar; mirrors two-way; Todoist as optional mirror |
| D7 | Superseded by D10; evolution parked, telemetry contract carries it |
| D8, D26, D33 | Persona in root (core + modulation + dual voice; seeded day zero) |
| D9 | Specialist anatomy |
| D11, D12, D20 | Evidence documents; data-layer contract (export); derived indexes + storage *roles* (engines parked) |
| D16, D17, D21–D24, D27, D30 | Build subset |
| D22, D28 | Build subset (runtime); parked stack (process model, model gateway) |
| D25 | Shell (on-demand review interview) |
| D29 | Heartbeat (sequential order, readiness gates); shell notifications (quiet cadence) |
| D32 | This layout pass is that review, running as Neel goes |
