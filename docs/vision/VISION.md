# Life-OS — Current Vision

Status: Current planning direction, adopted September 5, 2026. This document replaces the August planning set as the basis for further design. It describes intent and boundaries; proposed technology and build order remain revisable. The authorized implementation is the tools package and [shared tools API](API.md); the broader architecture below is not its implementation checklist. The Health web prototype has been removed.

## What Life-OS is for

Life-OS is Neel's bespoke, mobile-friendly personal software environment: a connected family of experiences for understanding his life, seeing what he intended to pursue, and acting with useful context.

Health, relationships, work, leisure, and other areas deserve different experiences. They belong to the same life and should share information. A person, project, intention, or event should be reachable wherever it matters without becoming a separate copy in each view.

The environment should grow as Neel discovers what is useful. A complete design for every area is not a prerequisite. Some material can remain a loose collection of notes until a specialized experience earns its place.

## Codex and the vault stay central

Codex remains the primary conversational input and executor of Neel's existing vault workflows and skills. The Life Obsidian vault remains active, canonical durable knowledge, governed by its current root and folder-local instructions.

The incremental addition is publishing selected, structured information from those workflows into a database that powers separately maintained application code. The application makes that information useful through custom views and direct interactions.

This direction does not require a new conversational agent, an in-app chat interface, an agent dashboard, or a replacement processing pipeline. Codex can also publish considered briefings and suggestions. Ordinary application code can select what to show based on freshness and available context.

Direct interactions in the website, such as scheduling, are compatible with Codex remaining the primary conversational input. Before introducing an interaction that changes durable information, define which system owns that information and how the change reaches the other relevant surfaces.

## The experiences

### A shared theme for every homepage

Neel's guiding theme for the overall homepage and each area's home is **where I was, where I am, and where I want to be**. Each experience should help him see his stated goals or desired direction, understand how he is tracking, and recognize meaningful changes over time.

This includes both objective and subjective evidence. Weight or body-fat measurements may support a graph when available. Emotions, reflections, and descriptions of daily life may be better expressed through dated words and a considered comparison. Subjective experience is first-class information; it does not need to become a numeric score.

Encouragement is part of the desired experience: help Neel notice real progress that might otherwise be easy to overlook. A comparison with a week ago is one example, not a fixed reporting window. Encouragement must be grounded in the available evidence, without inventing improvement, smoothing away setbacks, or treating missing information as a trend.

The desired destination comes from Neel's stated goals, intentions, and preferences. It may be measurable or qualitative, and may change. Where a destination or baseline is unknown, leave that uncertainty visible instead of prescribing a goal. The three-part theme guides the information presented; it does not require every homepage to use an identical layout or every record to fit a chart.

### The homepage follows current priorities

What Neel cares about will change over weeks and years. A Health home must not permanently center weight, body fat, sleep, HRV, or any other metric simply because it was available in the first dataset. Start with the current desired direction, then select the evidence and forms of presentation that explain it. Changing emphasis can change the headline, comparison period, featured measurements, reflections, and relevant actions while preserving the underlying history.

A small version belongs in the MVP. During an existing workflow or after an explicit change of direction, Codex can publish a considered current-focus record alongside selected data: the stated or suggested direction, why it is relevant, supporting sources, when it was considered, when it should be reviewed, and which supported content blocks to feature. Inferred focus remains a suggestion and must be distinguishable from Neel's explicit priority. Repetition alone does not establish importance, and recent activity does not automatically become a goal.

The application renders this record through a small set of reliable components: a trend, a dated comparison, a reflection, a stated goal or direction, and a relevant action. Components can be reordered or omitted, and all relevant history remains reachable. A visible explanation and a way to correct focus give Neel control; a temporary preview does not silently update his commitments or durable preferences.

Application code validates supported selections and handles freshness. It does not need to generate arbitrary new interface code on every run. A genuinely new kind of experience may still require new application code. Comprehensive preference learning and continuous context sensing are later possibilities, not MVP requirements.

### Perspective and operating views

Every homepage, including the overall home and each area's home, needs both a perspective on Neel's trajectory and an operating view of actual commitments. These are complementary surfaces over related records. The reflective focus may change; scheduled events and accepted tasks remain discoverable independently of that focus.

The operating view shows relevant upcoming calendar events with their actual times and locations, open tasks with their actual status and due dates, and stated intentions with their distinct status. An intention to work out is not a booked session; a calendar event is not attendance evidence; a past task due date is not proof that the underlying activity never happened.

The proposed interfaces call these views **Perspective** and **Plan**, with a compact upcoming-commitment summary visible from Perspective. Names and exact layout remain revisable. Calendar and task data refresh through ordinary provider adapters independently of when Codex last considered the reflective focus. A stale or failed source refresh remains visible. Focus selection cannot suppress due or scheduled commitments merely because another topic is more salient.

Adaptive perspective plus actual tasks and calendar commitments remain design guidance for future interfaces, not the current implementation scope.

### Overall home

The homepage brings together what matters now, what can wait, and what Neel said he wanted to pursue. It should help him reconnect with intentions and context across areas, rather than merely aggregate every record.

Its central story follows the shared theme: past context, current situation, desired direction, and evidence of movement between them. Relevant actions and suggestions support that story.

It may also surface new opportunities from outside the vault. Suggestions remain visibly distinct from commitments. Time, location, and current activity may improve relevance when those signals are actually available; the design must not pretend to have them.

Briefings and suggestions need clear freshness. A considered recommendation from an earlier day should not silently appear to be a current assessment.

### Relationships

People-centered views bring together relevant history, context, and associated actions. Neel should be able to start with a person and drill into what matters, or reach that same person through a project, event, or another area.

### Work

Work includes job search, technology learning, work intentions, and projects. Different activities can acquire specialized views over time. Useful notes do not need to be forced into a rigid workflow before their shape is understood.

### Leisure

Book and game libraries can include reviews, feelings, excitement, and possible things to read or play next. The experience should retain why something interests Neel, alongside factual library information.

### Tasks and calendar

The initial task surface mirrors Todoist, which remains the execution authority under the existing workflows. Neel ultimately wants task ownership in his own system. That is a future migration with an explicit transition, not an assumption introduced by displaying tasks.

Calendar initially uses Google Calendar underneath. Life-OS may offer scheduling interactions and eventually own scheduling itself. Calendar ownership changes likewise require a deliberate transition.

## Shared information, distinct views

People, areas, projects, updates, intentions, tasks, and events share relationships. These are useful conceptual building blocks, not a finalized database schema.

Published records should have stable identities, source links, and the relationships needed by the experiences that use them. A correction updates the relevant representation consistently across views. Views query shared records rather than maintaining their own versions of the same fact.

Keep stated intentions, suggestions, accepted tasks, scheduled events, and observed outcomes distinct. A suggestion is not a commitment; an intention is not proof of completion. Preserve the source and uncertainty needed to understand each record.

The database is initially an application-facing publication of selected knowledge, with explicit mappings for externally owned tasks and events. Publishing does not silently transfer authority away from the vault, Todoist, or Google Calendar.

## Publishing from existing workflows

A small authenticated publishing CLI, accompanied by a skill explaining when and how to invoke it, is the proposed bridge. Existing Codex workflows can invoke that bridge as an additional output step.

The skill provides guidance. Validation, consistent updates, safe retries, deduplication, and receipts belong in code. Skill matching alone cannot guarantee that every relevant change is published.

Vault writes and database writes are not atomic. A successful vault update can coexist with a failed publication. Failures need to be recorded, retried, and reconciled; the system must distinguish unpublished or stale data from current data. Receipts should make it possible to verify what was actually published.

No continuously running AI agent is necessary. A conventional worker may later handle retries or external synchronization if that need arises.

## Replaceable providers behind Life-OS interfaces

Neel wants the option to replace what Codex does with dedicated agents in the future, just as task and calendar ownership may move into Life-OS. Design the boundaries for that option now without building a second agent system upfront.

Life-OS should own the concepts and contracts used by its experiences. Codex, Todoist, and Google Calendar are initial providers behind those boundaries. Replacing a provider should preserve application-facing identities, relationships, and behavior wherever possible.

| Capability | Stable Life-OS boundary | Initial provider | Possible future provider |
|---|---|---|---|
| Tasks | Task records and supported task operations | Todoist adapter, with Todoist authoritative | Native Life-OS task service; optional Todoist mirror |
| Scheduling | Event records and supported scheduling operations | Google Calendar adapter, with Google authoritative | Native Life-OS scheduling service; optional Google mirror |
| Interpretation and workflow execution | Defined workflow inputs, permitted operations, publication outputs, and run receipts | Codex using existing vault workflows | Dedicated agents implementing the same workflow contracts |
| Durable knowledge | Source identities, links, and selected publication records | Existing Life vault and its governed workflows | The vault can remain in place even if the executor changes |

The website talks to Life-OS services rather than depending directly on provider-specific records. Local identities map to external identifiers, so a task's identity in the application does not have to change when its provider changes. Supported writes route to the current authority; a display mirror is not a second independent master.

During the first phase, a task edited in Life-OS would be written through to Todoist and reflected back in the local view, with pending or failed changes represented honestly. Once task ownership migrates, the same user-facing operation would write to the native task service, and Todoist could become an optional downstream mirror. Calendar follows the same ownership pattern. Conflict handling and the exact cutover are designed before enabling those transitions.

For intelligence, the publication API is the first useful boundary, but it is not the whole replacement contract. Future agents also need to know what evidence they may read, which workflow they are running, what actions are authorized, how corrections work, and how completion or failure is reported. Describe those contracts as each workflow is integrated, while leaving its current execution in Codex.

The publishing CLI should be a client of that stable service contract. A future agent can use the CLI or another client of the same API. Validation, authorization enforcement, deduplication, and receipts remain in ordinary code and apply regardless of the caller. Only expose the capabilities needed by the first slice; this does not require a general-purpose agent framework.

Portability does not mean identical judgment or an effortless swap. A replacement executor must demonstrate equivalent handling of representative updates, corrections, failures, and authorization boundaries before it receives write authority. Where a workflow writes to the vault, use one authorized executor at a time; changing the executor does not automatically change the vault's role.

This allows staged evolution: custom experiences over existing providers first, then replacement of a particular provider or workflow when useful. Native task ownership, native scheduling, and dedicated agents are independent future choices, not one all-or-nothing migration.

## Proposed technical shape

The current proposal is a private code repository outside the vault, a modular Next.js website and API hosted on Vercel, and shared PostgreSQL and authentication through Supabase. These are proposed implementation choices, not irrevocable product requirements. The privacy and hosting configuration of the existing repository has not been verified.

One repository could contain `apps/web`, `packages/data`, `packages/cli`, and `skills/publish`. Different experiences do not require separate deployments. Shared data and navigation should keep them connected while allowing each experience to evolve independently.

The code repository is the primary project folder. The vault can be attached as a secondary folder while remaining separate. Project attachment is not yet verified. Project instructions should explicitly require reading applicable vault rules before any vault work; isolation of the code checkout does not isolate a shared vault.

## Current implementation

The tools package provides tasks, calendars, and the first leisure-library cut through the [shared tools API](API.md) and HTTP-based `life` CLI. The former Health web app, sample data, and local snapshot workflow have been removed. Future web interfaces and the publishing bridge require separate scope and authorization.

## Principles to carry forward

- Build for Neel's actual life, with specialized experiences and shared context.
- Show what changed, what is current, and what the evidence supports.
- Preserve feelings, reflections, and uncertainty alongside structured facts.
- Keep suggestions distinct from commitments and outcomes.
- Make corrections traceable and publishing failures recoverable.
- Prefer predictable reliability and calm, useful presentation.
- Respect current vault rules and explicit authorization for external actions.
- Let new views earn their complexity through use.

## Decisions still to make

- Which homepage content would make a future interface useful?
- What is the smallest publication contract that supports those views and corrections?
- Which workflow inputs, permitted operations, and outputs must be explicit to support a future executor change?
- How will website edits be routed as particular direct interactions are introduced?
- What privacy, authentication, and deployment setup fits the selected data?
- Which retry and reconciliation mechanisms are needed for the first implementation?

These can be resolved incrementally. The broader product does not need to be fully specified before an authorized first slice begins.

## Earlier planning

The complete August 28 planning set is preserved unchanged in [legacy/2026-08-28](legacy/2026-08-28/README.md). It records a previous direction centered on a Life-OS agent runtime, specialist agents, and a Mac daemon. It is historical context, not the current implementation brief.

The connected life-area vision, evidence principles, and eventual ownership of tasks and scheduling carry forward. The custom agent runtime, replacement pipelines, agent-owned memory system, and broad original MVP are not requirements of this direction. Other older ideas can be reconsidered explicitly when useful.
