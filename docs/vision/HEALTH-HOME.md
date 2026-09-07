# Health home — first design sketch

Drafted September 5, 2026; revised after a direct read of Health Weekly Tracker later in the same session. Content and layout exploration based on selected current vault notes, a dated Gather checkpoint, and the spreadsheet's available history. This is a reviewable planning artifact, not an implemented page or a clinical assessment. The overall direction is in [Current Vision](VISION.md).

## Purpose

Help Neel recognize where he was, where he is, and where he wants to be. The primary outcome is understanding his trajectory, including the cases where activity and subjective wellbeing move differently. A small overall-home summary leads into this deeper Health experience using the same records.

## Adaptive-focus prototype

Following this first sketch, Neel clarified that the experience should dynamically reflect what he cares about at a particular time, rather than becoming a permanent dashboard of the currently available metrics. He authorized a small interactive demonstration. This refines the layout below: its content is one possible selection, not a fixed inventory every Health home must display.

The demonstration offers two editorial interpretations of the same reviewed history: sustainable rhythm and body changes. Changing the preview emphasis updates the desired direction, headline, featured evidence, and reflection. Both use the same source dates, and both preserve the other context. The selector is a local demonstration control, not an assertion that Neel changed his actual priority or a mechanism that saves a new goal.

The current-focus inference itself is not automated in this prototype. In the proposed MVP, Codex publishes a considered focus through the same replaceable workflow interface. Code renders supported blocks, checks validity and freshness, and provides a correction path. The prototype demonstrates the resulting experience without claiming to have built that integration.

The next revision adds the general operating requirement: Perspective and Plan views, plus an upcoming-commitment summary that remains visible regardless of reflective focus. Plan uses four directly checked Health-labeled tasks and a separately read gym-calendar event as examples. Their source status is preserved, task completion is not simulated, and coverage limitations are visible. This requirement applies to all homepages, not just the sample Health records. Neel confirmed these two complementary views as the scope for now. See [Data and adaptive views](DATA-AND-VIEWS.md) for the proposed model.

The interactive conversation preview was verified in a browser: focus changes update the Health page and overall-home entry; both navigation paths work; source explanations and measurement tables expand; sleep has eleven recorded values and weight has three measured points. The layout was checked at 320, 360, and 736 pixels in light and dark appearances with no horizontal overflow or page errors. Phone screenshots were visually inspected. No live provider or publication integration is present.

## First phone screen

A vertically scrolling page with a compact back link to Home, the title Health, and a source-date line. Start with the desired direction and a short current account. Follow with change over time, measurements, and relevant context. Use one reading column rather than three narrow columns or an equal-sized grid of cards.

The wording below is proposed interface copy, grounded in the cited notes. It summarizes dated reports rather than claiming new observations.

```text
‹ Home                                      Health
Based on updates through Sep 4

WHERE YOU WANT TO BE
Regular movement. More restorative rest.
A routine that feels sustainable.

WHERE YOU ARE
You're showing up for movement.
Feeling rested is still part of the work.

You reported gym visits 3–5 days a week on
Sep 4. In your Aug 30 reflection, skincare
and supplements were becoming consistent,
but life still felt chaotic and unrestful.

WHAT HAS CHANGED                         Explore →
Aug 4      Back pain put health first.
Aug 16     Back pain mostly resolved while
           strength work continued;
           sleep felt slightly better.
Aug 30     Three strength sessions and a walk.
           Progress, but not the calm you wanted.
Sep 4      Gym visits reported 3–5 days/week;
           appetite and energy were hard to manage.

Your notes show movement you can recognize,
alongside a need for rest that still matters.

MEASUREMENTS                            Details →
Sep 4 recorded sleep                  5 h 54 min
Sep 4 steps                               2,340
Latest recorded weight                  185.3 lb
Latest body-fat estimate                  22.6%
Both measured Sep 3; no new reading Sep 4.

Recorded history: Aug 25 – Sep 4
Sleep and movement                      Charts →
Body measurements                 3 dated readings →

KEEPING YOUR DIRECTION IN VIEW
Choose movement that fits the day.
Stabilize small anchors without perfect timing.
Make space for a calmer nighttime transition.

Relevant context
Small-portion food ideas                       →
Your health notes                             →
```

The direction statements summarize Neel's existing intentions; they are not newly assigned goals or a new task list. The selected examples do not establish a current numeric weight or body-fat target. The old HbA1c goal had a past deadline and is not presented as a current target.

## How the three-part theme works

- **Where I want to be:** visible first, so measurements and updates have context. A qualitative direction is valid. A numeric target appears only when Neel has stated one and its currency is established.
- **Where I am:** a short dated account combining the most relevant reported experience and available measurements. Each assertion retains its own date; a recently updated page does not make every statement recent.
- **Where I was:** an expandable sequence of meaningful checkpoints. The initial available evidence supports a several-week account, not an invented seven-day before-and-after story.
- **Encouragement:** a considered sentence connected to those checkpoints. Improvements in consistency do not imply better emotional wellbeing, clinical recovery, or a continuous streak.

## Measurement treatment

The first version of this sketch relied on September 4's blank weight and body-fat fields. Direct spreadsheet inspection established that these are day-specific gaps: three earlier measurements are available. The home should retain the latest actual measurement and its measurement date, separately from whether the newest daily row has a reading.

| Measurement date | Weight | Body-fat estimate |
|---|---|---|
| August 26 | 187.7 lb | 23.1% |
| August 27 | 186.7 lb | 22.9% |
| September 3 | 185.3 lb | 22.6% |

These support a sparse plot of three measured points with truthful date spacing. The first-to-last recorded difference is -2.4 lb and -0.5 percentage points, respectively. These are observations across the sampled dates, not a smooth trajectory, a forecast, or proof of a clinical outcome. Do not draw a daily curve, infer a target, or describe this as progress toward a numeric goal that Neel has not set.

Eleven daily records cover August 25 through September 4. Sleep, steps, active energy, exercise minutes, walk/run distance, resting heart rate, and HRV have values across that inspected period. Sleep and movement can now have populated daily charts. Keep resting heart rate and HRV in optional detail rather than making the homepage a grid of every available metric.

The latest daily record contains 5.9 recorded sleep hours, converted for display to 5 h 54 min, and 2,340 steps. September 1 and September 2 contain unusually short recorded sleep values of 0.9 and 1.4 hours. Preserve them as recorded values; the source does not establish whether they represent complete sleep capture. Do not silently exclude them, diagnose from them, or claim sleep improved based on selected days.

The recent daily records use 10 PM-to-10 PM windows. August 25–31 rows were backfilled together; identical historical window semantics were not established in this read. The August 24–30 weekly row has six retained daily dates, and the August 31–September 6 row has five dates so far. A 30-day baseline is unavailable. Daily history is usable, but a complete-week comparison is not yet supported.

Self-reported gym frequency and wearable exercise minutes remain distinct evidence. Wearable data does not establish gym attendance or workout completion. Recorded sleep duration does not establish how rested Neel felt. Consumer-scale body fat, when available, is an estimate.

Graphs should offer a date range, visible missing dates, units, source, and a stated target if one exists. The direct read now supplies a short dated series for a populated draft; implementation still needs its publication contract and freshness handling.

## Interaction model

- **Explore changes:** expand the timeline and choose a checkpoint to see the relevant source passage and date.
- **Measurement details:** reveal the reporting window, available coverage, units, and source; do not hide qualifications behind an unexplained score.
- **Relevant context:** open the linked food reference or Health note. The first sketch does not prescribe medication or turn symptom reports into recommendations.
- **Return Home:** show a compact Health summary derived from the same records.
- **Corrections:** Codex remains the conversational correction path for this first slice. A later direct edit affordance must route to the defined authority rather than edit a detached display copy.

There is no new task or calendar action in this sketch. Existing live tasks and appointments can be added after their current state is read from Todoist and Google Calendar. Dated notes or reports alone cannot establish that state.

## Overall-home companion

The Health entry on the overall homepage should carry the same meaning in less space:

> **Health**
>
> **Toward:** regular movement and more restorative rest.
>
> **Latest account:** gym visits reported 3–5 days a week on September 4; calm and rest remained unresolved in the August 30 reflection.
>
> **Worth noticing:** your August notes describe improving back pain and more consistent self-care, alongside continued overwhelm.
>
> Explore Health →

This summary is a draft of a Health entry, not a full overall-home design or a claim that other life areas were reviewed. Both views must use the same publication records and correction behavior.

## States to support

| State | What the experience does |
|---|---|
| Evidence available | Show a dated account with direct access to its sources. |
| Qualitative evidence only | Present direction and reflections without demanding scores or measurements. |
| No current target | Retain stated general direction; show no invented target or progress percentage. |
| No measurement | Say no reading is available for that observation period; do not show zero. |
| Incomplete comparison | Show the available dates; avoid improvement arrows or a week-over-week claim. |
| Older reflection | Keep its date visible and distinguish it from newer measurements. |
| Conflicting or mixed evidence | Let both statements remain visible with their dates and sources. |
| Initial loading | Reserve the reading structure without invented numbers or motivational copy. |
| Refresh or publication failed | Retain the last known account with its date and a clear update status; do not claim it is current. |
| Correction received | Refresh the Health page and overall-home entry from the same corrected records. |

## Visual scope and open choices

This pass establishes content priority and a phone layout only. Color, typography, light/dark theme, and polished visual references remain open. The physical usage context supplied so far is Neel opening his phone in the morning; ambient lighting has not been specified. No visual theme is assumed from the health category.

No image probes or production components were generated because this is a sketch-level planning pass. A later visual brief can establish those choices and use visual probes before implementation. Readable text, visible dates, and information not conveyed by color alone are proposed baseline design practices.

## Evidence and verification

- [Health Area](</Users/neel/Library/Mobile Documents/iCloud~md~obsidian/Documents/Life/Areas/Health.md>): read September 5; latest file update September 5. Current focus, standards, and dated August 4, August 16, August 30, and September 4 material support the selected copy. These are Neel's reports, not independently verified clinical findings.
- [September 5 Gather checkpoint](</Users/neel/Library/Mobile Documents/iCloud~md~obsidian/Documents/Life/Resources/Vault System/Gather/Daily/2026-09-05 Life Gather.md>): Health observations describe the September 4 snapshot, checked overnight September 5. This supplied the initial sketch; the subsequent live spreadsheet read below adds history absent from that single-day summary.
- [Health Weekly Tracker](https://docs.google.com/spreadsheets/d/1MnKrGl34N1_FLCxVNgVYj9rBt0WcDqe0vAe9FGQollk/edit): directly inspected September 5 after the initial sketch. Metadata confirmed the Daily Log, Weekly Review, and Guide tabs in Pacific time. Bounded reads: `Guide!A3:D14`, `'Daily Log'!A4:O20`, and `'Weekly Review'!A4:V8`. Returned eleven daily records through September 4, three body-measurement dates, and two weekly rows with partial coverage. This follow-up supersedes the initial single-day-only basis for the measurement design; no source cells were changed.
- [Gather Source State](</Users/neel/Library/Mobile Documents/iCloud~md~obsidian/Documents/Life/Resources/Vault System/Gather/Gather Source State.md>): confirms partial-week coverage, missing workout details, and insufficient 30-day history at that checkpoint.
- [Small-portion food reference](</Users/neel/Library/Mobile Documents/iCloud~md~obsidian/Documents/Life/Resources/Small-Portion Breakfasts, Snacks and Drinks.md>): linked by the Health Area; proposed navigation destination only, not reread or clinically assessed in this pass.

The vault was read-only. Archive links were not followed. No live task or calendar state was asserted, no spreadsheet data was changed, and no data was published or deployed. No new medical advice is part of this design.
