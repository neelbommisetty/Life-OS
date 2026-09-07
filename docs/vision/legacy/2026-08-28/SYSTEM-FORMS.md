# Life-OS v2 — System Forms

Status: DRAFT v0.1 — 2026-08-28. Companion to `SYSTEM-LAYOUT.md` (v0.1), `VISION.md` (v0.5), `PRD.md` (v0.6). The concrete-form pass: for each piece of the layout, **what kind of thing it is in the running system**, with 1–3 candidate engines and a working leaning. This document opens SYSTEM-LAYOUT §Parked item 2 ("stack phase") at leaning altitude only — every choice here is a **working decision** (proposed D37+, revisable) unless it restates D1–D36. **No schemas, no API design, no code** — that is the details phase.

Vocabulary: **form** = the kind of thing a piece is (daemon, DB rows, library module, webapp, launchd job) · **candidate** = a real engine that could be it · **leaning** = current working choice, revisable.

## 0. The shape of the running system

Before the pieces: the process model, because every form below references it.

**Form: ONE long-running user-space daemon — "the Life-OS daemon" — plus three satellites that must be separate:**

1. **ai-sub-proxy** — already exists: Neel's Bun service at `localhost:58242`, routing model calls through logged-in CLI subscriptions (D28). Not built here.
2. **The signed Mac helper** — Swift, because HealthKit demands a signed native app (D16). It also takes the other native reads (§4b).
3. **launchd / pmset** — the OS layer: wakes the Mac and keeps the daemon alive. Not a process of ours at all.

The daemon contains everything else: the runner, the heartbeat's scheduler, governance and telemetry as modules, all software connectors, data-layer access, and one HTTP server (API + shell static assets + web push).

**Leaning: single process.** One user, zero ops, and a single writer process is what makes an embedded database unconditionally safe. Rejected alternative: service-per-piece — IPC and orchestration cost with no isolation benefit for one Neel. Revisit only if a second writer process ever appears (coupling §C2).

**Language/runtime — candidates:** TypeScript on **Bun** · TypeScript on Node · Python.
**Leaning: TypeScript on Bun.** ai-sub-proxy is already a Bun service on this Mac (proven pattern), `bun:sqlite` is built in, one language spans daemon and shell, and fast cold start suits launchd-driven wakes. Python wins only if LangGraph wins the agent loop — it doesn't (§6). The loop choice and the language choice are one decision (coupling §C1).

## Form summary

| # | Piece | Form | Candidates → leaning |
|---|---|---|---|
| 1 | Root agent | DB rows, not code | form is the decision |
| 2 | Specialist agents | Same rows; projects add lifecycle columns | form is the decision |
| 2b | The factory | Library module + template records | form is the decision |
| 3a | Data: relational | Embedded DB, one file | SQLite · Postgres → **SQLite** |
| 3b | Data: vector | Derived index beside the DB | sqlite-vec · LanceDB → **sqlite-vec** |
| 3c | Data: filesystem | Plain directory tree under a user-data root | plain dirs (· git on export tree) → **plain dirs** |
| 3d | Artifacts | File + metadata row; `live` = saved query, no file | form is the decision |
| 4 | Connectors | In-process daemon modules, one interface | per-connector table (§4) |
| 4b | Mac helper | Signed Swift app owning all native reads | file-drop · local HTTP → **file-drop** |
| 5 | The shell | SPA + installable PWA, served by the daemon | Vite+React · Next.js · server-driven → **Vite+React** |
| 5b | Reachability | Tailnet-private HTTPS | Tailscale Serve · Cloudflare Tunnel → **Tailscale** |
| 5c | Push | web-push (VAPID) module in the daemon | decided in effect (D16/D29) |
| 6 | Agent runner | The library module that is the product | AI SDK thin loop · pi-mono · Claude Agent SDK · LangGraph/Mastra → **thin loop on Vercel AI SDK** |
| 6b | Model access | ai-sub-proxy, existing infra (D28) | decided |
| 7 | Heartbeat | launchd+pmset (machine) + in-daemon scheduler (registry) | launchd-only · in-daemon-only · both → **both** |
| 8 | Governance | Pure module + versioned policy rows | TS module · OPA/Cedar → **TS module** |
| 9 | Telemetry | Append-only tables in the relational store | tables · JSONL · OTel → **tables** |

## The pieces, in concrete form

### 1. Root agent — rows, not code

**Form:** an agent record in the database, interpreted by the runner: versioned instructions, persona versions (seeded from the Vault Voice Lab spec, D26), lens namespaces with their scope grants, schedule rows, view config. Root has **zero code of its own** — conversation handling, routing judgment, triage, slotting, and brief authoring are the runner executing root's record with root's context. There is no candidate table because the form *is* the decision: it restates "agents are data, not code" (SYSTEM-LAYOUT §2b) concretely.

### 2. Specialist agents — the same rows

**Form:** one agent record each, same shape (D9 uniform anatomy = uniform row shape): instruction versions, declared scope, memory namespace, skills refs, schedules, view config. Project agents are the same records plus deadline and lifecycle columns — not a second kind of thing.

### 2b. The factory — a module plus template rows

**Form:** a library module inside the daemon, plus **template records** in the database. Templates are data too. Birth = insert rows + grant scope + inherit rulebook; graduation = rename ownership of a lens namespace; closing = flip lifecycle + archive per the data-layer contract. **No code generation, ever** — a new agent never means new code.

### 3. The data layer — one database file, one directory tree, one derived index

**3a. Relational** — claims, todos, projects, runs, telemetry, policy, calendar, system records (D20).
**Form:** an embedded database — one file on the Mac. **Candidates:** SQLite (WAL mode, via `bun:sqlite`) · Postgres. **Leaning: SQLite.** A single writer process (§0) makes it unconditionally safe; the file *is* the backup unit; zero operational surface. Postgres only if the process model ever fragments.

**3b. Vector** — derived retrieval only, never canonical (D20).
**Form:** a derived index living beside (or inside) the database file. **Candidates:** sqlite-vec · LanceDB. **Leaning: sqlite-vec** — same file family, and because the index is derived-and-rebuildable this is the lowest-stakes choice in the document. Two caveats: extension loading on macOS needs a non-Apple SQLite build (LanceDB is the escape hatch, coupling §C4), and **ai-sub-proxy exposes no embeddings endpoint** — the embedding source is an open question (§Open).

**3c. Filesystem** — raw evidence documents, artifact files, the human-readable export (D11/D12).
**Form:** a plain directory tree under one user-data root (e.g. `~/LifeOS/`), with the database as the index over it. **Leaning: plain dirs**; git on the export tree is optional free history. The layout itself is details-phase.

**3d. Artifacts — file + row; how one gets made.**
**Form:** an artifact is **a file on disk plus a metadata row** carrying what SYSTEM-LAYOUT §3 requires — type, producing agent, generating run, evidence links, `regenerable | precious`, `snapshot | live`. A file without a row does not exist to the system.

**Generation:** inside a skill run. The agent's model loop emits the content; the runner persists it through **one data-layer call** — write file + insert row + link evidence together. That call is the *generated write* mutation class, so artifact creation is gated (before) and ledgered (after) like everything else. **Agents never touch the filesystem directly; the data layer is the only writer.**

By type — and the type list is open-ended: **adding an artifact type costs a gallery renderer, not a new mechanism** (the row's `type` + a way to display it; generation and provenance are identical for all):

- **Markdown** — the native case, models emit it directly; the default; the gallery renders it.
- **HTML** — model-written single file for richer one-offs; rendered **sandboxed (iframe)** in the gallery — agent-generated HTML never runs with shell privileges.
- **Web app** — an *interactive* single-file HTML+JS artifact (a comparison explorer, a what-if calculator), same sandbox. **Boundary:** a web-app artifact is self-contained — its data baked in at generation, a `snapshot`. The moment it needs *live* data it is not an artifact but a **view contributed to the shell** (piece 5's live-query mechanism) — that keeps sandboxed agent output and privileged live queries from ever being the same thing.
- **Presentation** — a single-file HTML slide deck (paged HTML; model-writable like any HTML artifact); PDF export via headless render if ever needed.
- **Sheet** — structured rows, usually from deterministic skill code, rendered as a table.
- **Image** — mostly *ingested* evidence (photos, screenshots, D11); when generated: **SVG** is model-native and the leaning for charts/diagrams; raster generation needs an image model ai-sub-proxy doesn't route — parked with a note (§Open).
- **PDF/doc** — overwhelmingly ingested evidence, not generated; generation (headless-render from HTML) parked until needed.
- **`live` artifacts are not files at all** — a saved query + view definition the shell renders on demand ("every view is a live query"). The two special artifacts are the extreme case: the todo list and calendar are pure relational tables + shell views, no file ever. `snapshot` is what becomes a file.

**Boundary — the runner writes, agents author.** The runner performs every artifact write but is never the author: every `producing agent` is an agent; the runner has no scope, memory, or policy slice to be accountable with. The runner's own outputs are system records and ledger entries, never artifacts — a failed run surfaces as its run record in the shell, not as a "failure report" artifact; the morning brief's author is root, the runner merely executes the routine.

### 4. Connectors — modules in the daemon, one native helper

**Form:** in-process daemon modules behind one connector interface, fired by the schedule registry. No process boundary needed: a failing connector writes its typed no-signal record and moves on — isolation buys nothing here. The exception is native reads (§4b).

| Connector | Form | Candidates → leaning |
|---|---|---|
| Gmail (in) | in-process module, OAuth; per-agent scoped queries **are** the ingestion filters | Gmail API · IMAP → **Gmail API** — server-side query/label filtering is the filter mechanism |
| Google Calendar (mirror, two-way, D6) | in-process module | Calendar API incremental sync tokens — decided in effect |
| Todoist (mirror, two-way, optional, D15) | in-process module | polling · webhooks → **polling** — webhooks need a public endpoint; single-user cadence doesn't |
| Finance automated pull (D17) | in-process module either way | Gmail statement/alert parsing · Plaid · scripted fetch → **start with Gmail parsing** — zero new external dependencies, uses already-scoped mail; Plaid stays the honest upgrade path (PRD open item) |
| Apple Health (D16) | rides the Swift helper (§4b) | decided |
| Leisure: reading (D27) | file-drop module | Goodreads · StoryGraph exports → **export files** — neither has a usable public API; low cadence |
| Leisure: gaming (D27) | in-process module | Steam Web API (official) · psn-api (unofficial) → Steam solid; **PSN best-effort, flagged fragile** |
| Leisure: screen/app usage (D23, sensitive) | rides the Swift helper | helper sampling · ActivityWatch · Screen Time DB (restricted, fragile) → **helper** — sensitivity tag applied at ingestion |
| Later per PRD (GitHub/Linear, Drive, …) | same in-process pattern | named, not designed |

**4b. The Mac helper.**
**Form:** one **signed Swift app** (login item / menu bar) owning *all* native reads: HealthKit (D16, the reason it must exist) and Leisure screen/app usage sampling (D23) — one signed, auditable binary for every native and sensitive read, instead of a second native artifact. **Hand-off candidates:** watched file-drop directory · local HTTP POST to the daemon. **Leaning: file drop** — the simplest possible contract; the daemon ingests drops as ordinary evidence with provenance.

### 5. The shell — a SPA/PWA the daemon serves

**Form:** a single-page web app, installable as a PWA (D16), built to static assets and **served by the daemon itself** — one process, one port, one origin. Views are live queries via the daemon's API (plus a server-push channel, SSE-class, for live updates); capture and conversation ride the same API.

**Candidates:** Vite+React SPA · Next.js · server-driven (HTMX-style). **Leaning: Vite+React.** The API is the daemon's, so Next's server layer buys nothing and breaks the single-process shape (coupling §C5). Server-driven stays a candidate only if the SPA proves heavier than the product needs.

**5b. Reachability + auth.** **Form:** tailnet-private HTTPS. **Candidates:** Tailscale Serve · Cloudflare Tunnel. **Leaning: Tailscale** — named in D22, and tailnet identity is most of the auth story for one user.

**5c. Notifications.** **Form:** a web-push (VAPID) module in the daemon pushing to the iOS Safari PWA (supported ≥16.4, requires add-to-home-screen). Decided in effect by D16/D29; the morning brief rides this.

### 6. The agent runner — the module that is the product

**Form:** a library module inside the daemon — *the* module: load agent record → assemble context from rows (memory tiers, working artifacts, retrieval) → governance gate (before) → agent loop → telemetry write (after). Skills' seven phases run inside it, producing a run record.

**Candidates for the agent loop:** a thin custom loop on the **Vercel AI SDK** (`@ai-sdk/openai-compatible`) · **pi-mono** (minimal TS loop + unified provider layer) · **Claude Agent SDK** · **LangGraph / Mastra**.

**Leaning: own thin loop on the Vercel AI SDK.** The runner's shape — deterministic gate before, ledger after, prompts assembled from database rows — exists in no framework; the loop is the small part. Against the alternatives: Mastra brings its own memory model, which collides with the data layer being the product; LangGraph drags in Python (its JS port is second-class) plus graph machinery the schedule registry already covers; the Claude Agent SDK is Anthropic-shaped and its permission harness would shadow Life-OS governance — kept as a candidate for coding-heavy skills only. The AI SDK is ai-sub-proxy's own documented client — a proven pairing.

**6b. Model access — ai-sub-proxy (D28), existing infrastructure, not built here.** Separate Bun service at `localhost:58242/v1`, OpenAI and Anthropic wire formats, one key per provider, model aliases per capability tier. Consequences the runner must absorb: the proxy is **stateless** → the runner owns transcripts; **one tool call per reply** → a stepwise loop; **no embeddings endpoint** → §3b's open question; the proxy logs usage, but cost telemetry is still written to the ledger (§9) — the ledger is capture-complete on its own.

### 7. The heartbeat — launchd wakes the Mac; the daemon owns the schedule table

**Form: two layers, both real.** Machine level: a launchd plist keeps the daemon alive (KeepAlive) and pmset repeat-wake brings the Mac up for the nightly window (D22/D29). Registry level: an in-daemon scheduler over the schedule table — dependencies, readiness gates, sequential order, firing reports — with a croner-class library parsing cadence and the gate/dependency logic hand-rolled over rows.

**Candidates:** launchd-only · in-daemon-only · both. **Leaning: both** — effectively decided by D22+D29: launchd cannot evaluate readiness gates, and the daemon cannot wake the Mac. Note: pmset wake scheduling is an admin-privileged install step — it belongs on the day-zero list (SYSTEM-LAYOUT §2b).

### 8. Governance — a pure module plus versioned policy rows

**Form:** a pure library module inside the runner's path; the rulebook as **versioned relational records** with a human-readable projection (D12). Deterministic, unit-testable, consulted on every action, outside every agent's self-editable substrate — the module shape is the contract's natural home.

**Candidates:** plain TS module · a policy engine (OPA/Cedar — named and rejected: a service plus a DSL for four hard rules and a bucket table is machinery without a customer). **Leaning: TS module.**

### 9. Telemetry — append-only tables

**Form:** append-only tables in the relational store (D20 already places telemetry there), written by a runner-internal module identically around every run; exported via the data-layer projection contract; **read by nothing until evolution exists**.

**Candidates:** tables · JSONL ledger files · an OTel stack (rejected — infrastructure for problems one user doesn't have). **Leaning: tables.**

## The picture

Full visual: [`system-forms.html`](system-forms.html) — the system diagram redrawn with every box labeled `piece · form · leaning`. Simplified:

```
                        NEEL'S MAC ─────────────────────────────────────────────┐
  EXTERNAL SERVICES     │                                                       │
  Gmail ───────┐        │  ┌─ LIFE-OS DAEMON — TypeScript on Bun, ONE process ┐ │
  GCal ────────┤        │  │  HTTP server: API + shell assets + web push      │ │
  Todoist ─────┼────────┼──│  connectors (in-process modules)                 │ │
  bank/Plaid ──┤        │  │  heartbeat scheduler (schedule table)            │ │
  Steam/PSN ───┘        │  │  ┌──────── AGENT RUNNER (the product) ────────┐  │ │
                        │  │  │ governance gate → agent loop (AI SDK)      │  │ │
  exports (files) ──┐   │  │  │ → telemetry write   agents = DB rows       │  │ │
                    │   │  │  └────────────────────────────────────────────┘  │ │
                    ▼   │  └────────┬─────────────────────────┬───────────────┘ │
  SWIFT HELPER (signed) │           ▼                         ▼                 │
  HealthKit + usage ────┼──▶ ~/LifeOS/ file tree      SQLite (+ sqlite-vec)     │
  (file drop)           │    evidence · artifacts     claims · todos · runs     │
                        │    · export                 · policy · ledger         │
  CLAUDE / CODEX        │                                                       │
  subscriptions ◀───────┼── ai-sub-proxy :58242 (exists, separate Bun service)  │
                        │   launchd + pmset: wake Mac · keep daemon alive       │
                        └───────────────────────┬───────────────────────────────┘
                                                │ Tailscale (private HTTPS)
                                                ▼
                              PWA on iPhone ◀── web push (morning brief)
```

## Cross-piece couplings

- **C1. Loop ↔ language.** AI SDK / pi-mono → TypeScript; LangGraph → Python. Choosing TS/Bun forecloses LangGraph and vice versa — §0 and §6 are one decision.
- **C2. Process model ↔ SQLite.** The single-process daemon is what makes SQLite the obvious relational pick. If the shell API or connectors ever become separate writer processes, revisit toward Postgres.
- **C3. ai-sub-proxy ↔ runner + vector.** Stateless proxy + one-tool-call-per-reply → the runner owns transcripts and runs stepwise. No embeddings endpoint → the vector index needs its own embedding source (open question; deferrable because vector is derived-only).
- **C4. Bun ↔ sqlite-vec.** Extension loading on macOS needs a non-Apple SQLite build; LanceDB sidesteps this if it bites.
- **C5. Shell ↔ process model.** Next.js implies a second server; Vite static assets preserve one process / one port / one origin, which also simplifies Tailscale and auth.
- **C6. Swift helper ↔ Leisure.** Folding usage sampling into the HealthKit helper avoids a third native artifact and keeps sensitive collection behind one signed, auditable binary.
- **C7. Heartbeat ↔ day zero.** pmset wake scheduling is admin-privileged — a day-zero install step alongside policy v1 and persona seeding.

## Working leanings register — proposed D37+

Proposed continuations of the decision register, same standing as D33–D36: **working, revisable, not yet confirmed by Neel.** They graduate into `raw-dump.md` / `VISION.md` only on confirmation.

| # | Name | One line |
|---|---|---|
| D37 | Process model | One user-space daemon + three satellites (ai-sub-proxy, signed Swift helper, launchd/pmset). |
| D38 | Language/runtime | TypeScript on Bun, daemon and shell. |
| D39 | Storage engines | Relational = SQLite (WAL); vector = sqlite-vec, derived only; files = plain dirs under one user-data root. |
| D40 | Agent loop | Own thin loop on the Vercel AI SDK through ai-sub-proxy; no agent framework owns the runner. |
| D41 | Shell stack | Vite+React SPA/PWA served by the daemon; Tailscale for reachability; web-push (VAPID) for notifications. |
| D42 | Heartbeat form | launchd + pmset at machine level; in-daemon scheduler owns the schedule table. |
| D43 | Governance/telemetry form | Plain modules + versioned/append-only tables; no policy engine, no OTel. |
| D44 | Connector form | In-process daemon modules; all native reads consolidated in the one Swift helper via file drop. |

## Open questions from this pass

1. **Embedding source** for the vector index — local model vs a metered API; ai-sub-proxy has no embeddings endpoint. Deferrable: vector is derived-only.
2. **Finance:** Gmail-parse first is the leaning; **Plaid vs alternatives** stays genuinely open (PRD §open items).
3. **PSN** ingestion is unofficial-API territory — fragile by construction; decide how much Leisure-gaming completeness matters.
4. **Screen/app usage privacy handling** (D23 flagged sensitive): retention, visibility, and which agents may ever read it.
5. **pmset admin step** at day zero — acceptable, or find a wake mechanism that needs no privilege?
6. **Morning brief form:** structured rows with per-line evidence links + a dedicated view, vs a markdown artifact with links. D30's every-line-traceable pulls toward structured.
7. **Raster image generation:** ai-sub-proxy routes no image model; if agents ever need generated raster images (vs model-native SVG), an image-generation path has to come from somewhere. Parked until a real need appears.

## Parked — deliberately not in this document

Schemas and table design · API design · directory layout of `~/LifeOS/` · migration mechanics · auth mechanics beyond "Tailscale + authenticated" · skill manifest / scope declaration / ingestion-filter formats (details phase, per SYSTEM-LAYOUT §Parked 1) · any code.

## Appendix — decision coverage

| Decisions | Where they land here |
|---|---|
| D11, D12, D20 | §3 — storage roles → engines (leaning altitude); export projection; artifacts as files + rows |
| D16 | §4b Swift helper; §5 PWA; §5c push |
| D17, D23, D27 | §4 connector table (Finance path, Leisure bundle, sensitivity) |
| D22 | §0 Mac-first daemon; §5b Tailscale; §7 launchd/pmset |
| D25, D29, D30 | §5c push cadence; §7 sequential/nightly; brief open question (§Open 6) |
| D26, D33 | §1 persona as versioned rows |
| D28 | §6b ai-sub-proxy consequences |
| D5, D10, D31 | §8 governance module + rulebook rows |
| D9, D14, D19 | §1–§2 agents as rows, uniform anatomy, nothing copied |
| D36 | §3d live artifacts (todo list, calendar as tables + views) |
