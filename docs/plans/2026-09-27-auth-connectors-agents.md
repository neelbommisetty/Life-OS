# Build authentication, connectors and the agent layer

Status: approved; implementation not started
Owner: Neel; implementing agent assigned when work starts
Last updated: September 27, 2026
Branch/worktree: not assigned; plan recorded on `main`
Approval: Neel's September 27 clarification: “plans to build auth connector and agents layer currently exists and in scope.” This plan records the confirmed scope; it does not claim implementation has begun.

Design authority: [architecture](../architecture/ARCHITECTURE.md), [authentication contract](../architecture/AUTHENTICATION.md), and the corrected findings and accepted limitations in the [security review](../reviews/SECURITY-REVIEW.md). Delivery overview: [STATUS.md](../STATUS.md).

## Outcome and boundaries

Neel can authenticate as the owner, configure permitted connections and agent access, submit a bounded request, and see its status and result. The root and independent agents act through skills and the HTTP CLI under distinct identities; the API enforces access to native data, connector operations and saved outputs. Independent agents can also act on owner-configured schedules/triggers within standing permissions.

Reuse the Node/Hono API, Tools, PostgreSQL, HTTP CLI, React/Vite web and same-origin bridge. Preserve current task/calendar/library behavior and provider adapters. The target architecture remains entirely unimplemented until this build delivers and verifies it; existing components are the starting baseline.

Included:

- Owner login and enrollment, session verification, owner-only administration and approval controls.
- Root and independent-agent identities, scoped runtime credentials, expiry/revocation, configurable data/action grants, and authenticated attribution.
- Typed connector definitions, connections, permissions, credential references, status, verified account binding and reconnection, and a local execution path using existing adapters.
- Request, assignment, run, approval, dispatch and result records; bounded execution, cancellation, idempotency, and uncertain-outcome handling.
- Explicit invocation in the existing Codex runtime, root assignment, independent owner requests, a bounded owner-configured schedule/trigger, and publication of permitted results through CLI/API to web.
- The web controls, API operations, CLI commands, migrations, tests and documentation needed for this scope.

Deferred: strong runtime isolation and trusted context reset, remote connector execution, broad background sync, arbitrary policy editors, multiple simultaneous runs per runtime credential, human CLI device login, multi-user tenancy, and unrelated life-area experiences. No new AI runtime or general job platform is required. Hosting, actual personal-account consent, live secret migration and deployment remain separately authorized operational actions; implementing their contracts and migration tooling is part of this build.

## Remaining work

All steps below are outstanding. They are one approved build sequence; routine steps within this scope do not require renewed approval.

### 1. Resolve implementation bindings and establish the contract

- Inspect the current code and preserve the existing client/server boundary and domain contracts.
- Verify the documented Clerk baseline against the required identity, credential, factor and recovery behaviors before integration. Nango remains a candidate, not a selected dependency.
- Define the local development secret interface, the initial connector/operation and fixed access profiles for the first workflow, and explicit invocation/scheduled dispatch in the existing runtime. Prefer the existing calendar/catalog adapters; record the chosen fixture workflow before coding it.
- Record consequential decisions in architecture and this plan. Host-specific custody and recovery bindings remain deployment prerequisites rather than blockers to local synthetic-data implementation.

### 2. Implement authentication and API authorization

- Add persisted owner, agent, credential-reference and versioned grant records using the existing database/migration patterns.
- Implement owner verification/enrollment, root and independent-agent authentication, expiry, revocation and owner administration; use injected synthetic identities in tests.
- Enforce operation, connection/collection, supported record/field, destination and output-recipient limits in API/Tools. Cover alternate reads, search, counts, exports, cached data, errors and receipt retrieval.
- Keep actor attribution distinct from authenticated identity. Prevent agent administration, self-approval and grant expansion; preserve the root's configurable broad read policy separately from writes and dispatch.
- Add the required owner UI and CLI integration, preserving server-side credentials and the shared design system.

### 3. Implement connectors and credential lifecycle

- Add explicit connector/connection registration and the local execution interface around the existing provider adapters. Keep domain-specific inputs/results and existing behavior.
- Resolve secrets at the backend custodian; expose only references and status to clients. Implement rotation/recovery and migration support without moving live secrets during development.
- Implement verified owner-bound connection attempts, provider identity matching, connection generations, reconnect/disable behavior and permission intersection. Validate callbacks or webhooks if the chosen flow requires them.
- Verify local connection health and freshness as separate states, provider failure handling, disabled cached reads, and explicit uncertain-write outcomes with fake providers.

### 4. Implement the agent request and result flow

- Persist bounded requests, approvals, assignments, runs, leases, dispatch claims and result recipients. Bind approvals and logical actions to exact caller/run, connection generation and normalized payload.
- Add authenticated CLI operations for claim, execution status and result publication; update the affected skills. A saved request must have an actual invocation path into Codex.
- Connect root assignment and independent direct requests without borrowing the root's key or depending on the root remaining online. Add the first bounded owner-configured schedule/trigger with overlap and budget limits.
- Add web input, owner decision, status and result surfaces. Enforce recipient access at publication and retrieval; preserve pending, needs-input, failed and completed distinctions.
- Demonstrate one complete synthetic workflow and its failure paths before broadening connector coverage.

### 5. Verify, prepare cutover and reconcile documentation

- Complete the authentication contract's [acceptance cases](../architecture/AUTHENTICATION.md#migration-and-acceptance) and the connector/dispatch cases below against disposable data.
- Implement and test explicit cutover from the old bearer path. Once the new mode is enabled, missing configuration or an old token must not fall back to broad access. Keep current local operation available until deliberate cutover; do not rotate live credentials as a documentation or test side effect.
- Record actual check results, remaining limitations and migration/recovery instructions. Update architecture, specs/contracts, runbooks, skills, plan status and the current-state inventory together.

Next action: assign the implementation checkout and complete step 1. No implementation blocker is currently recorded; provider/runtime bindings are explicit decisions to resolve during the approved build.

## Acceptance and verification

Completion requires the full [authentication acceptance contract](../architecture/AUTHENTICATION.md#migration-and-acceptance), not just a successful login or a happy-path agent call. In particular:

- The enrolled owner succeeds; another valid user, forged attribution, unregistered/cross-environment/expired/revoked keys and the old bearer in new mode fail.
- Root read access and narrower specialist grants work as designed; delegation cannot broaden grants. Alternate queries, caches, errors, exports, receipts and output sharing cannot bypass API policy.
- A real invocation through the existing runtime takes a synthetic request through skill → CLI → API → fake connector → persisted result → web. Root disconnect does not end independently authorized work.
- Direct and scheduled/triggered independent work obey grants, budgets, overlap limits and cancellation. An assignment row alone is not a passing dispatch test.
- Replayed/swapped connection completions, reconnected identities, disabled connections, changed grants, stale leases and expired approvals cannot cause new unauthorized dispatches.
- Concurrent duplicates, changed action payloads, crashes after provider success and uncertain outcomes preserve action identity and require reconciliation instead of blind retries.
- Owner controls enforce the documented session/factor, origin and approval boundaries. Credentials do not leak into client output, browser bundles, logs, receipts or exports.
- Existing tools and web workflows still pass relevant regression checks. Use `bun run typecheck`, `bun run test`, and `bun run web:build` when web changes land; use synthetic browser fixtures for owner and request/result flows.

Current results: no implementation checks run; all build acceptance checks are pending. The existing shared runtime is an accepted limitation: API authorization does not establish isolation of its tools, files, credentials or conversations.

## Documentation maintenance

Each implementation change updates this plan's remaining work and verification, the [status register](../STATUS.md), and the affected architecture/contracts/runbooks. Update diagrams and the current-versus-target distinction when behavior lands. Record design changes in the canonical architecture instead of leaving new decisions only in a plan or chat. Follow the [documentation update rules](../README.md#keep-this-useful).

## Completion

Not complete. No runtime implementation, provisioning, personal connections, deployment or live-secret cutover has been performed by this documentation work.
