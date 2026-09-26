# Life-OS planning

The active implementation is the tools package and [shared tools API](API.md): one backend for existing tools functionality and an HTTP-based `life` CLI. Hosting remains deferred. The Health web prototype and its dedicated design and local-slice documents have been removed.

Start with [Current Vision](VISION.md), adopted September 5, 2026. It captures the longer-term Codex-and-vault direction, connected application experiences, and proposed publishing bridge. It does not authorize additional implementation.

[Data and adaptive views](DATA-AND-VIEWS.md) preserves the proposed shared-record and focus-plan model for future interfaces.

[Hands: the todo list and calendar core](HANDS.md) specifies the implemented todo list and calendar in `packages/tools`.

[Leisure: the library and the diary](LEISURE.md) specifies the movie, TV, game, and book library. The first cut described in `packages/tools/README.md` is authorized; the second cut remains deferred.

[API setup and contract](../../packages/tools/API.md) documents local operation and verification.

The [August 28 legacy planning set](legacy/2026-08-28/README.md) is preserved for historical reference. Its PRD, architecture, and implementation choices do not govern the current direction.
