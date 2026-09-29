# Life-OS documentation

Start here, then read [current state and build scope](STATUS.md). These two pages are the shared entry point for Neel and agents.

| Question | Read | What it establishes |
| --- | --- | --- |
| What is the ambition? | [Vision](vision/VISION.md) and [product principles](../PRODUCT.md) | The life experiences we want to make possible; not a build authorization. |
| What actually exists? | [Current state](STATUS.md#current-implementation) | Implemented capabilities in this checkout, evidence, and limits. |
| What is approved to build? | [Scope register](STATUS.md#scope-register) | Approval and delivery tracked separately, with sources and boundaries. |
| What is in progress or next? | [Active work and queue](STATUS.md#active-work-and-queue) | Current work, remaining steps, and whether a next step is approved or only proposed. |
| How should the system fit together? | [Architecture](architecture/ARCHITECTURE.md) | Approved auth/connector/agent target design, entirely unimplemented; current capabilities are recorded separately in STATUS.md. |
| How should a feature behave? | [Feature specifications](specs/README.md) | Domain decisions; a spec can include both delivered and deferred scope. |
| How do I run or change it? | [Tools brief](../packages/tools/README.md), [API contract](../packages/tools/API.md), [web guide](../apps/web/README.md) | Code-adjacent implementation and operating instructions. |
| What should the UI look like? | [Design system](DESIGN.md) | Shared visual and interaction contracts; [DESIGN.json](DESIGN.json) is the generated token export. |
| What was reviewed? | [Reviews](reviews/README.md) | Dated findings and validation evidence, not a live backlog. |

## Folder structure

```text
docs/
  README.md              navigation and documentation rules
  STATUS.md              current state, approvals, active work, and queue
  vision/                ambition and historical planning
  architecture/          system boundaries and target technical designs
  specs/                 feature behavior and milestone scope
  plans/                 bounded implementation plans when work is scheduled
  reviews/               dated reviews and verification records
  DESIGN.md              canonical shared design system
  DESIGN.json            generated design tokens and component contracts
```

Detailed runbooks stay beside the code. Historical planning stays under `vision/legacy/` and is not part of the default reading path. The old identity proposal path is a pointer to the architecture, not a competing design.

## How to read authority

The user's current instructions and applicable [AGENTS.md](../AGENTS.md) govern work. `STATUS.md` records the known scope and progress; it cannot grant permission by itself. Feature briefs specify the approved subset. Architecture and vision guide decisions without authorizing all of their future features. Reviews record what was checked at a particular time.

Code establishes what is implemented; verification establishes what was checked. Neither proves a feature is deployed, a provider is connected, or a live account is healthy. Keep those claims separate and state unknowns explicitly.

## Keep this useful

Documentation is part of the definition of done for every relevant change, without a separate user request. Before implementation, read the affected documents. Before reporting completion, reconcile them with the actual behavior in the same change.

| Change | Required documentation update |
| --- | --- |
| Responsibilities, boundaries, data flow, identities, permissions, connectors, secret custody, runtime or technology | Update the canonical architecture and diagrams; mark what is implemented and what remains target behavior. Record the decision and reason. |
| Work starts, advances, blocks, changes scope or completes | Update its plan with remaining work, next action, actual verification and gaps; update STATUS.md. |
| Feature behavior, API/CLI contract or operating procedure | Update the affected spec, API contract, package/app README and agent skills. |
| Shared UI design | Update DESIGN.md and regenerate/check DESIGN.json as needed. |
| Ambition or product direction | Update vision and PRODUCT.md; routine implementation does not require rewriting the ambition. |
| Review finding resolved | Preserve the dated finding and add/link its resolution evidence; do not rewrite historical results as a new review. |

Check affected links and anchors. A change with no documentation impact can say so briefly in its completion report; avoid date-only edits. Do not leave current decisions only in a chat or plan. As implementation lands, revise the architecture's blanket “unimplemented” label into explicit implemented and remaining portions.

Update `STATUS.md` in the same change when approval, active work, implementation, or verification changes. Record the approval source and date where known; do not invent missing approval dates or infer approval from a design decision.

For substantial implementation work, use a [build plan](plans/README.md) with a bounded scope, an owner, a branch/worktree reference, remaining work, and acceptance checks. Link it from the status page. Routine fixes do not need a separate plan. Mark work in progress only when it has actually started; an old branch or an unfinished design is insufficient evidence.

Keep mutable project status in `STATUS.md`, detailed behavior in specs, and technical contracts beside their code. Update a document's status note when its meaning changes, but avoid copying the whole status register into other documents. Move completed-plan detail into its completion record and link its evidence; do not leave completed work in the active queue.
