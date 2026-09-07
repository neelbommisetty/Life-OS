# Life-OS — Vision

Status: DRAFT v0.5 — 2026-08-28. Synthesized from `raw-dump.md` (#1–#19); layout pass added working decisions 33–36. System layout: `SYSTEM-LAYOUT.md`. Expect churn.

## The intent

**Replicate the user as an agent.** Life-OS is not an assistant that helps Neel; it is a system that models Neel — how he interprets his life, what he'd decide, what he'd do next — closely enough to act on his behalf, with him in the loop only where it matters.

## One sentence

Life-OS is a root orchestrator agent that runs a set of life-area agents, each with its own surface, data sources, and memory, all of which populate and act on one shared todo list — so that the user's life is interpreted proactively and advanced without the user doing the planning.

## What it is

- **An agent, not an app.** The orchestrator is the product. Screens exist to feed it inputs and show its outputs.
- **A system of agents, partitioned by life area.** Creativity, Health, Home/Household, Learning, Leisure, Finance/Money, Relationships (family, friends, dating), Work — and more as needed. Each area is its own agent.
- **An interpretation engine.** Inputs → interpretation pipelines → proactive insights. One raw input can mean different things to different area agents, and each stores its own interpretation.
- **An operator with a working surface.** Insight alone is not enough. The shared todo list is where the system's output becomes action, and agents both populate it and execute against it.
- **Governed by the user.** Every todo is bucketed by the orchestrator as *safe* (act), *unsafe* (don't), or *review with me* (ask). Memory behavior is user-configurable. Everything is reviewable.
- **Self-evolving.** Every correction and every new data point updates the agents.

## What it is not

- Not a task tracker with an AI chat beside it (v1).
- Not a single chat window.
- Not a generic assistant with no model of the user's life.

## Anatomy of an agent

Every agent — the orchestrator and every life-area agent — has three parts:

1. **Application surface** — how the user puts inputs in and sees outputs.
2. **Data sources** — external inputs the agent pulls from on its own.
3. **Memory** — multi-layered, multi-dimensional; owned by the agent; shaped by how that agent interprets the world.

## The core loop

```
inputs (user + data sources)
  → orchestrator ingests, stores to orchestrator memory
  → fan-out to life-area agents
  → each agent interprets through its own lens, updates its own memory
  → agents emit insights and todos
  → orchestrator triages todos: safe / unsafe / review
  → orchestrator auto-slots todos into the calendar
  → agents act on safe todos; user acts on review todos
  → outcomes and corrections feed back into memory and agent evolution
```

## The five layers (2026-08-28)

Neel's summing-up of the architecture. Every agent — root, area, project — participates in all five.

| # | Layer | What happens there |
|---|---|---|
| 1 | **Data** (stimulus) | Ingestion pipelines for regular data updates: connectors, capture, raw substrate. |
| 2 | **Brain** | Interpretation, pattern detection, preference detection, priority detection, execution instructions. Memory lives here. |
| 3 | **Execution** (hands and legs) | Tools and scripts acting on the world: the todo list, calendar slotting, bookings, connector writes. |
| 4 | **Artifact** | What the user sees: external apps, internal apps, standalone artifacts (docs, PDFs, sheets, HTML, reports). |
| 5 | **Reconciliation / re-alignment** | Watch what the user does with the outputs; see what the user wants; adapt future behavior; create and update skills and memories. MVP captures the telemetry; evolution itself is post-MVP (D10 note). |

## Structural concepts

| Concept | Role |
|---|---|
| **Root orchestrator** | Ingests inputs, owns cross-area memory, routes to agents, triages and schedules todos, owns personality/preference layer. |
| **Life-area agent** | Interprets inputs for one area; owns area memory, data sources, surface; proposes and executes todos. |
| **Todo list** | The single working surface. All agents read and write it. Goal: populate it and act on it. |
| **Project** | An alternative slice of the same system: its own todo view, its own data inputs, linked to one or more life areas, with two-way memory sync to each. A project has the same three-part anatomy as an agent. |
| **Calendar** | Where the orchestrator commits todos to time. |
| **Personality / preferences / tone** | How the system presents itself and makes judgment calls. Sits on top of memory and the acting surface. Dual voice: outward output as Neel; with Neel, its own voice (decision 33). |
| **Evolution** | Agents change with every correction and data point. |

## Principles (carried from v1 where still true)

- Outcome-first: show what changed and what's next.
- Calm control: autonomy without surprises; always reviewable and reversible.
- Proactive, not pushy.
- No judgment, no guilt mechanics.
- Predictable reliability over cleverness.

## Decisions (2026-08-22)

| # | Question | Decision |
|---|---|---|
| 1 | Audience | **Single user, forever.** Life-OS models one person. No tenancy, no personas. |
| 2 | Surfaces | **One shell, area-specific views.** One Life-OS app; each area agent defines its own views inside shared chrome (todo, calendar, chat). |
| 3 | Todo lists | **One list; projects are views.** Every todo lives in the master list. A project is a saved slice. Nothing to sync. |
| 4 | Memory | **Raw once, interpretations per agent — including the root.** Every raw input is stored once, immutably, by the orchestrator. Each agent (orchestrator, area agents, projects) stores its own interpretations linked back to the raw record. "2-way sync" = sharing interpretations over a common raw substrate. |
| 5 | Authority | **Hard rules + learned trust.** User writes a small set of hard rules → *unsafe* (hard-blocked). Everything else starts as *review* and graduates to *safe* as the orchestrator learns from approvals. |
| 6 | Calendar | **Calendar is a connector (in + out).** Life-OS owns its schedule model; mirrors to any connected calendar. If none is connected, the Life-OS calendar stands alone. Neel's setup: Life-OS-owned, mirrored to Google Calendar. |
| 7 | Evolution | **Deferred.** What an agent may change about itself (memory / instructions / policy / tools) to be specified in the details pass. |
| 8 | Personality | **One core persona, per-area modulation.** Global identity and values (it's Neel); each area agent adjusts tone and priorities. |

## Decisions from reconciling with the prototype vault (2026-08-22)

The Obsidian/Codex/Todoist vault is a reference implementation. Where the v2 vision conflicts with it, the vision wins; conflicts were surfaced and resolved as follows:

| # | Decision |
|---|---|
| 9 | **Area agent = full agent.** Own instructions, own memory (sole writer), own connectors, own schedule, own views. The prototype's Job Sweep project agent, generalized to every life area. |
| 10 | **Evolution scope.** Agents change their own memory and their own instructions autonomously (versioned, reversible). Changes to the safe/unsafe/review policy are proposals the user approves. (Closes decision 7.) **MVP note (2026-08-24): evolution itself is out of MVP scope — but MVP must capture all telemetry needed to build it later** (corrections, approvals/declines, overrides, outcomes per agent action). |
| 11 | **Real documents are data.** Projects and areas store actual source documents (bookings, statements, exports). Memory holds claims that link to them, never the documents themselves. |
| 12 | **Storage is a mix** — vector store + relational store + filesystem — with roles to be defined in the PRD. Human-readable projection stays a goal (it is what made the prototype's runtime swappable). |
| 13 | **Two gates on the todo list** (proposed). Inference → todo creation is evidence-gated and lands as *proposed*. Todo → execution is governed by safe/unsafe/review. |
| 14 | **No memory "sync."** One raw substrate; each agent's interpretations link to canonical records. Projects read area memory; area agents read project interpretations; nothing is copied. |

## Working decisions from the system-layout pass (2026-08-28)

Recorded while producing `SYSTEM-LAYOUT.md`. Working decisions — "I am figuring this out as I go"; revisable.

| # | Decision |
|---|---|
| 33 | **Dual persona.** Outward output (drafts, messages) is written *as Neel*, in his voice; with Neel the system is a second self speaking in its own voice. (Refines 8.) |
| 34 | **Conversation defaults to root.** One face generally; Neel can explicitly talk to any specialist agent directly. (Refines 2.) |
| 35 | **Root thinks over interpretations + unclaimed raw.** Cross-area patterns come from specialists' claims; root reads raw evidence only in its lens areas and where no specialist's scope claimed it. (Refines 4.) |
| 36 | **Todos are life-items only.** Routines/runs are never todo items; every todo is Neel-meaningful, with an executor — Neel or an agent. (Refines the todo-list concept.) |

## Inherited from the prototype (carried forward as principles)

- Capture the user's words first, every turn, before any other mutation.
- One canonical home per fact; everything else links.
- One writer per artifact.
- Rules are explicit policy, never emergent memory; generated memory never overrides a direct instruction.
- Evidence-first, non-diagnostic, no coaching, no reflection prompts, no self-report forms.
- Completion requires completion evidence; absent ≠ done; auth failure = incomplete evidence, never zero work.
- No-signal semantics are distinct: no evidence ≠ not checked ≠ stale ≠ failed ≠ denied ≠ ambiguous.
- Distill before archive; deletion only with a manifest and a survival cycle.
- Every view is a query over data; no hand-maintained "latest."
- Every run reports exact artifacts and errors.

## Open questions

- Storage roles: what lives in the vector store vs relational vs filesystem (decision 12).
- Connector model: calendar is the first in+out connector — which others are bidirectional (email, tasks, finance)?
- Confirm decisions 13 and 14 (proposed by Claude, not yet stated by Neel).
