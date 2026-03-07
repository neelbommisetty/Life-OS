# Life-OS Brand Design Guidelines (Visual + Interaction)

Last updated: 2026-03-07

This document defines how Life-OS should *look* and *move* across product surfaces:
- Web (`apps/web`, Tailwind + shadcn/ui)

It complements (and does not replace) `docs/brand-guidelines.md`, which defines product positioning plus all verbal guidance: brand persona and app text language. This file stays visual and interaction-focused.

---

## 1) Visual Thesis

### North star
**Calm control. Quiet competence. Outcome-first.**

### Signature
Life-OS is “paper + ink” minimalism: readable, high-contrast, neutral-first, with a single clear action color.

### What it should feel like
- Fast to scan; hierarchy is obvious on first glance.
- Confident but never showy; warmth comes from clarity, not decoration.
- Consistent under stress (dense enough to be powerful, spaced enough to breathe).

### What it should avoid
- Productivity theater (neon, gamification visuals, excessive charts-as-decoration).
- Over-styled AI aesthetics (glows, glass-heavy surfaces, over-animated layouts).
- Novelty patterns that slow reading and decision-making.

---

## 2) Brand Mark + Naming

- Product name: **Life-OS** (hyphenated, capitalized as shown).
- Do not stylize the name inside UI as “Life OS”, “LifeOS”, or “LIFE-OS”.
- Brand emphasis is subtle: rely on layout, type hierarchy, and one accent color.

---

## 3) Color System

### Roles
Use role-based colors, not “random palette picks”:
- `Background` / `Surface` / `Elevated`
- `TextPrimary` / `TextSecondary` / `TextTertiary`
- `Border` / `Divider` / `FocusRing`
- `Primary` / `PrimaryForeground`
- `Muted` / `MutedForeground`
- `Success` / `Warning` / `Destructive` / `Info`

### Brand primary (action)
- Primary blue: `#2563EB`
- Use it for: primary buttons, links, focus rings, selected states, and key emphasis.
- Do not use it for: large backgrounds, decorative gradients, or charts-as-style.

### Recommended core palette (web reference)
These values are the target “paper + ink” baseline for the product.

| Role | Light | Dark | Notes |
| --- | --- | --- | --- |
| Background | `#FFFFFF` | `#09090B` | App canvas |
| Surface | `#FFFFFF` | `#09090B` | Cards / panels (border-first) |
| Muted | `#F4F4F5` | `#27272A` | Quiet fills; input backgrounds |
| Border | `#E4E4E7` | `#27272A` | Dividers, card borders |
| TextPrimary | `#09090B` | `#FAFAFA` | Default text |
| TextSecondary | `#71717A` | `#A1A1AA` | Metadata, timestamps |
| Primary | `#2563EB` | `#3B82F6` | Action + focus |
| Destructive | `#EF4444` | `#F87171` | Irreversible actions |
| Success | `#22C55E` | `#4ADE80` | Confirmation states |
| Warning | `#F59E0B` | `#FBBF24` | Needs attention |

### Status colors
- Success: green (confirmation, “done”, healthy states)
- Warning: amber (caution, “needs review”, time-sensitive)
- Destructive: red (delete, irreversible actions)
- Info: use primary blue (informational or neutral callouts)

### Light/dark guidance
- Light mode: favor white/near-white surfaces with soft borders.
- Dark mode: favor near-black surfaces with low-contrast borders; keep text crisp.
- Never encode meaning with color alone; pair with label/icon.

---

## 4) Typography

### Principles
- One type system; hierarchy comes from size/weight/spacing, not many fonts.
- Prefer sentence case in UI. Use uppercase sparingly (small labels only).
- Keep line length short on dense content; optimize for scanning.

### Web
- Sans: use the app’s `font-sans` token (UI + body).
- Mono: reserved for code, IDs, timestamps, and technical content.
- Headings: use weight and tracking to create hierarchy; avoid large display type.

### Recommended type scale (web reference)
- `xs`: 12
- `sm`: 14
- `base`: 16
- `lg`: 18
- `xl`: 20
- `2xl`: 24
- `3xl`: 30
- `4xl`: 36

## 5) Layout, Spacing, and Density

### Spacing
- Base grid: 4px increments.
- Prefer consistent rhythm over “perfect spacing” per component.
- Group by intent: title + metadata + actions should form a single visual block.

### Density
- Default density is compact-professional.
- Use generous spacing only for:
  - empty states
  - onboarding
  - high-stakes confirmations

---

## 6) Shape, Borders, and Elevation

### Corners
- Prefer continuous corners and consistent radii within a surface.
- Use larger radii for inputs and pills; smaller for menus and tags.

### Borders > shadows
- Default elevation is achieved with subtle borders and muted surface changes.
- Use shadows only for overlays (menus, dialogs), and keep them soft and minimal.

---

## 7) Components (Interaction Rules)

### Buttons
- Primary: “commit” actions (Create, Schedule, Send, Confirm).
- Secondary/ghost: navigation and low-risk actions.
- Destructive: irreversible or harmful actions; require confirmation where appropriate.

### Inputs
- Clear focus state (visible focus ring).
- Placeholder text is hint-only; labels carry meaning.

### Lists and rows
- Optimize for scanning: title first, metadata second, action affordance last.
- Use subtle separators; avoid heavy card walls in dense lists.

### Toasts and alerts
- Outcome first (“Scheduled 2 focus blocks.”), then optional detail.
- Don’t stack multiple competing toasts; consolidate when possible.

---

## 8) Iconography

### Web
- Use `lucide-react` icons.
- Prefer outline icons; avoid mixing filled and outline styles in the same view.
- Keep icon semantics literal (calendar, inbox, document) rather than abstract.

## 9) Motion

### Principles
- Motion should clarify state changes, not decorate.
- Use a small set of durations (fast/normal/slow) and consistent easing.
- Respect reduced motion settings; never require animation to understand outcomes.

### Where motion is allowed
- Hover/focus transitions (web).
- Expanding/collapsing details.
- Progress indicators (subtle, non-blocking).

---

## 10) Autonomy Ladder Visual Language

Life-OS uses three explicit assistant modes (see `docs/brand-guidelines.md`):
- **Suggest**: quiet emphasis (outline, subtle badge, no “success” styling).
- **Draft**: primary emphasis (reviewable artifact; feels “ready to review”).
- **Do**: confirmation-gated; visually includes the “three lines” (what/why/how to change).

---

## 11) Accessibility Baselines

- Contrast: primary actions and key text remain readable in light/dark.
- States: clear disabled, loading, focused, and selected states.
- Targets: comfortable tap/click targets; avoid tiny icon-only actions.
- Content: status is never color-only; always include text or icon+label.

---

## 12) Implementation Mapping (Reference Only)

This section is a pointer to where these guidelines will map when implemented (no code changes required to use this doc).

- Web tokens: `apps/web/src/app/globals.css` (CSS variables + shadcn roles)
- Web components: `apps/web/src/components/ui/*` and app-level components
