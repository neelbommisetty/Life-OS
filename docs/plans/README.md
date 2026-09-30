# Build plans

Use this folder for bounded implementation work once a concrete slice is being planned. The [status page](../STATUS.md#active-work-and-queue) owns the queue.

| Plan | Approval | Implementation |
| --- | --- | --- |
| [Authentication, connectors and agent layer](2026-09-27-auth-connectors-agents.md) | In scope; confirmed September 27 | Not started |
| [Task duration from editor to calendar](2026-09-29-task-duration.md) | September 29 request; existing todo/calendar scope | Complete locally |

A plan can be proposed before approval. Label it clearly and record the actual approval source before treating it as approved. Design approval, build approval, personal-account setup and deployment are distinct scopes; reuse existing authorization when it already covers the work.

Name a plan `YYYY-MM-DD-short-name.md`. Keep this small structure:

```markdown
# Outcome to deliver

Status: proposed | approved | in progress | blocked | complete | deferred
Owner:
Last updated:
Branch/worktree:
Approval: source, date, and precise scope; or not yet approved
Related spec and architecture:

## Outcome and boundaries
User-visible result, included work, and excluded work.

## Remaining work
Concrete unfinished steps; next action; blocker if any.

## Acceptance and verification
Observable success criteria, relevant checks, and actual results/gaps.

## Completion
Delivered behavior, commit or PR reference when available, and status/spec updates.
```

Keep completed plans as evidence, updating the status page so they no longer appear active. Do not create a second general roadmap here or turn the vision into an implicitly approved task list.
