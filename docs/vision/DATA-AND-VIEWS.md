# Life-OS — data and adaptive views

Working architecture, September 5, 2026. This explains how to implement the behavior discussed in [Current Vision](VISION.md). It is a proposed contract, not a database migration or an implemented integration.

## Three inputs to a page

1. **Shared records:** what was reported, measured, intended, or changed, with stable identities, dates, relationships, and sources.
2. **A focus plan:** a considered selection of which direction and evidence to feature, and through which supported presentation blocks.
3. **An operating query:** current relevant tasks and calendar events, read independently of the focus plan.

The application assembles the page from these inputs. Codex does not need to generate an entire webpage each week or embed a copied task list in a narrative.

## Shared records

The first schema can stay small while retaining useful distinctions:

| Record | Minimum useful information |
|---|---|
| Area, person, project | Stable Life-OS identity, name, relationships to other records |
| Observation | Metric key, value, unit, measurement time or reporting window, source reference, measurement method where relevant |
| Update or reflection | Text, date of the experience, when recorded, whether direct report or interpretation, source reference |
| Intention or goal | Neel's stated direction, optional target and unit, status, relevant dates, sources; do not require a numeric target |
| Task | Stable identity, title, status, due date/time if any, priority, area/project/person links, current owner, external identity |
| Calendar event | Stable identity, title, start/end, timezone, all-day status where relevant, location, response/cancellation status, relationships, current owner, external identity |

Source references retain the source identity and location, provider version or update time when available, when last checked, and coverage/failure state. An observation's measurement date, a source's update date, and the time Life-OS last checked it are separate concepts.

The vault retains durable knowledge under its current rules. Publishing creates an application-facing representation of selected content. Todoist remains task authority and Google Calendar remains calendar authority until their ownership explicitly migrates.

## Focus plan

Codex publishes a compact, structured editorial plan. A proposed plan contains:

- Scope: the overall home, an area, or a project.
- The direction it represents, linked to a stated intention when one exists.
- Whether the focus is explicitly chosen by Neel or suggested from evidence.
- A short rationale and supporting record references.
- When the focus was considered, when it should be reviewed, and what it supersedes.
- An ordered list of supported blocks and the records or bounded selectors that supply them.

Supported blocks might include a measurement series, a before/current comparison, a reflection excerpt, a goal or qualitative direction, and a relevant action reference. The schema allows optional blocks rather than forcing every focus to have the same shape.

For example, a sustainable-rhythm plan can feature a qualitative direction, recent reflections about rest, and recorded sleep. A body-changes plan can feature the stated interest in reducing weight and a sparse plot of actual body measurements. Both operate over the same history. A future focus can select a different supported metric without changing the database's fundamental structure.

The plan passes references and structured selectors such as “recorded sleep for this area during these dates,” not raw SQL, arbitrary JavaScript, or copied provider payloads. Ordinary code validates permitted block types, record access, units, scope, date windows, and missing-data behavior. Truly new interactions or presentation types still require application development.

## Operating view

The operating view is a deterministic query over normalized tasks and events for the selected area or overall scope. It is not authored as a task-list snapshot by the model that writes the reflective focus.

- Upcoming events use actual start/end times and locations. Recurring occurrences need distinct instance identity and cancellation handling.
- Open tasks retain due dates and status. A due date that passed is a source fact; it does not establish that Neel failed to perform an activity.
- Undated tasks remain undated. Intentions without accepted tasks or scheduled events remain intentions.
- Task/event relationships can connect a plan to a booking without duplicating it or treating a booking as completion.
- Health relevance initially follows verified labels, links, and explicit mappings. A production view must disclose incomplete mapping or calendar coverage rather than presenting keyword matches as exhaustive.
- Ordering follows actual schedule and explicit task attributes. Reflective focus can add contextual links but cannot make due or scheduled obligations disappear.

The UI offers Perspective and Plan as complementary views, and keeps a compact commitment summary visible in Perspective. The same pattern applies across homepages. All-area Home can eventually aggregate records across areas without duplicating them.

## Freshness and ownership

The focus can be reconsidered during existing Codex workflows or after an explicit correction. Tasks and events refresh through conventional code on their own cadence or on opening the view. A calendar reschedule should appear without waiting for another model-generated briefing.

A later adapter can fetch the provider's current records into a normalized read model. The view includes source-check times and distinguishes a successful empty result from a failed, partial, or stale read. The current [local milestone](LOCAL-FIRST-SLICE.md) reads prepared snapshots from one validated file; it does not implement these provider adapters or automatic synchronization.

Writes route to the current authority. Completing a task or rescheduling an event requires an actual provider operation and readback, with pending/failure feedback. A checkbox in a local prototype must not pretend to complete a real task. In the eventual native-task or native-calendar migration, the adapter changes behind the same application-facing contracts.

## Publication path

1. Codex executes an existing workflow within its established permissions.
2. The publishing client sends selected changed records and, when appropriate, a focus plan to an authenticated Life-OS service.
3. Code validates structure, access, record references, and retry identity; stores accepted changes; and returns a receipt.
4. The application resolves the focus plan against shared records and independently reads current operational state.
5. Corrections update or supersede the relevant records and invalidate stale derived text or plans. Both Perspective and Plan use the revised shared identities and ownership rules.

Narrative interpretations cannot be assumed current merely because a measurement updated. Retain source versions or equivalent dependencies so a correction can mark affected commentary for refresh. An operational source outage does not justify changing a narrative into a claim that there are no tasks or appointments.

## What the prototype proves

The prototype uses fixed, reviewed evidence and hand-authored focus plans. It demonstrates adaptive presentation and a separate operating view; it does not perform automatic focus inference, refresh providers in the background, or write to the vault, Todoist, or Google Calendar.

The operating examples were read directly on September 5: four active tasks labeled Health, and an accepted Gym training event on September 8, 9–10 AM Pacific at Forma Gym. Calendar scope was primary-calendar gym matches from late September 5 through September 19, followed by an individual event read. That is an example set, not an exhaustive health-calendar inventory. The prototype preserves this checkpoint date.
