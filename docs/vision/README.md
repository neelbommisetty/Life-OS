# Life-OS planning

The active implementation is the tools package, [shared tools API](API.md), and [Life-OS web](../../apps/web/README.md): one backend for existing tools functionality, an HTTP-based `life` CLI, and website slices at `/todo` and `/calendar`. Hosting remains deferred. The Health web prototype and its dedicated design and local-slice documents have been removed.

Start with [Current Vision](VISION.md), adopted September 5, 2026. It captures the longer-term Codex-and-vault direction, connected application experiences, and proposed publishing bridge. It does not authorize additional implementation.

[Life-OS architecture](../ARCHITECTURE.md), codified September 26, defines the agent execution layer through skills and CLI, the web input/output layer, and connectors with credentials, reads, actions, and permissions independent of execution location. It is the canonical architecture reference; service choices remain revisable and implementation requires its own scope.

[Human and agent authentication](../AUTHENTICATION.md) specifies owner Google login, distinct root-orchestrator and independent-agent identities, delegated runtime credentials, assignment limits, permissions, expiry/revocation, recovery, and acceptance criteria. The [confirmed initial scope](../AUTHENTICATION.md#confirmed-initial-scope) grants the root full data visibility, permits owner-configured independent schedules/triggers, and retains Codex with API-level permissions. The [adversarial design review](../SECURITY-REVIEW.md) records corrected gaps and accepted initial limitations. Deployment and dispatch bindings remain open; strong runtime isolation is deferred.

[Life-OS design system](../DESIGN.md) defines the finalized ocean-blue visual system for current and future web slices.

[Data and adaptive views](DATA-AND-VIEWS.md) preserves the proposed shared-record and focus-plan model for future interfaces.

[Hands: the todo list and calendar core](HANDS.md) specifies the implemented todo list and calendar in `packages/tools`.

[Leisure: the library and the diary](LEISURE.md) specifies the movie, TV, game, and book library. The first cut described in `packages/tools/README.md` is authorized; the second cut remains deferred.

[API setup and contract](../../packages/tools/API.md) documents local operation and verification.

The [August 28 legacy planning set](legacy/2026-08-28/README.md) is preserved for historical reference. Its PRD, architecture, and implementation choices do not govern the current direction.
