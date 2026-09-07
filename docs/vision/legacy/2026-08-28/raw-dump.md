# Life-OS v2 — Raw Thought Dump

Captured verbatim from Neel, 2026-08-22. Unordered, unfiltered. Synthesis happens separately.

---

1. life os is an ai agent that is a root orchestrator
2. each agent has 3 parts, one application that user uses to interact with the agent, to take inputs and also to show outputs
3. agent also has other data sources as input that it can pull from
4. the third part is memory but its multi layered, multi dimensioned memory here
5. So my Vision here is Creativity, Health, Home/House Hold, Learning, Leisure, Finance/Money, Relationships (family/friends/dating), Work etc etc are individual life areas
6. each area has an agent + app etc defined
7. life-os orchestrates all these agents
8. Orchestrator takes in different inputs and stores it as memory. I can tell how I want that memory to work, but individual agents also have their own memory — like the same data will lead to different interpretations/actions/memory storage by different life agents
9. the goal here is to enable inputs → run interpretation pipelines → surface useful pro-active insights

--- new axis ---

10. Now let's talk about another axis: data in / data out is helpful but not enough
11. we need a working surface, that's where todo list comes into picture
12. all the agents interface with this todolist
13. the goal is to populate and act on this todo list
14. root orchestrator decides safe / unsafe / review-with-me buckets on each todo

--- projects ---

15. Now comes the concept of projects
16. Projects are essentially an alternative slice of the same things. I am not sure how to achieve it but the way I envision it is: when defining a project we have a todo list specific to the project; the project is associated with one or more life areas and has access to memory/data of that life area. But the project has a 2-way sync memory with each of the life areas.
17. root orchestrator auto-slots todos in a calendar too

--- personality ---

18. So we have a memory, we have an acting surface, we need personality, preference, tones etc etc.
19. and all the agents are self-evolving with each correction / data point etc etc

---
(vision-level dump ended at #19 — "I have way more details I want to talk about but that's all about the vision")

--- details ---
20. I am trying to replicate myself as an agent essentially

--- decisions on open questions (2026-08-22) ---

D1. Audience: just me, forever. Single-user by design.
D2. Surfaces: one shell, area-specific views. Each area agent defines its views inside a single Life-OS app.
D3. Todo lists: one list; projects are views (saved slices) of it.
D4. Memory: raw input stored once, immutable. Every agent — INCLUDING the root orchestrator — stores its own interpretations linked back to the raw record.
D5. Authority: hard rules written by me (hard-blocked = unsafe); everything else starts as review and graduates to safe as the agent learns from approvals.
D6. Calendar: calendar is one of the data connectors (input AND output). Life-OS keeps its own schedule model and mirrors to any connected calendar; if none connected, Life-OS-owned calendar stands alone. In my case: Life-OS-owned, mirrored to Google.
D7. Evolution: deferred — details to come.
D8. Personality: one core persona, per-area modulation.

--- details ---

21. BTW Projects also have data inputs of their own
22. but projects have deadlines. For e.g. "travel to Alaska" as a project has itinerary, order confirmations, flight and hotel bookings as data; an agent that retrieves and works with me to figure out / add more data or insights, or do the bookings for me from the todo list etc; and eventually I could use it to reflect on my trip. Once the project is done or while the project is running, Finance and Leisure life areas are also updated as it costs money and I am doing a recreational trip.
23. the orchestrator's job is to figure out projects, todos, invoking other life agents, coming up with inference and patterns from a top-level view instead
24. [Pasted the Automation Runbook from the Codex + Obsidian + Todoist prototype — saved whole to `prototype-runbook.md` with a transferable-patterns extraction.] "ignore the references to obsidian and codex stuff, i made a sample replica using codex and obsidian as storage and todoist as projects + todolist surface"
25. [Pasted the Obsidian vault root AGENTS.md from the prototype — saved whole to `prototype-vault-rules.md` with a transferable-patterns extraction.]
26. "/Users/neel/Library/Mobile Documents/iCloud~md~obsidian/Documents/Life has all the vault, read and infer the system I built in there" — [vault read in progress; findings to go in `prototype-system-inferred.md`]
27. "vault is only a reference implementation. In case of conflict between what I mentioned vs vault implementation, generally what I said wins — but surface it to me and clarify."

--- decisions on dump-vs-vault conflicts (2026-08-22) ---

D9.  (C1) Area agent = FULL agent: own instructions, own memory (sole writer), own connectors/data sources, own schedule, own views. Job Sweep generalized to every area.
D10. (C2) Evolution: agents may change their own MEMORY and their own INSTRUCTIONS autonomously (versioned, rollback). Changes to the safe/unsafe/review POLICY are proposals requiring my approval.
D11. (C6) Store real source documents (bookings, receipts, statements, exports) as project/area data. Memory holds claims linking to them, never the documents.
D12. (C12) Storage: "we might have to think a mix here — vector db, regular db and some kind of filesystem." Open design item: three stores with clear roles.
D13. (C3, proposed, not yet confirmed) Two gates: inference → todo creation stays evidence-gated and lands as proposed; todo → execution uses safe/unsafe/review.
D14. (C5, proposed) "2-way sync" is not a mechanism; shared raw substrate + linked per-agent interpretations.

--- connectors ---

28. Let's talk connectors. I am thinking: the standard Gmail, Google Calendar for general context; we can use Todoist or make our own todo list; for Health read from Apple Health from my phone; for Money needs a Plaid connection to my accounts — are some I can think of.

--- paused 2026-08-22 ("I'll add later, pause here") — next: remaining connectors per area, evolution details, then PRD ---

--- resumed 2026-08-23 ---

29. We also need something like notes/docs — or artifacts I should say — of different shapes, for agents to output and for me to view. Artifacts can be reports, text, markdown, html, sheets, docs — anything really.

--- resumed 2026-08-24 ---

30. Evolution is out of scope for MVP for now, but we need to ensure we gather all the telemetry data to implement self-evolution later.

--- resumed 2026-08-28 ---

31. Well, to sum it up, I expect multiple layers:
    (1) the DATA layer with ingestion pipelines for regular data updates (stimulus);
    (2) then the BRAIN layer where interpretations, pattern detection, preference detection, priority detection, execution instructions happen;
    (3) then the EXECUTION layer, or hands and legs — they are the tools and scripts etc etc;
    (4) and then the ARTIFACT layer — the layer that the user sees; the output could be external apps, internal apps, or standalone artifacts like docs, PDFs etc etc;
    (5) and finally RE-CONCILIATION and RE-ALIGNMENT — see what the user is doing with the artifacts and outputs, see what the user wants, and adapt future requests; create skills and memories, update skills and memories etc etc.

--- open-items pass (2026-08-28) ---

D15. Todo list: Life-OS-native canonical list; Todoist as optional mirror connector.
D16. Mobile/Health: signed Mac helper app reads Apple Health via HealthKit (available on macOS 26+); PWA for mobile capture + review queue. No native iOS in MVP.
D17. Finance MVP: automated pull required — "either Plaid or an automation that can pull data other ways" (e.g. Gmail statement/alert parsing, scripted fetch). Manual file-drop is fallback only.
D18. D13 confirmed (two gates) + addition: agents check the todo list for an existing equivalent BEFORE creating a todo (duplicate check at creation).
D19. D14 confirmed (no sync; shared raw substrate + linked interpretations).
D20. Storage split confirmed — "right tool for the right choice": filesystem = raw/documents/artifacts (+ human-readable export), relational = claims/todos/projects/runs/telemetry/policy/calendar, vector = derived retrieval only.
D21. MVP full agents: Health, Finance/Money, Leisure. All other areas (incl. Work) start as root-maintained memory lenses and graduate to full agents later.
D22. Runtime: Mac-first. Daemon + DB + files on the Mac; PWA reachable via Tailscale/tunnel. (Mitigate nightly-run dependency on Mac being awake via launchd scheduled wake.)
D23. Leisure agent data sources: ALL of — captures + review interview; media services (specific services TBD); calendar + scoped Gmail bookings (concerts, restaurants, travel); Mac screen/app usage (flagged: sensitive, needs privacy handling).
D24. First project agent: 2026 Travel Plan (already active in the vault; the Alaska-pattern worked example).
D25. Weekly review interview: kept, but ON-DEMAND ONLY — no scheduled ping. (Noted risk from prototype history: unprompted rituals die; accepted.)
D26. Persona seed: Vault Voice Lab only. Behavioral principles come from policy, not a persona doc.
D27. Leisure media services: Goodreads/StoryGraph (reading), Steam/PSN (gaming), plus manual inputs. No music/TV tracking for now.
D28. Model strategy: multi-provider via ai-sub-proxy (Neel's own project — local OpenAI/Anthropic-compatible server on the Mac that runs calls through logged-in CLI subscriptions instead of metered API keys). Keep v1-style cost/usage telemetry.
D29. Cadence + notification: nightly pipelines (launchd wake) + one MORNING BRIEF via PWA push; quiet otherwise except safe-bucket confirmations and time-sensitive review items.
D30. MVP acceptance criterion: THE MORNING BRIEF — wake up to today's calendar with auto-slotted todos, what each MVP agent noticed yesterday, proposals in review, all traceable to evidence.
D31. Initial hard "unsafe" rules (policy v1, all four): (1) no money movement — payments/transfers/purchases/subscriptions (bookings are always review, never safe); (2) no sending messages/email to anyone (drafts allowed); (3) no destructive deletion of data anywhere — archive/trash with manifest only; (4) no account/credential changes — sign-ups, logins, permission grants.
D32. Next step: Neel does a review pass of VISION.md and PRD.md before any technical work.

--- system-layout pass (2026-08-28, with Claude) — WORKING decisions, "I am figuring this out as I go"; revisable ---

D33. Persona is dual: outward-facing output (email drafts, messages) is written AS Neel, in his voice; with Neel, the system is a second self that speaks in its own voice while modeling his judgment. (Refines D8/D26.)
D34. Conversation defaults to the root agent — one face generally; Neel can explicitly choose to talk to any specialist agent directly. (Refines D2.)
D35. Root thinks over interpretations + unclaimed raw: cross-area patterns come from specialists' claims; root reads raw evidence only in its lens areas and where no specialist's scope claimed it. (Refines D4.)
D36. Todos are life-items only: routines/runs are operational state, never todo items. Every todo is Neel-meaningful; its executor may be Neel or an agent (agents auto-do safe items; Neel can assign items to an agent). (Refines #11–#13.)

--- output of the pass: `SYSTEM-LAYOUT.md` (pieces + contracts + flows; no tech stack) ---
