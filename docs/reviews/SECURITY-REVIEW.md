# Adversarial design review

Reviewed September 26, 2026. Scope: the architecture and authentication documents produced in this design session, their vision/index links, and their claims about existing API behavior. This is a design review, not a penetration test or a claim that these controls are implemented.

Found nine actionable gaps: six high, two medium, and one low. The design now specifies API-level corrections and verification criteria. Following this review, Neel chose to defer strong runtime isolation and accept the existing Codex setup's shared-access limitation for the first version. That residual risk is accepted, not fixed by API keys. The design remains in review for its initial deployment and dispatch bindings.

## Owner decisions after review

The [confirmed initial scope](../architecture/AUTHENTICATION.md#confirmed-initial-scope) supersedes earlier recommendations that made runtime isolation a first-release prerequisite. The root initially has full application-data visibility under a configurable read policy, independent agents may act on owner-configured schedules/triggers within standing permissions, and the existing Codex runtime remains. API checks still apply, but they do not isolate shared files, tools, credentials, or conversations. Strong runtime isolation and trusted context reset are deferred. These choices do not grant agent administration, self-approval, or unrestricted writes, and do not authorize deployment or personal-account setup.

## Method and assumptions

Considered a prompt-injected or compromised agent, hostile provider content, another valid Google user, stolen/replayed credentials, forged callbacks, cross-origin browser requests, concurrent workers, and crashes after external side effects. The owner, host administrator, backend, and credential custodians remain trusted; backend/host compromise is outside the promised isolation boundary.

Read the current TypeScript/React/Hono package configuration and existing API/bridge contracts to distinguish design work from shipped behavior. Applied the security-best-practices skill's React and general browser guidance; that skill contains no Hono-specific reference. Checked current primary Clerk, Nango, and OAuth documentation. No personal credentials or provider data were read, and no services were provisioned.

## High severity

### 1. API policy could be bypassed through runtime tools or outbound data

**Evidence before correction:** the architecture said, “The API enforces the rules,” and required filesystem isolation, but did not constrain alternate provider tools, owner browser sessions, built-in agent messaging, or arbitrary network destinations. Refusing HTTP redirects did not constrain the CLI's initial API URL.

**Attack:** a restricted mail agent reads an allowed message, copies it into a public catalog search or another tool's request, or sends its bearer key to an attacker-selected API origin. It can also leak through shared transcripts without calling Life-OS result publication.

**Disposition:** accepted residual risk in the first version; stronger mitigation deferred. [Runtime trust and data leaving the system](../architecture/AUTHENTICATION.md#runtime-trust-and-data-leaving-the-system) separates initial API checks from later tool/filesystem/network isolation. Approved credential destinations, secret handling, and Life-OS output checks remain required, but shared runtime access and alternate tools can bypass the API boundary. This is not a claim of end-to-end isolation.

**Acceptance:** verify initial Life-OS API destination/output checks. In the later isolation phase, attempt direct network/provider/MCP/browser access, sibling messaging, API-origin overrides, and copying private text into a permitted public query. Those runtime tests must pass before claiming strong agent isolation; they are not first-version launch gates under the owner's decision.

### 2. Field filtering and output labels did not establish confidentiality

**Evidence before correction:** policy specified “readable fields” and said stored data should “retain source/ownership metadata,” without defining who establishes that metadata or whether queries can inspect hidden fields.

**Attack:** an agent infers a hidden message body through search/count queries, changes a record's eligibility label, or publishes private text as a supposedly public summary with an incomplete source list.

**Fix:** [per-agent data access](../architecture/AUTHENTICATION.md#per-agent-data-access) now constrains queryable as well as returned fields, requires current authoritative membership and source/destination checks, and derives restrictions from trusted metadata. Generated text conservatively inherits all input restrictions; only trusted deterministic projections narrow disclosure. Start with supported fixed profiles, not a universal field-policy editor.

**Acceptance:** probe hidden fields through filters/sorts/counts, move records across permission boundaries, falsify source labels, and publish mixed-source summaries to a less-privileged recipient. Unsupported filtering must deny access.

### 3. OAuth account attachment and reconnection were underspecified

**Evidence before correction:** the connector contract had “ID and owner” and a “Credential reference,” but no complete protocol for binding browser/broker completion to an owner-authorized attempt or preserving external identity during reconnect.

**Attack:** submit another connection ID, replay a completion, reconnect a different external account under existing grants, or replay a signed recovery webhook after local disablement.

**Fix:** [connecting and reconnecting accounts](../architecture/ARCHITECTURE.md#connecting-and-reconnecting-accounts) specifies server-owned pending attempts, provider-library protocol checks, backend verification, explicit account confirmation, stable identity, connection generations, and persistent local disablement. Webhooks authenticate payloads and reconcile current state; they cannot authorize work. Nango administration credentials never become agent tools.

**Acceptance:** test swapped accounts/environments/integrations, expired and duplicate completions, wider consent, forged/reordered webhooks, and reconnect after local disablement. Old-generation approvals and dispatches must fail.

### 4. The owner approval surface lacked explicit browser and factor enforcement

**Evidence before correction:** the design required recent verification and exact approval parameters, but did not explicitly forbid backend acceptance of a downgraded factor or define how agent/provider content reaches an owner approval screen.

**Attack:** malicious output renders active content or tracking resources in the owner session, substitutes a friendly summary for a harmful payload, or reaches a privileged endpoint with only a frontend verification check. Clerk's documented automatic factor downgrade makes checking the required factor important.

**Fix:** [owner login](../architecture/AUTHENTICATION.md#owner-bootstrap-and-login) requires backend-verified recent second-factor state with no silent downgrade. The [browser and approval boundary](../architecture/AUTHENTICATION.md#browser-and-approval-boundary) defines route/origin/CSRF protections, safe rendering, no automatic remote embeds, CSP/framing controls, and immutable backend-derived approval displays.

**Acceptance:** submit raw HTML, hostile links/images, cross-origin mutations, mixed credentials, missing factors, and changed approval payloads. The displayed action and executable action must be identical.

### 5. Run IDs and leases could be mistaken for an enforceable execution boundary

**Evidence before correction:** “concurrent duplicate claims cannot execute the same run twice.” The design did not expressly forbid omission of run scope or explain the limits of several processes sharing one runtime credential.

**Attack:** drop the run ID to seek standing access, switch to another assignment while retaining private context, or let an old worker continue after lease reassignment.

**Fix:** [agent coordination](../architecture/AUTHENTICATION.md#root-orchestrator-and-independent-agents) requires active API run binding, lease generations checked on actions/results, and one active run per credential initially. It no longer promises exactly-once execution or context isolation from a lease. A trusted supervisor that destroys old contexts and controls reset is deferred with runtime isolation; carryover through the shared runtime remains an accepted limitation.

**Acceptance:** test missing/swapped API run IDs, stale lease generations, concurrent claims, and inactive-run operations. Crash recovery must reconcile effects before replay. Supervisor control-path and context-reset tests apply when the later isolated runtime is introduced.

### 6. Existing idempotency was assumed to cover new approvals and remote execution

**Evidence before correction:** “Use the existing receipt/idempotency mechanism to record a dispatch claim.” Current API documentation establishes domain receipts and client retry behavior, not the new per-agent approval/dispatch ledger.

**Attack:** reuse a key with changed input or another agent, recover a sensitive cached receipt after losing read permission, replay expired approval as a fresh action, or retry after provider success followed by a backend crash.

**Fix:** [standing permissions and requests](../architecture/AUTHENTICATION.md#standing-permissions-and-individual-requests) now explicitly requires additional durable authorization/dispatch records, exact normalized payload and connection-generation binding, atomic approval consumption, authorized receipt retrieval, and retention that cannot turn an old key into a new action. Unknown external outcomes require provider-supported reconciliation or manual resolution.

**Acceptance:** inject crashes before/after provider success, race duplicate requests, change payloads/defaults, expire approval, reduce read access, and reuse a key after cleanup. None may cause an unapproved new effect or disclose an unauthorized receipt.

## Medium severity

### 7. Revocation timing and cached-data behavior were ambiguous

**Evidence before correction:** “recheck permissions when executing delayed work” lacked a defined dispatch boundary; signing out, disabling connections, and deleting synchronized data were distinct but agent access to retained copies was unspecified.

**Attack:** a queued remote action uses an old authorization snapshot after revocation, or a disabled connection's imported data remains accessible through a cache endpoint.

**Fix:** [dispatch authorization](../architecture/AUTHENTICATION.md#standing-permissions-and-individual-requests) serializes local state changes against the final claim and requires remote executors to claim current stored operations. Revocation cannot retract an already claimed external call; that race is explicit. [Data ownership and reliability](../architecture/ARCHITECTURE.md#data-ownership-and-reliability) denies new agent reads of disabled connections, including retained copies, while distinguishing transient outages from disablement.

**Acceptance:** revoke/cancel before and after final dispatch claim, return a delayed response after policy reduction, and request cached data after connection disablement. Record in-flight uncertainty honestly rather than promising cancellation.

### 8. Authorized loops could exhaust resources and provider quotas

**Evidence before correction:** assignments had deadlines and operation/resource limits, but no finite cumulative assignment/call budgets or requirement that recursive children consume the parent's budget. Per-operation online verification increases the impact of loops.

**Attack:** the root repeatedly creates individually valid child runs, or an agent loops on allowed reads and large results, exhausting cost, memory, or provider/identity quotas.

**Fix:** [workflow limits](../architecture/AUTHENTICATION.md#standing-permissions-and-individual-requests) require finite cumulative budgets, concurrency/runtime/result limits, bounded requests/pages/timeouts, and rate limits using the existing backend/database. Children cannot reset their budget by delegating again.

**Acceptance:** test recursive delegation, parallel budget consumption, repeated valid calls, oversized results, and identity-service throttling. Stop at the configured bound and surface a reviewable failure.

## Low severity

### 9. The vision contradicted the current task authority

**Evidence before correction:** the vision said, “The initial task surface mirrors Todoist,” while its provider table and architecture correctly described existing native Life-OS tasks.

**Impact and fix:** this could lead a later implementation to write to the wrong authority or assume an existing two-way mapping. The [task vision](../vision/VISION.md#tasks-and-calendar) now consistently distinguishes native application tasks from Todoist-owned vault workflows and makes any reconciliation an explicit future transition. Checked the provider table and implementation summary for agreement.

## Remaining implementation gates

API-level design corrections and the accepted runtime limitation are documented. They do not make the application deployment-ready:

- Verify separate enrolled identities, broad root read access, narrower specialist API access, and bounded owner-configured schedules/triggers using the existing runtime. Do not present those API checks as isolation of shared tools/files/context.
- Select host/ingress, secret custody, recovery, and backup handling; verify Clerk/broker compatibility, required factors, and per-request verification cost/availability.
- Implement one bounded workflow and its needed schedule/trigger before expanding connectors, arbitrary selectors, remote execution, or broader unattended dispatch. Exercise API denial and crash cases with fake providers and disposable schemas.

Later hardening: demonstrate runtime isolation, trusted lifecycle reset, restricted egress, and transcript handling with synthetic data before claiming those stronger guarantees. This is deferred work, not an initial release prerequisite.

No runtime tests were run for this documentation-only change. Markdown links/anchors, formatting, and cross-document consistency were checked. Runtime behavior remains unverified until implementation.

## Primary references checked

- [Clerk API keys](https://clerk.com/docs/guides/development/machine-auth/api-keys) and [request verification](https://clerk.com/docs/reference/backend/authenticate-request): existing issuance/verification primitives; application enrollment and policy remain Life-OS responsibilities.
- [Clerk reverification](https://clerk.com/docs/guides/secure/reverification): supported factors and downgrade caveat; the design explicitly requires its chosen factor.
- [OAuth security best current practice](https://www.rfc-editor.org/rfc/rfc9700.html): authorization-flow binding and redirect protections.
- [Nango connect sessions](https://nango.dev/docs/reference/backend/http-api/connect/sessions/create) and [webhook verification](https://nango.dev/docs/guides/platform/webhooks-from-nango): scoped consent sessions and the current HMAC/signing-key mechanism.
