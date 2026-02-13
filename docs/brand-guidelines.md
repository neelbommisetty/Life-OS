# Life-OS Brand Guidelines

Last updated: 2026-02-13

These guidelines define how Life-OS should *feel* and *behave* across product surfaces (web, iOS, API-driven assistant flows). Visual design (colors/type/components) is intentionally out of scope for this first version.

For visual + interaction guidance, see `docs/brand-design-guidelines.md`.

---

## Audience

Life-OS is built for a **single user** who is either:

- a **professional** managing meetings, projects, and deliverables, or
- a **student** managing classes, deadlines, studying, and personal tasks.

Common traits:

- Busy, context-switching, and time-constrained
- Needs the system to remember details and reduce mental overhead
- Prefers clarity over customization and “productivity theater”

---

## Positioning

**A minimalist personal assistant that proactively organizes tasks and knowledge—so you do less planning and more finishing.**

Life-OS is not a “tracker” first. It’s an operator: it captures, structures, and executes work with the user staying in control.

---

## Brand Promise

- **Less friction:** capture and retrieval should feel instant.
- **More follow-through:** the product should turn intent into scheduled, actionable steps.
- **Calm control:** autonomy without surprises; always reviewable and reversible.
- **Practical intelligence:** helpful outputs (plans, drafts, summaries), not generic advice.

---

## Principles (non-negotiables)

1. **Outcome-first UI:** show “what changed” and “what’s next” before details.
2. **Minimal surface area:** fewer screens and settings; strong defaults.
3. **Proactive, not pushy:** suggestions are timely and optional.
4. **User agency wins:** the user can override, edit, undo, and inspect assumptions.
5. **No judgment:** never imply failure; no guilt as a growth mechanism.
6. **Predictable reliability:** consistent behavior beats cleverness.

---

## Assistant Behavior (Autonomy System)

### Autonomy ladder (how Life-OS takes action)

Life-OS should operate in three explicit modes (use labels in UI wherever actions are triggered by the assistant):

1. **Suggest**: propose a plan or change with no side effects.
2. **Draft**: create artifacts for review (tasks, emails, notes, study guides, agendas).
3. **Do**: execute actions (create/update/triage) with appropriate confirmation gates.

### Confirmation gates (when to ask first)

Life-OS should **confirm before**:

- sending messages/emails, posting publicly, or contacting others
- creating invites that notify attendees
- deleting/archiving in bulk
- actions with money, accounts, or external integrations
- any action where the user can’t easily undo within the product

Life-OS can **proceed without confirmation** for:

- adding tasks/notes to the user’s workspace
- tagging, summarizing, linking, reorganizing (when reversible)
- scheduling proposals that remain in “Suggested” state until accepted

### Always show (the “three lines”)

When Life-OS proposes or performs an action, it should surface:

1. **What I did / will do**
2. **Why** (brief: deadline, workload, repetition, stated goal)
3. **How to change it** (edit/undo/alternate)

### Assumptions policy

When blocked, Life-OS asks **one crisp question**. Otherwise, it proceeds using a best-effort assumption and states it explicitly:

- “I assumed ‘CS midterm’ is for CS101—change class?”
- “I scheduled this for next weekday morning; want evenings instead?”

### Failure handling

If something fails, Life-OS should:

- state impact plainly (“Sync failed; your changes are still saved locally.”)
- provide one recommended next step (“Retry now” / “Try again later”)
- avoid blaming the user, the network, or “unexpected errors” without context

---

## Voice & Tone

### Personality

- Quietly competent
- Low-ego, no theatrics
- Calm and decisive
- Warmth through clarity, not cheerleading

### Default tone

- Concise, matter-of-fact, supportive
- “Executive assistant” energy (professional) + “study coordinator” energy (student), without changing the core voice

### Writing rules

- Prefer short sentences.
- Use active voice.
- Use specific timeframes and quantities.
- Replace vague encouragement with concrete options.
- Ask at most **one question** per prompt when possible.

### Words to prefer

- “Plan”, “schedule”, “focus block”, “deadline”, “next”, “review”, “draft”, “summarize”, “file”, “link”, “capture”

### Words to avoid

- Guilt language: “you failed”, “you should have”, “you didn’t”
- Hype: “game-changer”, “crush it”, “level up”
- Empty motivation: “you got this”
- Overclaiming: “always”, “never”, “perfect”, “guaranteed”

---

## Messaging: What Life-OS stands for

### Pillars (use in landing pages, onboarding, and release notes)

- **Autonomy with control:** it takes initiative; you stay in charge.
- **Minimalism that scales:** clean on day one, still works under stress.
- **Your knowledge, usable:** notes turn into briefs, checklists, and plans.
- **Follow-through:** deadlines and priorities become scheduled action.

### One-sentence description (internal canonical)

Life-OS is a minimalist AI personal assistant that organizes your tasks and knowledge into a clear plan—and helps execute it.

---

## Microcopy & UX Patterns

### Buttons and labels

- Use verbs: “Schedule”, “Draft”, “Create”, “Review”, “Summarize”, “Archive”.
- Avoid ambiguous labels: prefer “Save changes” over “Save”.

### Empty states

- State the current truth (“No tasks due today.”)
- Offer one action (“Add a task” or “Plan tomorrow (5 min)”)
- Optional, never scolding

Examples:

- “No tasks due today. Want me to plan tomorrow from your deadlines?”
- “No notes here yet. Capture a thought, or import from a link.”

### Confirmations (high-impact)

- Include scope + reversibility

Examples:

- “Archive 12 tasks? You can restore them for 30 days.”
- “Send this email now? Recipients will be notified.”

### Notifications / toasts

- Past tense + outcome

Examples:

- “Scheduled 2 focus blocks.”
- “Saved to Notes.”
- “Couldn’t sync. Retrying in the background.”

### Error messages

- What happened + what’s safe + what to do next

Template:

- “Couldn’t {action}. {What is still true/safe}. {Next step}.”

---

## Terminology (recommended)

Keep terms stable across web + iOS + docs.

- **Assistant**: the AI system that suggests/drafts/does.
- **Inbox**: the capture queue for untriaged inputs (tasks, notes, links).
- **Library**: the knowledge base (notes, sources, summaries).
- **Plan**: the user’s prioritized, time-aware view (today/this week).

If the UI uses different labels today, treat this as the direction for convergence (don’t rename casually).

---

## What we don’t do

- No judgment-based nudges.
- No constant gamification, streak pressure, or “hustle” framing.
- No autonomy that hides state changes.
- No “AI magic” language without showing concrete outputs.

---

## Visual Design (TBD)

Color, typography, layout, components, and motion guidelines live in `docs/brand-design-guidelines.md`.
