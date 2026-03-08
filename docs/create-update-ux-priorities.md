# Create / Update UX Priorities

Scope: create and update flows for projects, tasks, notes, and chat threads on latest `develop` (`9df1aeb`).

Allowed status values:
- `not started`
- `inprogress`
- `started`

Status meaning:
- `not started`: untouched
- `inprogress`: actively being worked
- `started`: fixed and committed

## P0

### 1. Project create can leave users in an indeterminate post-submit state
- Status: `started`
- Surface: Projects
- Priority: P0
- Issue: After submit, the UI can stay on `/projects` with no dependable redirect confirmation or visible new project.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 2. Project list state goes stale immediately after create
- Status: `started`
- Surface: Projects
- Priority: P0
- Issue: The page snapshots `initialProjects` once and never reconciles local list state after creation, so the grid can drift from reality.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 3. Project detail stays visually stale after update
- Status: `started`
- Surface: Projects
- Priority: P0
- Issue: The detail page snapshots `initialProject` into state once, then relies on `router.refresh()`, so saved edits can fail to appear until a full reload.
- References: `apps/web/src/app/projects/[id]/project-detail-client.tsx`

### 4. Task create and update can save but still render stale board data
- Status: `started`
- Surface: Tasks
- Priority: P0
- Issue: `selectDisplayedTasks()` prefers `initialTasks` whenever present, so `loadTasks()` can fetch fresh data that the board never renders.
- References: `apps/web/src/app/tasks/tasks-utils.ts`, `apps/web/src/app/tasks/tasks-client.tsx`

### 5. Existing end-to-end coverage depends on reloads to verify create and update success
- Status: `started`
- Surface: Projects, Tasks
- Priority: P0
- Issue: Project create, project update, task create, and task update tests all reload the page before asserting success, which signals real UX fragility in the immediate post-save state.
- References: `apps/web/tests/e2e/projects-flows.e2e.ts`, `apps/web/tests/e2e/project-detail.e2e.ts`, `apps/web/tests/e2e/tasks-kanban.e2e.ts`

### 6. Note creation persists a blank note on the first click
- Status: `started`
- Surface: Notes
- Priority: P0
- Issue: `Capture note` immediately creates a persisted `Untitled note` instead of opening a draft-first flow, so accidental taps create clutter.
- References: `apps/web/src/app/notes/notes-client.tsx`

## P1

### 7. Project create has weak inline success feedback
- Status: `not started`
- Surface: Projects
- Priority: P1
- Issue: The only visible feedback is the button label changing to `Creating...`, which is too weak when navigation is delayed or fails.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 8. Project create uses a cramped modal pattern for a primary workflow
- Status: `not started`
- Surface: Projects
- Priority: P1
- Issue: An `AlertDialog` is doing the work of a multi-field form flow, which feels cramped on desktop and awkward on mobile.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 9. Project terminology is inconsistent with the rest of the product
- Status: `not started`
- Surface: Projects
- Priority: P1
- Issue: The page says `Group threads, tasks, and notes.` while the product elsewhere uses assistant and chat language.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 10. Project detail leads with a sparse overview instead of likely next actions
- Status: `not started`
- Surface: Projects
- Priority: P1
- Issue: After create or update, the page prioritizes passive overview content instead of the likely next actions: assistant work, task capture, or note capture.
- References: `apps/web/src/app/projects/[id]/project-detail-client.tsx`

### 11. Project detail tabs are cramped on mobile
- Status: `not started`
- Surface: Projects
- Priority: P1
- Issue: Each tab combines icon and label in a constrained row, which makes the tab strip tight on small screens.
- References: `apps/web/src/app/projects/[id]/project-detail-client.tsx`

### 12. Task create and edit have weak post-save confirmation
- Status: `not started`
- Surface: Tasks
- Priority: P1
- Issue: The sheet closes after save, but there is no explicit success confirmation, and stale renders make the result hard to trust.
- References: `apps/web/src/app/tasks/tasks-client.tsx`

### 13. Task editing is implicit while deletion is explicit
- Status: `not started`
- Surface: Tasks
- Priority: P1
- Issue: The whole card opens edit on click, but the only always-visible action button is delete, which overweights the destructive action.
- References: `apps/web/src/app/tasks/task-card.tsx`

### 14. Task drag and drop is mouse-first and weak on touch
- Status: `not started`
- Surface: Tasks
- Priority: P1
- Issue: Cards use `touch-none` and `HTML5Backend`, so the core kanban interaction is a poor fit for mobile and tablet.
- References: `apps/web/src/app/tasks/task-card.tsx`, `apps/web/src/app/tasks/tasks-client.tsx`

### 15. Empty task columns suggest a drag affordance that is weak on touch devices
- Status: `not started`
- Surface: Tasks
- Priority: P1
- Issue: Empty states say `Drop to move.` even where dragging is not a reliable interaction.
- References: `apps/web/src/app/tasks/kanban-column.tsx`

### 16. Notes open in preview mode by default
- Status: `not started`
- Surface: Notes
- Priority: P1
- Issue: The editor initially feels view-only instead of editable, which adds friction to updates.
- References: `apps/web/src/components/notes/note-editor.tsx`

### 17. Note title editing is hidden on touch-first devices
- Status: `not started`
- Surface: Notes
- Priority: P1
- Issue: The pencil affordance is hover-revealed and the title itself has weak edit discoverability.
- References: `apps/web/src/components/notes/note-editor.tsx`

### 18. The immediate `Untitled note` default adds scanning noise
- Status: `not started`
- Surface: Notes
- Priority: P1
- Issue: Saving notes under the default title makes the notes list harder to scan after accidental or rapid creation.
- References: `apps/web/src/app/notes/notes-client.tsx`, `apps/web/src/components/notes/note-selector.tsx`

### 19. Chat composer helper text is inaccurate
- Status: `not started`
- Surface: Chat
- Priority: P1
- Issue: The UI says `Ctrl/Cmd + Enter to send`, but plain `Enter` also sends, which breaks trust in the input behavior.
- References: `apps/web/src/components/chat/chat-input.tsx`, `apps/web/src/app/chat/chat-client.tsx`

## P2

### 20. The global mobile shell makes all create and update surfaces narrower than necessary
- Status: `not started`
- Surface: Projects, Tasks, Notes, Chat
- Priority: P2
- Issue: The fixed side rail and left padding reduce usable width on phones across all audited surfaces.
- References: `apps/web/src/app/layout.tsx`, `apps/web/src/components/navigation/side-nav.tsx`

### 21. Project list header does not stack gracefully on small screens
- Status: `not started`
- Surface: Projects
- Priority: P2
- Issue: The page title, helper copy, and create CTA compete for space on mobile widths.
- References: `apps/web/src/app/projects/projects-client.tsx`

### 22. Project detail exposes only `Edit` as a page-level action
- Status: `not started`
- Surface: Projects
- Priority: P2
- Issue: The page-level action set does not foreground likely next steps such as starting assistant work, adding a task, or capturing a note.
- References: `apps/web/src/app/projects/[id]/project-detail-client.tsx`

### 23. Task header controls crowd on smaller widths
- Status: `not started`
- Surface: Tasks
- Priority: P2
- Issue: Search, archive, and create all sit in one action row, which compresses quickly.
- References: `apps/web/src/app/tasks/tasks-client.tsx`

### 24. Task search uses a fixed width that limits layout flexibility
- Status: `not started`
- Surface: Tasks
- Priority: P2
- Issue: The search field uses `w-[200px]`, which reduces responsiveness in tighter layouts.
- References: `apps/web/src/app/tasks/tasks-client.tsx`

### 25. Task editor save-readiness guidance disappears on mobile
- Status: `not started`
- Surface: Tasks
- Priority: P2
- Issue: The `Ready to save.` helper is hidden behind `sm:block`, so a useful confidence cue disappears on small screens.
- References: `apps/web/src/app/tasks/tasks-client.tsx`

### 26. Notes have no selector-level delete flow
- Status: `not started`
- Surface: Notes
- Priority: P2
- Issue: The selector API suggests note deletion support, but deletion is only available inside the editor.
- References: `apps/web/src/app/notes/notes-client.tsx`

### 27. Notes save UX is noisy because multiple save paths emit the same toast
- Status: `not started`
- Surface: Notes
- Priority: P2
- Issue: Manual save, autosave, and save-on-switch can all emit `Saved.`, which can feel repetitive instead of reassuring.
- References: `apps/web/src/components/notes/note-editor.tsx`

### 28. The notes create flow contradicts its own stated state model
- Status: `not started`
- Surface: Notes
- Priority: P2
- Issue: The component comments describe a draft-like `creating new` state, but the actual flow immediately persists a real note.
- References: `apps/web/src/app/notes/notes-client.tsx`

## P3

### 29. Project cards provide limited visual confirmation after create
- Status: `not started`
- Surface: Projects
- Priority: P3
- Issue: Cards show little beyond title, truncated description, and updated date, so the post-create state is not very informative.
- References: `apps/web/src/components/projects/project-card.tsx`

### 30. Task card styling does not clearly advertise edit as the primary action
- Status: `not started`
- Surface: Tasks
- Priority: P3
- Issue: Strong drag and status styling are visible, but the edit affordance remains mostly implicit.
- References: `apps/web/src/app/tasks/task-card.tsx`

### 31. Task board columns create horizontal-scroll pressure
- Status: `not started`
- Surface: Tasks
- Priority: P3
- Issue: `min-w-[300px]` columns add layout pressure on smaller laptops and tablets.
- References: `apps/web/src/app/tasks/kanban-column.tsx`

### 32. Short notes leave an oversized editor canvas
- Status: `not started`
- Surface: Notes
- Priority: P3
- Issue: For quick edits, the note workspace can feel visually sparse and oversized.
- References: `apps/web/src/components/notes/note-editor.tsx`
