# Calendar: Impeccable review and refinements

Reviewed September 25, 2026 against `/calendar` in the disposable web preview. Two independent assessments covered visual UX and deterministic detection without sharing findings. Desktop: 1440×1000. Phone: 390×844. The implementation stays within the existing calendar API, explicit event forms, and finalized ocean-blue Life-OS design.

## Verdict

The page is a recognizable, calm calendar. Its original problems were information priority and interaction details: a short appointment could lose its entire title, optional form fields hid the completion action, and phone controls consumed too much of the screen. These were repaired without changing the visual identity or introducing natural-language entry.

The independent visual score improved from **28/40 to 32/40**. The score is a bounded design judgment, not an accessibility certification. Automated checks additionally found low-contrast outside-month dates and invalid ARIA on the “more events” control; both were repaired.

## Design health

Scores use 0–4, with 4 strongest.

| Nielsen heuristic | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Visibility of system status | 3 | 3 | Date/view selection, item counts, pending states and receipt feedback |
| Match with the real world | 3 | 3 | Familiar calendar views and explicit date/time fields; timezone IDs remain technical |
| User control and freedom | 3 | 3 | Cancel/Escape, reversible filters, deletion confirmation; no draft recovery or immediate undo |
| Consistency and standards | 3 | 4 | Shared shell and controls; usable phone date selection and view positioning |
| Error prevention | 3 | 3 | Required fields, end-time validation, recurring scope and review before drag-save |
| Recognition over recall | 3 | 3 | Titles precede metadata; dense Week events can still require their tooltip/details |
| Flexibility and efficiency | 3 | 4 | Shortcuts, four views, roving date focus, compact creation form |
| Aesthetic and minimalist design | 2 | 3 | Optional fields disclosed; phone tools collapsed; generic eyebrow removed |
| Error recognition and recovery | 3 | 3 | Submission error receives focus; invalid timezone message names the correction |
| Help and documentation | 2 | 3 | Scroll cue, date-picker keyboard instructions, scope explanation and timezone example |
| **Total** | **28/40** | **32/40** | **Good; remaining opportunities below** |

The visual review originally found three cognitive-load checklist failures: chunking, choice volume and progressive disclosure. After repair, only choice volume remains: optional timezone/repeat controls have more than four choices, which is appropriate for their job. Single focus, grouping, hierarchy, one action at a time and working-memory support passed both reviews. **Final cognitive load: low, 1/8 checklist failures.**

## What works

- The shared pale-blue controls, local fonts, restrained surfaces and familiar calendar geometry make a complex utility feel cohesive with Tasks.
- Day, Week, Month and Agenda offer useful alternatives. Agenda wraps titles; selected dates and calendar names provide context beyond color.
- Recurrence scope, read-only calendars, explicit deletion confirmation and stale-source warnings communicate consequential behavior.

## Priority findings and implemented responses

### P1 — Preserve the identity of dense appointments

The 09:45–10:15 overlap fixture showed only wrapped time on desktop. Titles now come before time/location, use the shared 14px token, and have a full title/time tooltip. Short blocks use ellipsis. Concurrent events sit side by side so one cannot cover another's text. Full details and Agenda remain available for long titles.

Refinement: **adapt**, followed by **polish**.

### P1 — Repair calendar contrast and semantics

Outside-month dates measured **1.73:1** because FullCalendar reduced their opacity. They now use full-opacity muted text. The “+N more” control now has button semantics; an empty `aria-controls` is removed. The view selector is a named group, and weekday labels belong to their column headers. Automated rechecks found no confirmed violations in the inspected month and editor states.

Refinement: **harden**, followed by **polish**.

### P2 — Make simple event creation short and completion visible

The original form exposed eleven controls and hid Add event below the fold even on desktop. New events now begin with title, calendar, all-day and start/end fields. A native Event options disclosure contains the remaining fields and preserves their values. Existing-event forms start expanded. Save/Cancel stay visible in a sticky footer; recurrence scope precedes the fields it controls. Submission failures receive focus, including when the form is scrolled, and invalid timezone text gives a valid example.

Refinement: **distill** and **harden**.

### P2 — Give phone space back to the schedule

The Day grid now starts at **y=324 instead of y=459**, recovering 135px. Search and timezone settings expand on demand; their search shortcut opens the disclosure before focusing the field. The named New event control uses a compact plus on phones. Week/Month reveal the selected date when switching and explain horizontal scrolling. The calendar remains internally scrollable, without widening the document. Toolbar groups wrap at 200% text size.

Refinement: **adapt**.

### P2 — Remove keyboard traversal and focus traps

The desktop mini picker originally exposed 42 sequential Tab stops. It now has one date stop with day/week arrow navigation and Home/End. Phones use a full-width native date input. Closing an event opened from the mobile drawer previously left focus on the document body; the shared dialog now returns focus to the navigation toggle when its original trigger is inert.

Refinement: **harden**.

## Detector interpretation

The Impeccable 4.1 TSX scan returned no findings; this did not imply a clean rendered page. Its initial rendered scan found gray-on-color, flush calendar boundaries and repeated spacing. The first is a stylistic observation with no demonstrated contrast failure; the latter two are appropriate grid geometry. A later scan caught genuine text occlusion, prompting the side-by-side event layout.

The skill's legacy overlay instructions did not match Impeccable 4.1's variant-server interface. The reviewer used the supported modern scan plus the existing packaged 2.0 browser overlay in a separate **[Human] Calendar · Life OS** tab. The overlay server was stopped after injection. Version counts are not interchangeable. The overlay's gradient-text flag was a verified false positive; source and computed styles contain no gradient text. Its tiny-title findings disappeared after the typography repair.

The visual reviewer also flagged calendar identity stripes under Impeccable's generic ban. They remain because the repository's explicit design contract calls for provider-color identification marks and event borders, with readable shared fills and textual identity. This is an intentional product convention, not an invitation to add decorative stripes elsewhere.

## Persona outcomes

- **Alex, power user:** date navigation no longer requires crossing 42 controls, simple capture avoids advanced configuration, and overlapping commitments are identifiable. Dense Week titles still depend on tooltip/details for their full wording.
- **Sam, keyboard user:** native labels, visible focus and dialog dismissal remain; date navigation and drawer-to-dialog return focus are now explicit. An actual screen-reader session was not performed.
- **Casey, distracted phone user:** more of the schedule appears immediately, the selected date stays visible in Month, and the form has a reachable completion action. Actual device keyboards were not tested.

The emotional journey remains quiet and predictable. The changes remove the most obvious friction between spotting an appointment and adding a simple one. Deletion confirmation and recurrence scope preserve reassurance around consequential edits.

## Verification

- `bun run typecheck`, production web build, generated design documentation check and `git diff --check`: passed.
- The final full `bun run test` run passed **651 tests: 636 tools and 15 web, with zero failures or skips**. Coverage includes HTTP bridge event lifecycle, recurrence/version handling, invitations, failed refresh, timezone/DST, CLI transport and task regressions.
- Browser creation on disposable data: options entered, disclosure collapsed, save completed, event reopened, notes/location preserved, then test event deleted.
- Phone drawer → New event → Escape: focus returns to Open navigation. Invalid timezone: error receives focus and is visible, with corrected guidance.
- Desktop and phone form actions remain visible with options collapsed or expanded. Mobile month automatically reveals selected Friday. Desktop picker has one Tab stop and verified arrow-key movement.
- 390px viewport at 200% root text size: document width 375px, no horizontal document overflow. Internally scrolling calendar views remain intentional.
- Axe rechecks: zero confirmed violations in inspected week, month, new-event editor and mobile states. Some overlap/offscreen contrast checks required manual interpretation; this is not a claim of complete WCAG conformance.
- Screenshots, scan JSON and browser evidence stay ignored under `.local/calendar-design-review/`. No personal calendar records were changed.

## Remaining opportunities

Invitation responses still sit below event fields in the expanded details form. Unsaved-draft recovery, immediate undo and a stronger distinction between untimed tasks and all-day events could improve interruption-heavy use. These are product follow-ups, not blockers introduced by the review. No theme redesign or new API feature is needed for the completed fixes.


## Goal completion audit

The preceding review turn made concrete progress: it changed the implementation and produced independent browser evidence. This completion audit inspected the current worktree, the calendar implementation brief, API contract, test definitions/results and saved rendered-state checks; it did not treat the previous final response as proof.

| Requirement | Authoritative evidence | Result |
| --- | --- | --- |
| Calendar page alongside Tasks | `main.tsx`, `Shell.tsx`, server route; current local `/calendar` returns HTTP 200 | Complete |
| Fantastical-inspired calendar/agenda workflow | `CalendarApp.tsx` four views, mini picker, selected-day agenda, calendar filters, search and Today navigation; desktop/phone visual checks | Complete |
| Use existing calendar API; no natural-language entry | Bridge allowlist and browser HTTP client; `EventEditor.tsx` explicit fields; calendar dependency/source inspection | Complete |
| Create, open, update and delete events | Real HTTP lifecycle tests and disposable browser save/reopen/edit/delete checks | Complete |
| Timed/all-day events, recurrence and timezones | Model tests for inclusive/exclusive dates, floating time, named zones and DST; API scope tests and browser one-occurrence edit | Complete |
| Drag and resize through explicit Save | Final disposable browser checks: one-hour drag opens correct draft with zero writes before Save; Save emits one update; resize cancellation preserves provider readback | Complete |
| Existing calendars, tasks and invitations | Metadata/schedule API integration, readonly permissions, task editor links, organizer/guest details, invitation acceptance/readback and conference-link rendering | Complete |
| Reliable refresh and mutation behavior | Full suite covers failed-provider last-copy evidence, stable retry keys and version rejection; browser outage/reload and explicit receipt handling | Complete |
| Shared design and phone/keyboard usability | Ocean-blue tokens and component reuse; 200% text, focus return, date-picker keys and mobile selected-date checks; synchronized design export | Complete |
| Impeccable review at the end | Independent baseline and recheck, scoring, detector overlays, implemented repairs and this report | Complete |
| Build, tests and local-only development | Typecheck/build/design checks passed; final 651-test run passed; disposable schemas/fake providers used for mutations, then cleaned up | Complete |

The reference is a familiar calendar experience within the existing API, as the user clarified. This completion does not claim full commercial Fantastical feature parity. Deferred provider capabilities and optional future product improvements are not silently implemented. No deployment, push, personal event mutation, vault change or account-connection flow was performed.
