# Shared tools API

Authorized September 17, 2026: expose all existing tools functionality through an API and migrate the `life` CLI to use that API. Prefer established libraries over new infrastructure.

This document describes the implemented API milestone. The [September 26 architecture](../ARCHITECTURE.md) defines the target agent-through-skill-and-CLI execution model, web input/output surface, and permissioned connectors independent of execution location. Per-caller authorization, web-to-agent dispatch, and managed credential custody are future changes, not capabilities implied by the current bearer token.

Life-OS's database holds authoritative tool state. The API is the access boundary for interfaces. The server owns business rules, transactions, provider integrations, credentials, migrations, and diagnostics. The CLI owns shell arguments, interactive questions, local import/export files, and presentation. Web, iOS, and future interfaces can use the same HTTP operations without database or provider credentials.

The backend uses the existing `Tools` implementation. Hono supplies routing, middleware, and its Node adapter; Zod and `@hono/zod-openapi` supply validation and OpenAPI generation. No additional hosted service is introduced.

The complete current tool surface includes tasks and batches/imports, nested projects, sections, labels, filters, calendar accounts and sync, events and recurrence, scheduling views, the leisure library and diary, catalogs and availability, history, trash, export, diagnostics, and migrations. Deferred leisure imports and other unimplemented product features remain deferred.

The HTTP boundary preserves domain receipts, duplicate candidates, required decisions, warnings, partial-provider outcomes, idempotency keys, version checks, and date semantics. The authenticated caller supplies actor attribution for the audit trail; actor strings are not separate authenticated users. A caller timezone affects interpretation and views without replacing the server's clock.

This is a local single-user service with bearer authentication. It defaults to loopback. A hosted deployment, additional user accounts, token issuance/rotation UI, and offline synchronization are separate work. The API-hosted Google callback can be configured for another device with a registered web OAuth client and fixed HTTPS redirect URI; the existing desktop loopback flow remains the local default.

This milestone migrates the tools CLI and provides the API future interfaces consume. The Health web prototype has been removed; the proposed publication service remains unimplemented.

See [API setup and contract](../../packages/tools/API.md) for commands, authentication, HTTP examples, errors, OAuth sessions, and verification.
