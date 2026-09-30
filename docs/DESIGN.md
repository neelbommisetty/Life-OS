# Life-OS design system

Life-OS is a personal, candid workspace. This system implements the September 25 `/todo` review with the user-selected ocean-blue identity and locally bundled DM Sans / Manrope fonts.

**Scene:** Neel checks his phone in morning daylight, then works through tasks at a desk. A light, quiet canvas makes short text and task states easy to scan. The color strategy is restrained: neutral surfaces, one application accent, and explicit semantic colors. Dark mode is not implemented.

## Final palette decision

**Ocean blue is the finalized Life-OS palette, confirmed by Neel on September 25, 2026.** It applies to the shared application shell, typography colors, controls, feedback, and all future web slices. `/todo` is the first implementation, not a separate visual identity.

The approved treatment is light: near-white content surfaces, pale cool-blue navigation, pale ocean-blue primary buttons, and darker blue text, icons, focus rings and selected states. Keep the canvas and controls airy. Do not substitute teal/green, saturated electric blue, or dark navy/charcoal primary fills. Preserve the locally bundled DM Sans and Manrope typography.

Primary button fills and readable text deliberately have separate roles. Use `--action-fill`, `--action-hover`, `--action-ink` and `--action-border` for primary controls; use `--accent` and `--accent-soft` for links, focus and selection. Do not use the darker accent token as a large button or panel fill. Semantic danger/warning colors and user-selected record colors retain their own meanings.

Reuse these foundations when another slice is authorized. Changes to this established visual direction should be explicit design decisions, rather than route-specific overrides. The earlier green, slate, plum, clay and graphite options are superseded.

## Sources of truth

| Layer | Source | Responsibility |
| --- | --- | --- |
| Foundations | `apps/web/src/tokens.css` | Primitive palette, semantic roles, type, spacing, radii, motion, elevation and layout tokens |
| Shared styles | `apps/web/src/theme.css` | Base elements, controls, page headings, badges, dialogs, menus, feedback and focus |
| Shared frame | `apps/web/src/Shell.tsx`, `shell.css` | Navigation slots, identity, breadcrumb, mobile focus containment and responsive frame |
| React primitives | `apps/web/src/ui.tsx` | Button, IconButton, Badge, Modal, Menu, MenuItem |
| Calendar slice | `apps/web/src/CalendarApp.tsx`, `EventEditor.tsx`, `calendar.css` | Date picker, calendar grid, agenda, event forms and sync states |
| Task slice | `apps/web/src/todo.css` | Task rows, grouping, board, editor and task-specific states |
| Machine-readable export | `docs/DESIGN.json` | Generated token values and component contracts, never an independent theme |
| Working specimens | `apps/web/design-system.html` | Development-only catalog using the real components; no API or personal records |

Run `bun run --cwd apps/web design:dev` and open [the catalog](http://127.0.0.1:4322/design-system.html). It demonstrates normal, disabled, pending, invalid, focus, menu and dialog states. The [ocean-blue showcase](http://127.0.0.1:4322/palettes.html) combines the shared shell and component examples using the finalized tokens, with synthetic content and no API access. It is intentionally outside product navigation and the production entry point.

Change tokens in CSS, run `bun run --cwd apps/web design:tokens`, and verify with `bun run --cwd apps/web design:check`. Update this guide whenever semantics, component contracts or breakpoint behavior change. `DESIGN.md` at the repository root remains only a pointer.

## Foundations

### Color

All application colors use semantic CSS variables backed by OKLCH primitives. `--canvas` is near-white with a very slight blue tint; `--sidebar` uses a pale cool-blue neutral. Ocean blue (OKLCH hue 245) carries selection, links and focus. Primary controls use a light ocean-blue fill with darker blue text, keeping the interface airy rather than saturated or dark. Text, border, selection, disabled and feedback roles are separate. Do not copy color literals into slice CSS.

| Role | Tokens | Meaning |
| --- | --- | --- |
| Surfaces | `--canvas`, `--sidebar`, `--surface`, `--surface-hover` | Main work, navigation, secondary regions, interactive hover |
| Text | `--ink`, `--muted` | Primary and secondary readable text; secondary does not mean low contrast |
| Boundaries | `--border`, `--control-border` | Quiet separators versus essential form/checkbox boundaries |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` | Links, focus, selection and text on dark semantic fills |
| Primary controls | `--action-fill`, `--action-hover`, `--action-ink`, `--action-border` | Pale ocean-blue controls with independent readable text and hover/border roles |
| Error | `--danger`, `--danger-hover`, `--danger-soft` | Destructive actions, overdue tasks and failures, always paired with words or icons |
| Other states | `--warning`, `--warning-soft`, `--info`, `--info-soft`, `--success`, `--success-soft` | Semantic state, never decorative variation |
| Disabled | `--disabled-ink`, `--disabled-surface` | Explicit disabled styling; native `disabled` prevents interaction |

Priority maps P1 to danger, P2 to warning, P3 to info and P4 to a neutral outline. Show a textual P1/P2/P3 cue alongside color. Project colors remain record data, including existing custom values; they identify a project and do not redefine the theme. Always show the project name with its color.

Normal text targets at least 4.5:1 and essential control indicators at least 3:1. Verify actual rendered foreground/background pairs, including hover and selected backgrounds. Token choice is not an accessibility certification. Avoid opacity on essential text and controls.

### Typography

| Role | Token | Size at default browser settings |
| --- | --- | --- |
| Metadata and hints | `--text-xs` | 12px |
| Controls, navigation and body support | `--text-sm` | 14px |
| Task title and primary body | `--text-base` | 16px |
| Dialog and section emphasis | `--text-lg` | 20px |
| Brand | `--text-xl` | 24px |
| Page heading | `--text-page` | 32px |

Use `--font-body` (DM Sans Variable) for controls and content, `--font-heading` (Manrope Variable) for headings. Fonts are loaded locally. Type sizes use rem so browser preferences scale them. Body leading is 1.5 and heading leading 1.25. Keep prose under 65–75ch. Essential labels never use tiny uppercase lettering. Long task titles wrap; descriptions may truncate only because full content is available in task details.

### Spacing and geometry

`--space-1/2/3/4/5/6/8/10/12/16` correspond to 4/8/12/16/20/24/32/40/48/64px at the default root size. Use 8–12px within a control group, 16–24px between related regions and 32–48px between major sections. Optical one-pixel adjustments are allowed; a new arbitrary value is not a new token.

Corners have four roles: `--radius-sm` 4px, `--radius-control` 8px, `--radius-panel` 12px and `--radius-dialog` 16px. Use `--radius-round` for truly circular marks. Controls have at least a `--control-size` 44px target. A completion circle stays 20px inside its own 44px button, without overlapping neighboring controls.

### Layout

| Width | Behavior |
| --- | --- |
| Above 1100px | 256px navigation, 64px top bar, centered 58rem list width with 48px padding |
| 901–1100px | Same shell, content padding 32px |
| 681–900px | Navigation narrows to 224px |
| 680px and below | 272px drawer capped by viewport, 60px top bar, 24px vertical / 16px horizontal page padding; fields stack and input text is 16px |

Board layouts expand to 88rem and scroll within the board region. The document must not scroll horizontally. Sidebar contents scroll as one region on short screens. No fixed-height content rows. Page headings can wrap their actions on narrow screens.

### Elevation and motion

Resting work is flat. Borders and spacing separate rows; a board uses task surfaces within unboxed grouping columns. Only menus, dialogs and toasts use shadow tokens. Layer order is scrim 29, navigation 30, overlay 60, dialog 61, menu 70, toast 80 and skip link 100.

Control feedback takes 150ms, drawer movement 200ms, using `--ease-out`. Animate color, opacity and transform, never layout dimensions. No decorative page entrances or background blur. `prefers-reduced-motion` disables animation and transitions, including pseudo-elements. Loading remains understandable through status text when motion is off.

## Components and contracts

### Buttons

```tsx
import { Button, IconButton } from "./ui";

<Button onClick={add}>Add task</Button>
<Button variant="secondary" type="button" onClick={cancel}>Cancel</Button>
<Button variant="destructive" onClick={remove}>Delete task</Button>
<Button type="submit" pending={saving}> {saving ? "Saving…" : "Save changes"} </Button>
<IconButton aria-label="Refresh tasks" onClick={refresh}><RefreshCw size={18} /></IconButton>
```

`Button` supports primary, secondary and destructive variants, native button props and `pending`. Pending disables the control and sets `aria-busy`; supply meaningful pending text. It retains native form submit semantics, so set `type="button"` on non-submit actions in forms. IconButton requires `aria-label` and supports the native ref. Decorative icons are not accessible names. Primary, secondary and destructive variants have distinct hover, focus, active and disabled states.

### Fields

Use native labeled inputs/selects/textareas. Shared CSS supplies border, target size, invalid and focus states. Placeholder text provides an example, not a label. Use `aria-describedby` for persistent hints or field errors and `aria-invalid` on an invalid field. Error text must explain a recovery action, not rely only on red. Native browser controls remain the baseline; no additional form library is needed.

Quick capture presents title, description, due date and project. Optional time, duration, priority, labels, recurrence and deadline live in an accessible native disclosure. Duration uses a labeled native number input in whole minutes, with an optional-estimate hint explaining the calendar block and clearing behavior. Existing task details begin expanded; hiding options never clears values. Visible hints explain label formatting and the difference between a planned due date and a final deadline.

### Badges and record rows

```tsx
<Badge tone="accent">focus</Badge>
<Badge tone="info">In progress</Badge>
```

Badges are static metadata. Interactive filters require buttons or links with selected state. Task rows use completion, title, supporting description, metadata and an options menu in that order. List rows use separators; board rows use contained surfaces. Avoid turning every region into a card.

### Dialogs and menus

Use `Modal`, `Menu` and `MenuItem` from `ui.tsx`. These wrap Radix primitives with keyboard interaction, titles, focus containment and Escape dismissal. Dialogs return focus to their trigger; when that trigger is in the closed mobile drawer, they return focus to the navigation toggle. Dialog widths are 28rem or 40rem (`wide`), with 16px viewport gutters and internal scrolling. Menus constrain height to the available viewport. Destructive menu items pair their label with semantic color.

Dialogs suit task detail editing and consequential decisions. Prefer inline disclosure for optional form fields. Never invent a second overlay stack in a slice.

### Shell and navigation

`Shell` accepts `sidebar`, `children`, `title` and `description`. Reuse it for implemented slices only. The shared app navigation links Tasks and Calendar; only implemented slices are shown. Navigation exposes the current page with `aria-current`, and the phone trigger exposes expanded state. Open mobile navigation moves focus inside, contains Tab, closes on Escape or scrim activation, locks document scrolling, and restores focus to its trigger. Hidden navigation and background work are inert when appropriate. A visible in-drawer close action is always available.

### Feedback

Initial loads use skeletons and status text. Keep useful data visible during background refresh. Empty states describe actual emptiness and offer a relevant next action. Persistent failures get an inline alert and recovery action. Successful mutations use a status toast only after the API receipt confirms success. Task priority, state, due status and selection never depend solely on color.

The HTTP API remains the only data path. Preserve version checks, idempotency, duplicate decisions and no automatic write retries. This visual system does not authorize other product slices, deployment or personal-data mutation.

## Extension and verification

Add a token when it expresses a reusable role, not every observed number. Extract a React primitive after repeated uses share semantics. Keep one-off task layouts in `todo.css`; shared behavior belongs in `ui.tsx` or `Shell.tsx`.

For changes, run `bun run typecheck`, `bun run test`, `bun run web:build` and `bun run --cwd apps/web design:check`. Inspect the catalog and disposable `/todo` fixture at phone and desktop sizes. Check keyboard focus, reduced motion, large text, long content, empty/error states, list/board layouts and native form submission. Browser mutation checks must use `bun run --cwd apps/web test:preview`, never personal records. Save artifacts in ignored `.local/`.

The [review report](reviews/todo-design-review.md) records baseline findings, changes and verified limits.

## Calendar slice

`/calendar` follows the same finalized ocean-blue palette and bundled fonts. FullCalendar owns grid geometry and overlap layout; `calendar.css` maps its styles to Life-OS tokens. Provider calendar colors appear as small identification marks and event borders, always alongside calendar names in details/agenda. Event backgrounds and text use shared readable roles. Busy/free, invitations, and cancellations carry textual cues.

The main workspace expands to the available width. On phones the initial view is Day; Week and Month scroll inside the calendar region without widening the document, reveal the selected date, and show a scroll hint. Search and timezone controls use a phone disclosure. Agenda offers a wrapping list alternative. The desktop mini date picker uses compact 30px cells with 2px separation, one Tab stop and arrow-key navigation; phones use a native date field. Main actions retain the shared 44px targets. The drawer focus loop includes calendar checkboxes. Event titles precede time/location metadata and use the shared small-text token; outside-month dates retain readable contrast.

New event forms show title, calendar, all-day and dates first. A native Event options disclosure contains optional scheduling fields and preserves values when collapsed. Existing event forms start expanded. Recurring scope precedes the fields it governs. The action footer stays visible while the editor scrolls, and submission errors receive focus.

Event creation and editing use the shared Modal and native labeled fields. There is no natural-language input. Drag/resize opens the same form before saving. Recurring edits require an explicit scope, deletion requires an in-form confirmation, and errors remain visible with the entered data. The calendar source copy can be stale: sync failures display an explicit warning, never an empty-state claim.

Verify both `/todo` and `/calendar` against the disposable preview. Calendar checks include overlapping events, exclusive all-day ends, named timezones and DST, read-only calendars, recurrence scopes, failed sync, keyboard editing, and phone navigation.
