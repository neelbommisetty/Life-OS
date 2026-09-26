# Todo route: Impeccable review and design-system implementation

Reviewed September 25, 2026 against the disposable web fixture. Scope: `/todo`, shared web foundations and an isolated component catalog. Product register. The original review assessed the green identity; the final ocean-blue decision below supersedes that palette.

## Verdict

The baseline was a credible, calm task interface, not an over-decorated dashboard. Its weaknesses were systemic: low-contrast secondary text, small interaction targets, competing CSS overrides and an overly dense capture form. Existing task grouping, familiar navigation, local fonts, API receipts and recovery via Completed/Trash are useful foundations.

Independent visual and automated assessments were performed without sharing their findings. The source-only detector found no issues; the rendered detector found fourteen warnings on Today. Eight concerned contrast. Examples included secondary text at 3.7–4.2:1 and shortcut hints at 3.0:1. The baseline completion control measured 20×20px and icon controls 30×30px.

The detector also flagged date context, tracked captions and repeated row spacing. Date context and regular list rhythm are appropriate for this product; those were not accepted as defects. Tiny captions and low contrast were accepted. Impeccable 4.1's live command differed from the skill's overlay instructions; the independent detector used its modern rendered scan plus the packaged 2.0 browser overlay. Their counts are not directly interchangeable.

## Baseline design health

These are review judgments, not automated accessibility certifications.

| Nielsen heuristic | Score / 4 | Finding |
| --- | --- | --- |
| Visibility of system status | 3 | Skeletons, pending feedback and success messages present |
| Match with the real world | 3 | Familiar task vocabulary; due date versus deadline unexplained |
| User control and freedom | 3 | Cancel, Escape, reopen and restore available; no immediate undo |
| Consistency and standards | 3 | Coherent identity but repeated styling overrides |
| Error prevention | 3 | Version, duplicate and pending protections preserved |
| Recognition over recall | 2 | Priority relied on color; labels needed remembered formatting |
| Flexibility and efficiency | 3 | Shortcuts and alternate layouts; heavy quick-capture form |
| Aesthetic and minimalist design | 3 | Clear rows, but repeated encouragement/counts delayed work |
| Error recovery | 2 | Persistent failures, but some API messages remain technical |
| Help and documentation | 1 | Limited visible guidance for task options |
| **Total** | **26 / 40** | **Targeted usability improvements needed** |

Technical baseline: accessibility 2, performance 3, responsive design 2, theming 1, anti-patterns 3: **11 / 20**. Only a light theme is in scope; missing dark mode is not counted as a defect.

Cognitive load was moderate: Today had repeated context and counts; capture exposed seven metadata choices together. For a phone user, the combination of small targets and many initial fields increased effort. For a keyboard user, mobile navigation lacked an explicit focus lifecycle. For a first-time user, priority colors and label conventions depended on recall.

## Prioritized findings and outcomes

| Severity | Finding and impact | Implemented response |
| --- | --- | --- |
| P1 | Essential metadata, navigation hints and captions fell below normal-text contrast targets | Replaced scattered values with semantic OKLCH text/surface roles; removed opacity and faint overrides |
| P1 | Small completion and icon controls required precise taps | Shared 44px controls, with a 20px visual completion circle inside its hit area |
| P1 | Mobile drawer could strand keyboard focus | Initial focus, Tab containment, Escape dismissal, visible close button, background inertness, scroll lock and return focus |
| P2 | Theme documentation described accidental CSS behavior rather than defining reusable foundations | Dedicated primitive/semantic tokens, shared controls/shell, generated JSON export and drift check, documented contracts, working catalog |
| P2 | Quick capture presented too many fields | Due date and project stay visible; optional metadata moves into a native disclosure that preserves values |
| P2 | Priority and field conventions depended on memory | Explicit textual priority, label-format hint and due-date/deadline explanation |
| P2 | Repeated summaries and encouragement delayed the task list | Removed decorative header/footer copy and duplicate Today count; added a visible page-level Add task action |
| P2 | Enlarged text overflowed toolbar and breadcrumb | Wrapping layouts verified at 200% text size |
| P3 | A restore control could appear empty until hover | Restore icon is visible in its default state |

Relevant refinement categories were harden, adapt, extract, distill and clarify, followed by a visual polish pass. The requested implementation authorized these straightforward repairs without an additional design-direction approval.

## Delivered system

- `tokens.css`: primitive palette, semantic colors, typography, spacing, control sizes, geometry, layout, layer and motion tokens.
- `theme.css`, `shell.css`: shared styles with no copied color literals or appended patch layer.
- `Button`, `IconButton`, `Badge`: typed primitives migrated into the task slice; existing Radix menus/dialogs retained, with explicit dialog focus restoration.
- `Shell`: configurable slice title/description and accessible responsive navigation.
- `docs/DESIGN.md`: design roles, component usage, interaction contracts and extension guidance.
- `docs/DESIGN.json`: generated from CSS, checked by `design:check`.
- `design-system.html`: development-only working specimens, no API or personal data.

## Verification

- Full `bun run test`: **643 passed, 0 failed, 0 skipped** (636 tools, 7 web).
- `bun run typecheck`, `bun run web:build`, `design:check`: passed.
- Browser checks at 320, 390, 768 and 1440px: no document horizontal overflow; completion targets measured 44px. Board scrolling remains inside its region.
- 390px viewport with 200% root text size: no horizontal document overflow after the wrapping fix.
- Reduced-motion preference: navigation transition resolves to 0s.
- Phone drawer: opening focus, backward Tab wrap, Escape, background inertness, scroll lock and focus restoration verified.
- Disposable task creation and completion: passed. Priority and label values survived collapsing the options disclosure before save and appeared in the returned task row.
- Axe on the updated task list: no violations or incomplete checks in the final inspected state. Task dialog and catalog scans: no confirmed violations; the dialog's background-focus check required manual review because it uses a focus-managed overlay.
- Screenshots inspected for desktop, phone and catalog; runtime artifacts remain ignored under `.local/design-review/`.

No production or personal records were used for mutation checks. No deployment or push was performed. These checks are bounded evidence, not a claim of complete WCAG conformance or coverage of every task state.

## Remaining product opportunities

Existing labels still use a comma-separated input rather than suggestions. API/domain error copy can become more specific, and immediate undo may reduce the cost of accidental completion. These are follow-up product behaviors, not missing design-system foundations. Future slices should reuse this system only when separately authorized.

## Palette decision after review

Neel subsequently selected and finalized ocean blue for all of Life-OS on September 25, 2026. The shared foundation now uses pale ocean-blue primary controls, readable darker blue labels, and light cool neutrals. `docs/DESIGN.md` and the generated token export record the selected palette; the baseline review above describes the earlier green interface.
