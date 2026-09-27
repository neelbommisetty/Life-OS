# Human and agent authentication

Design baseline, September 26, 2026. This specifies the authentication work required by [Life-OS architecture](ARCHITECTURE.md). It is not implemented, and does not authorize creating accounts, issuing credentials, or migrating personal secrets. Defaults below are concrete design choices for review, not existing behavior.

## Decision

Use Google sign-in through Clerk for Neel and backend-issued Clerk user API keys for delegated agent executors. Both authenticate to the existing Life-OS API. The API distinguishes the credential types before deciding what a caller can do.

An agent key is associated with Neel's account but identifies a particular registered agent runtime, such as the root orchestrator on his Mac or an independent calendar agent on the VPS. The root and independent agents have different keys and grants. Sharing the account subject never confers owner privileges or another agent's permissions. No separate agent Google account, copied browser session, or custom token issuer is needed.

| Caller | Credential | Authority |
|---|---|---|
| Neel in the web | Verified Clerk session after Google sign-in | Owner UI and explicitly supported user operations |
| Agent through CLI | Registered, scoped, expiring API key | Delegated operations for permitted connections and requests |
| Connector executor | Its configured service credential | Execute only authorized connector operations |
| External provider | Provider-specific credential in protected custody | Provider grants; never authenticates the caller to Life-OS |

Human CLI administration and a separate OAuth device-login flow are deferred. The first CLI integration uses delegated credentials, including when Neel invokes commands manually. Owner administration remains in the web. This keeps the first implementation to two authentication paths.

## Confirmed initial scope

Neel clarified these choices after the adversarial review:

- **Root visibility:** the root initially reads all Life-OS application/connector data, agent results, and API-held context. Its own configurable read policy grants this visibility; it can be narrowed later. This does not grant secret retrieval, unrestricted writes, permission administration, or self-approval. External provider grants and disabled-connection rules still apply.
- **Independent operation:** agents may start work from schedules and triggers Neel configures, within their standing permissions. The root need not assign each occurrence or remain online. Agents cannot create broader schedules, trigger bindings, or grants for themselves.
- **Initial runtime:** retain the existing Codex setup and enforce per-agent permissions at the Life-OS API. Shared files, tools, and conversations do not have strong isolation. Neel accepts that limitation to keep the first implementation manageable; isolated runtimes are a later hardening phase, not a launch prerequisite.

All initial-phase guarantees below apply to authenticated Life-OS API requests. They do not prevent a process with access to another credential or an alternate tool from using that access. Later isolation requirements are identified separately. These choices specify the design; they do not provision credentials, connect accounts, or authorize deployment.

## Root orchestrator and independent agents

There are three application identities: Neel as owner, a named root orchestrator agent, and multiple named independent agents. Every agent is separately enrolled by the owner. The root is not a superuser; independence means agents can execute their own authorized work and accept direct owner requests, not that they bypass policy.

Distinguish a stable **agent identity**, its **runtime credential** for a particular installation/environment, and a **run** assigned to that agent. Two installations of one agent get different revocable credentials. A run records which credential executed it without needing a new identity account for every task.

| Identity | May do | May not do |
|---|---|---|
| Neel | Enroll agents, configure grants/workflow limits, authorize requests, review outputs, revoke access | Bypass external provider permissions |
| Root orchestrator | Read all application/connector data and results under its initial read policy; plan, assign permitted work, synthesize outputs, use explicitly granted write actions | Issue keys, change grants, impersonate agents, approve its own writes, retrieve raw credentials through the API |
| Independent agent | Claim assigned work or start configured scheduled/triggered work; use its own permitted connectors/actions and publish results | Claim another agent's run, broaden schedules or assignment scope, retrieve sibling credentials or unauthorized outputs through the API |

An authenticated root can assign a run only under an owner-approved request or standing workflow authorization. The server validates the target agent, allowed operation set, connection/resource limits, deadline, and permitted result recipients. These are simple configured workflow/assignment fields, not instructions interpreted by an authorization LLM. The root cannot turn arbitrary text into an approved grant.

The root initially has broad read access. If its policy is narrowed later, it may still assign a mail-reading workflow without direct mail-read permission when the owner has authorized that delegation and the target agent has the capability. Assignment is bounded by both the workflow authorization and target grants; it never creates a missing capability.

For independent scheduled/triggered work, persist an owner-configured workflow binding with its target agent, schedule or validated event type/source, allowed inputs, standing scope, and limits. Each occurrence creates a bounded run and rechecks current grants. Trigger payloads are untrusted data and cannot set permissions or executable commands. Deduplicate occurrences; disabling the binding prevents new runs and revoking grants blocks subsequent actions. An existing scheduler or bounded scheduled command is sufficient initially; no new automation service is required. This is a product design decision, not a request to create an automation in this chat.

Agents claim assignments with their own authenticated identity. The API atomically binds each run to the agent, claiming credential, and a lease generation. Every subsequent operation checks that binding, run scope, current grants, and request validity. Expired or superseded lease generations cannot start actions or publish results. A lease prevents concurrent valid claims; it does not guarantee exactly-once execution after a crash. External actions with uncertain outcomes require reconciliation before another attempt. A stopped root does not revoke valid assigned work. Parent-request cancellation denies new dispatches under it, while unrelated direct work can continue. Root credential revocation blocks new root actions; an explicit cancel-request or disable-all-agents control stops outstanding work as appropriate.

All agent data/action calls require an active server-recorded run; omitting or changing a request ID must not fall back to broader standing access. A direct conversational task gets a run bounded by its standing grant, without pretending the conversation is authenticated owner approval. Initially allow one active run per runtime credential; overlapping occurrences wait or skip according to the configured workflow. The API rejects an inactive run or stale lease, but run IDs and distinct keys do not isolate processes that share access to those keys. Authentication status and limited assignment discovery are explicit exceptions with no task payload disclosure before authorization. A supervisor that destroys old contexts and securely resets runtime availability belongs to the later isolation phase.

Published results have explicit recipients and output types. The root is an authorized reader of all results under its initial broad read policy; an assignment can return a concise summary without removing that underlying visibility. Independent agents retain their narrower result access. If root visibility is restricted later, check its current policy on every retrieval. A free-form summary is not a confidentiality filter, and shared runtime context is outside the initial API boundary.

The first implementation uses owner-enrolled agent profiles and existing API/database records. The root chooses among profiles; it cannot create security principals through the API. Install the appropriate credential for each agent's CLI calls and avoid collecting all keys in a shared `.env` file. The existing Codex runtime remains in use. Shared OS/tool access may still expose other credentials or context, so these profiles provide API authorization and attribution rather than a strong boundary against a compromised sibling process. A trusted supervisor injecting credentials into isolated environments is deferred.

There is no new agent-to-agent authentication protocol: coordination, assignment, and result access go through Life-OS's existing authenticated API. Ordinary authenticated polling/claiming is enough initially. How that invokes Codex is still an explicit dispatch integration, not something an assignment table alone implements.

## Per-agent data access

Every agent, including the root, has an owner-configured data-access policy attached to its stable identity. Connector access alone is insufficient: permission to use Gmail does not mean permission to read every message, and permission to read an event does not imply permission to edit it. Native Life-OS records and stored outputs need the same checks as external data.

| Policy dimension | Explicit limits |
|---|---|
| Connections and data collections | Allowed external accounts and native collections; future connections are excluded until granted |
| Records | Supported selectors such as calendar IDs, task project IDs, or specific records; no implicit access to the whole account |
| Read operations and fields | Allowed operations and response fields, such as availability without event titles, descriptions, or attendees |
| Writes | Allowed actions, destination collections, and mutable fields; source and destination must both be authorized when moving/copying records |
| Results and sharing | Who may receive each output and which output fields/types are permitted; sibling agents and the root are separate recipients |
| Execution limits | Runtime environment, assigned request/run scope, expiry, and standing versus approval-required actions |

Effective access is the intersection of the agent's current policy, its runtime key's scopes/restrictions, the connection's enabled permissions, the request/run limits, and applicable provider grants. An approval authorizes an operation inside that boundary; it cannot expand it. Missing grants deny access. Root dispatch permission is distinct from permission to read the dispatched task's inputs or outputs.

For example, a scheduling agent could read selected calendars and propose changes to one calendar, while a leisure agent searches catalogs and updates selected library fields. The root initially can read the underlying data and both agents' results. Later it could be restricted to selected outputs. These illustrate policies, not an enrolled specialist roster or approved specialist grants.

Use a small typed policy record and explicit checks in existing API/Tools operations. Shared middleware identifies the caller and operation; domain code enforces record selectors, field projections, and write constraints. Implement only the selectors and fixed response/write profiles needed by the first workflow, not an arbitrary field-policy editor for every connector. Unsupported restrictions fail closed rather than silently becoming account-wide access. Skills describe these rules but are not their enforcement mechanism. No separate policy service or general policy language is needed.

Apply constraints before querying where supported, and filter/project responses inside the trusted backend before any data reaches the agent. A provider credential may permit broader reads; that does not permit returning broader data. If the backend cannot safely enforce the requested boundary, that connector operation is unavailable under that policy. Restrict single-record lookup, lists, search, counts, exports, related records, errors, and receipts as well as normal reads; an alternate endpoint or guessed ID must not reveal excluded data.

Query predicates, sorting, counts, pagination, and autocomplete must not act as an oracle over forbidden fields: hiding the body while allowing arbitrary body searches still reveals its contents. Restrict queryable fields as well as returned fields; deny a query the adapter cannot constrain. Evaluate mutable selectors against current authoritative membership, not an old import label. Writes cannot change their own permission-defining membership or hidden fields as a side effect; such moves require explicit source/destination grants and current version checks. Sensitive decisions fail closed when required membership cannot be verified.

Cached/imported data, search indexes, saved results, and future agent memory retain source/ownership metadata and remain subject to current access checks. A cache hit or copy does not remove restrictions. Broad cached responses must never be served directly to a narrower caller. Request inputs and conversation history also obey recipient access: assigning work does not attach the root's entire context or a sibling's history.

Output access is checked for both publication and retrieval. Copying restricted data into a summary does not automatically make it shareable. Owner-authorized workflows must specify permitted recipients and output contracts; enforceable projections can expose selected fields without exposing the original record. A free-form model summary is not a reliable confidentiality filter. Where raw data must remain inaccessible to a recipient, use a constrained backend-generated projection or keep the entire generated output restricted.

Source restrictions come from trusted connector/domain metadata and the authorized workflow, never an agent-supplied source list or `public` label. Initially allow free-form generated results to Neel and the broadly authorized root; do not promise safe disclosure to narrower agents from a shared context. Narrower recipients can receive authorized source records or deterministic projections computed by trusted backend code. Later isolated workflows can conservatively restrict generated text to recipients allowed to see all available inputs. Mixed-source outputs inherit the intersection of recipient permissions; no automatic semantic declassification system is planned.

Policy reductions apply on the next API access/execution check, including retrieval of saved outputs and queued work. Recheck before releasing a long-running result or dispatching a write. Previously disclosed data cannot be recalled from a running agent's context. Ending affected runs and starting fresh contexts reduces carryover; enforceable isolation of credentials, files, histories, and memory remains a later phase.

## Runtime trust and data leaving the system

Initial scope is API authorization in the existing Codex setup, as [confirmed above](#confirmed-initial-scope). The isolation and outbound-data controls in this section describe the later stronger boundary. They are not implemented protections or prerequisites for the accepted initial runtime. API-level destination checks and secret-handling rules still apply to Life-OS operations.

The backend, credential custodian, host administrator, and runtime supervisor are trusted. Models, provider content, and agent-generated tool arguments are not authorization authorities. This design limits a compromised agent; it cannot protect data from a compromised backend/host administrator. The configured model service also receives whatever context is sent to it. Approve that service, its retention settings, and any transcript/telemetry storage for the profile's data before enabling personal-data runs.

A restricted agent must not retain alternate paths around Life-OS: direct provider tools/MCP connections, a logged-in owner browser, sibling chat messaging, unrestricted network/shell access, shared histories, host keychains, or mounted backend secrets. The runtime must enforce per-agent tool, filesystem, and network limits. Read-only code and private scratch storage can be provided without mounting the repository's environment files or host administration sockets. A CLI credential's installation is pinned to an approved API origin; an agent-supplied URL or environment override cannot redirect it. TLS and refusing redirects alone do not stop sending a key to an attacker-selected initial URL.

Data can leave through an allowed action too: a public catalog search query, task title, mail body, or URL can carry copied private data. Treat these as output destinations. A workflow that can see restricted inputs cannot make arbitrary-text calls to a destination forbidden to receive those inputs. Use separate contexts, constrained backend-built requests, or owner approval of the exact disclosure to an already permitted destination. A domain allowlist alone does not prevent this. Do not rely on the model to detect sensitive text.

The later restrictions also cover built-in runtime messaging and parent/child transcript inheritance. A shared unrestricted Codex session does not satisfy independent-agent isolation; Neel has chosen to retain it initially with that limitation. Use synthetic data to test stronger isolation before claiming it. Actual personal-account connections still require their separately scoped setup and consent, but deferred runtime isolation is not itself a blanket prohibition on the initial design's personal-data use.

## Owner bootstrap and login

Provision Neel's Clerk account through the administrative setup path and configure its exact Clerk user ID as the sole owner in server configuration. Restrict sign-up to the intended verified account. There is no public first-user-becomes-admin endpoint. Changing the owner ID is a host administrator recovery operation, not an agent API operation.

Neel selects Continue with Google. Clerk performs the login; the web uses its supported session mechanism. The same-origin bridge verifies and forwards the user session token to the API, retaining the existing Host/Origin and JSON protections. It must not replace the user token with an unrestricted shared server bearer or trust a user-ID header.

For protected requests, the API verifies the expected Clerk instance/issuer, token type, signature, expiry, configured authorized parties, and the exact enrolled owner subject. Use the SDK's token-specific checks rather than accepting arbitrary JWTs, ID tokens, or provider tokens. Check session activity through Clerk as well; this single-owner design favors clear revocation behavior over an additional authentication cache. Invalid, expired, or revoked sessions are rejected. Verification outages fail closed with a retryable service error rather than granting access.

Use a seven-day maximum owner session lifetime as the initial setting. No custom owner token or browser-localStorage credential scheme is introduced. Credentials must not enter URLs, logs, or application build artifacts. Production traffic uses HTTPS; development origins and credentials are separate and explicitly configured.

Privileged owner operations require recent verification, within ten minutes: issue/rotate an agent key, broaden permissions, connect an account, or approve an approval-gated action. Enroll an authenticator factor with recovery codes using Clerk's supported flow. Google remains the normal sign-in method; the authenticator supplies supported step-up verification. Google social login alone must not be assumed to support Clerk's reverification UI. Revoking or disabling access is allowed from an active owner session without an extra step-up delay.

Enforce recent second-factor verification in the backend from verified session claims, not just by opening a frontend modal. Reject missing/unverified factor state; do not accept an SDK downgrade to first-factor verification when the required factor is absent. Authenticator enrollment is part of owner bootstrap before enabling privileged operations. Factor removal/recovery must not silently bypass that gate. Recovery codes are the explicit owner recovery path.

## Browser and approval boundary

The bridge retains an explicit route/method allowlist and fixed API upstream. Browser mutations require the configured exact Origin/Host, same-origin fetch checks where supplied, and JSON content type; cookie-authenticated mutation endpoints must retain CSRF protection. Read-only GETs cannot mutate state. Callback endpoints use their separate protocol validation rather than a global CSRF exemption. Trust forwarded host/protocol headers only from the configured ingress. CORS is not authentication; direct API calls receive the same identity and policy checks, and owner routes reject agent tokens even if cookies are also supplied.

Render connector content and agent outputs as escaped text or restricted Markdown, with raw HTML disabled and safe link schemes. Do not automatically load remote images, embeds, or agent-provided executable UI. Apply a production CSP compatible with the chosen Clerk integration, disallow framing of owner approval screens, and avoid third-party analytics on sensitive screens. Authenticated responses use `Cache-Control: no-store`; clear in-memory user data on logout and do not persist it in a service worker or browser database by default.

The approval screen is trusted application UI built from the backend's immutable, validated action record. Show the executor, external account, affected records, recipients, exact payload/change, side effects, and expiry. Agent prose can explain a proposal but cannot replace that display. The submitted approval references that exact record/version; reject later parameter substitution or a changed target. Approval and credential provisioning endpoints must be protected against cross-origin requests and clickjacking as well as ordinary authentication failures.

## Enrolling an agent

The owner opens Settings → Agent access. This is a small application screen, not a new identity system.

1. Select or create the stable agent identity (root or independent agent), configure its data-access policy, and name its runtime installation and environment. Select allowed connections, record selectors, operations, readable/mutable fields, and output recipients/contracts. For the root, also configure which workflow profiles and agent targets it may dispatch. No automatic access to every future connection, agent, or capability.
2. Choose which permitted operations have standing authorization and which require an approved request/action. Reads can receive standing authorization; writes start as approval-required and may be deliberately granted standing authorization where appropriate.
3. After owner verification, the backend creates the scoped key and registers its returned key ID against the agent identity and runtime installation. The key expires in 90 days or earlier if Neel chooses. Use a fixed application-purpose scope such as `life:executor` plus the granted operation scopes. The root gets coordination scopes only where configured, not an implicit wildcard.
4. Return the secret once through a no-store owner-only response. Show it only in the explicit provisioning UI. Do not persist its plaintext in the Life-OS database. A failed registration must leave the key unusable to Life-OS and trigger revocation; a lost one-time response requires a replacement key.
5. Install it in the execution environment, then verify a read-only authentication-status operation. That response shows the executor name, permissions, environment, and expiry, never the credential.

Only registered backend-issued keys are valid. A key created through an identity provider's generic account UI or API is rejected even if it has Neel's subject or similarly named scopes. The authoritative database binding is required in addition to provider verification.

Proposed CLI setup: `life auth install-agent` reads a key through hidden terminal input and saves it to the OS credential store. It is not a secret command-line argument, shell-history entry, skill instruction, or chat message. On a VPS, provision it through the selected host's protected runtime-secret facility. These commands and settings do not exist yet.

The CLI sends the key over authenticated HTTPS as a bearer credential and refuses redirects to other hosts, preserving the current client's transport restrictions. It does not fall back to the old shared API token. The agent can invoke the CLI without printing or interpreting the secret.

## What the API verifies

Use one authorization middleware and explicit operation registration. Do not infer authority from a command name, UI route, or actor label.

| Check | Owner session | Agent key |
|---|---|---|
| Identity service verification | Valid active session from the configured instance | Valid unexpired, unrevoked key from the configured instance |
| Local enrollment | Exact configured owner | Registered key ID and active executor belonging to that owner |
| Environment | Expected instance and deployment | Expected instance, deployment, and executor environment |
| Operation access | Owner operation policy | Intersection of key scopes and current executor grants |
| Resource access | Owner's resources/connections | Current agent policy for connections, records, fields, write destinations, and output recipients, narrowed by runtime and run limits |
| Provider capability | Required for provider operation | Required for provider operation |
| Approval | Direct user action or applicable request approval | Standing grant or matching owner-approved request/action |

Agent keys never authorize owner enrollment, credential issuance, grant changes, approval issuance, connector administration, raw secret access, schema migration, or unrestricted database/export administration. These routes reject agent credentials before evaluating owner subject or arbitrary scope strings. A scope cannot turn an agent key into a human session.

Verify agent keys online for each API operation and read their current local grants without positive authorization caching. Return 401 for invalid credentials, 403 for a valid caller lacking permission, and a structured needs-approval result before provider dispatch when approval is missing. Return a sanitized 503 when the identity service cannot verify a request. Existing cached data can remain displayed, but verification failure does not authorize a new data request or write.

Authentication identifies possession of an executor's credential; it does not prove which language model produced a command or whether its reasoning is sound. An agent with unrestricted host access may also read credentials accessible to that OS user. Keeping secrets out of prompts is not process isolation. Backend database, identity-admin, and provider secrets remain server-side and are not returned to clients; the initial shared runtime does not claim to prevent reading any secrets already accessible to its OS user. The later isolated runtime must exclude backend secrets from agent access.

## Standing permissions and individual requests

Store a small operation policy per executor/connection: denied, allowed with standing authorization, or allowed with request/action approval. Key scopes are a ceiling; local policy and provider grants may only narrow them. The owner can reduce access immediately. Broadening key scopes requires issuing a replacement key; an agent cannot renew or upgrade itself.

For web workflows, the owner's authenticated submission records the request, permitted operations, selected connections/resources, and expiry. The agent receives its request ID. The API checks the persisted authorization; knowing an ID is not proof of authority. Agents may create proposals, but cannot mark them owner-approved. Result publication is restricted to their authorized request/run and does not carry authority to mutate unrelated records.

For approval-gated writes, bind approval to the agent, request/run, connection identity and generation, operation, normalized validated parameters including resolved defaults, relevant record version, and idempotency key. Parameters such as mail recipients/body, attachments, recurrence scope, and invitation notifications must be included where applicable. Approval expires after 15 minutes by default and covers one logical operation. A parent workflow approval is not blanket approval for unspecified writes. Current policy and approval are checked together when atomically claiming dispatch. Changed parameters require fresh approval.

Extend the existing domain receipts with a durable authorization/dispatch record; do not assume today's per-domain idempotency already implements this contract. Bind a logical action key to owner, agent, run, connection generation, operation, and payload hash. Reject key reuse with different inputs. Authorize receipt lookup before returning a stored response, and project it under current read permissions. After approval expiry, an authorized caller may inspect the existing outcome; expiry never permits a new dispatch. No retained key may silently become a new action after receipt cleanup.

Consume approval and record the dispatch claim atomically in PostgreSQL before the external call. Validate the current lease generation on each attempt. A crash between provider success and recording its receipt creates an unknown outcome; retain that state and reconcile via provider idempotency or a reliable provider lookup. If neither is available, require manual reconciliation instead of retrying, even with the same key or a replacement approval. Database transactions, leases, and local receipt keys cannot guarantee exactly-once external effects. This is additional implementation work and needs crash/failure tests per write operation.

Version policy, connection state, and cancellation state. Serialize the final local authorization check and dispatch claim against those state changes. Remote executors claim the stored action through the API just before execution; they cannot act on an old authorized payload after an arbitrary queue delay. A revocation after that final claim races with an in-flight external call and cannot guarantee its cancellation. Mark it in flight, prevent subsequent dispatches, and reconcile its result.

Give each standing workflow finite limits for assignments, operation count, concurrency, runtime, and result size. Child runs consume the parent's remaining budget and cannot reset it through recursive delegation or new idempotency keys. Enforce limits transactionally in existing records; do not add a separate quota service. When a limit is reached, pause for owner review. Bound API bodies, pages, and provider timeouts, and rate-limit verification/claim endpoints to avoid an agent loop exhausting the identity service or provider quota.

The API cannot cryptographically verify that an agent's statement about a chat message came from Neel. Direct conversational work therefore uses standing grants for routine permitted operations, or a concrete approval in the authenticated owner UI for approval-gated work. Skills still govern intent and workflow. A future trusted request handoff can carry authenticated approval; an agent-supplied `approved: true` cannot. Do not ask again when an existing valid grant or approval already covers the operation.

## Expiry, rotation, revocation, and recovery

- **Expiry:** 90 days maximum for each executor key, with visible warnings during the final seven days. Expiry denies further API operations. The owner explicitly renews/replaces the key; an agent cannot create a perpetual renewal chain.
- **Rotation:** issue a new key with the same or narrower grants, install it, and verify status. Retire the old key after verification. If overlap is necessary, set its local retirement deadline to at most 15 minutes; the API enforces that timestamp without needing a cleanup job.
- **Revocation:** disabling an executor or credential in Life-OS takes effect for subsequent authorization checks, then revoke the key at Clerk. Keep a failed provider-revocation attempt visible and retryable; local disablement remains effective. Revocation in Clerk is detected by per-operation verification. Already-dispatched external actions cannot be undone by revoking a key.
- **Queued work:** recheck grants, credential validity, request expiry, and connection status at execution time. Cancelled requests and disabled executors cannot begin new actions.
- **Sign-out:** ends the relevant owner session; it does not silently disable scheduled agent access. Provide a separate owner control to disable all executors.
- **Lost agent credential:** revoke it and issue a replacement after owner verification. Never retrieve the lost secret from application records.
- **Owner recovery:** use identity-provider recovery and offline recovery codes. If that fails, the host administrator can disable all executors and rebind the owner only after out-of-band identity recovery. There is no public recovery bypass or re-enrollment using the legacy shared token.

Persist agent ID/name/role/owner, its versioned data-access policy, runtime installation/environment and restrictions, credential ID/expiry/status, dispatch grants, and request/run/approval metadata including parent request, assigned agent, and result recipients. Retain source/ownership metadata on stored data and outputs for access checks. Audit policy/credential changes and action identity using IDs, timestamps, policy versions, and receipts. Do not log token values or sensitive request bodies as routine diagnostics. These are application records in existing PostgreSQL, not a new authorization service.

## Migration and acceptance

Keep today's loopback bearer behavior until the new path is explicitly enabled. At cutover, require the configured owner identity and registered executor keys, remove the bridge's shared bearer forwarding, stop client/server fallback to `.local/api/token` and `LIFE_API_TOKEN`, and rotate/revoke the legacy credential. Missing new configuration must fail startup or close protected routes, not fall back. Tests may use injected fake authentication with synthetic principals; no production bypass flag.

The implementation is acceptable only when these cases pass against disposable data and fake providers:

- Neel signs in; a different valid Google user cannot access any Life-OS data.
- A registered agent reads an allowed connection through the CLI and publishes an authorized result.
- An unregistered key for the same owner, forged actor/user headers, a cross-environment key, or a provider token is rejected.
- Agent access cannot issue credentials, change permissions, approve its own work, or invoke owner-only operations.
- Root delegation cannot widen an independent agent's grants; neither can impersonate the other by changing an agent ID or actor field. Sibling credentials, runs, and results are inaccessible unless explicitly authorized.
- A root-assigned workflow survives root disconnect when still authorized; cancelling its parent request prevents new child actions. Independent owner-assigned work remains independent.
- The root's explicit initial policy permits all application data/results, while writes and owner-only operations remain separately restricted. Narrowing that read policy later changes API access without changing the authentication model.
- Independent schedules/triggers create bounded runs without a root assignment; disabled bindings, revoked grants, duplicate events, and agent attempts to broaden trigger configuration are rejected.
- Agents with access to the same connector but different calendars/projects/fields receive only their permitted data. Guessed IDs, search/counts, related records, caches, exports, and errors cannot bypass those limits; unsupported selectors deny access.
- Restricted fields cannot be written or copied into unauthorized destinations. Request context, stored results, and memory cannot be shared with the root or a sibling merely because it assigned the work.
- Reducing a policy blocks subsequent access to previously stored results and queued actions; a result completing after reduction is checked again before delivery.
- Revocation, expiry, changed grants, cancelled requests, and identity-service failure prevent subsequent dispatch.
- A standing grant avoids unnecessary approval prompts; changed approval-bound parameters and duplicate concurrent writes do not bypass checks.
- The old shared bearer, missing configuration, and an invalid direct API request cannot bypass the new boundary.
- Restart preserves grants and credential references without placing secrets in logs, normal CLI output, source files, or browser bundles.
- A missing/swapped run, stale lease generation, or claim after completion cannot escape the active runtime binding; a crash after provider success does not trigger a blind retry.
- Searching or sorting on a forbidden field cannot reveal it; changing a record's permission-defining membership cannot widen access.
- Provider text cannot execute HTML, load a tracking image, replace the trusted approval payload, or bypass CSRF/second-factor checks. Missing factors cannot downgrade privileged verification.
- Life-OS operations enforce configured destinations and output permissions. Alternate runtime tools and shared contexts remain outside the initial guarantee; their isolation tests belong to the later phase.
- A forged/replayed connector callback or webhook cannot attach a different account, broaden grants, revive a disabled connection, or execute an action. Reconnection invalidates pending actions tied to the old connection generation.
- Reusing an action key with different parameters is rejected; receipt replay rechecks read permissions. Expired approval, late revocation, worker failure, and provider uncertainty have distinct recorded outcomes.
- Recursive dispatch, oversized results, and repeated calls cannot bypass workflow budgets or resource limits.

The authentication contract is specified here, with the adversarial findings and accepted initial limitations recorded in [the review](SECURITY-REVIEW.md). Deployment still needs the host's secure storage and request/scheduled dispatch bindings. Strong runtime isolation and trusted context reset are deferred hardening, not initial release gates. No services have been provisioned and no authentication code has changed.

## Implementation references

Clerk is the concrete implementation baseline for this design, subject to the implementation-time compatibility and cost check. Replacing it requires preserving these behaviors and revising this document before implementation.

- [User API keys](https://clerk.com/docs/guides/development/machine-auth/api-keys): provider-managed issuance, subject binding, scopes, explicit expiry, verification, and revocation. Life-OS adds executor registration and operation enforcement.
- [Request verification](https://clerk.com/docs/reference/backend/authenticate-request): distinguish token types and configure expected authorized parties.
- [Google sign-in](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google).
- [Reverification](https://clerk.com/docs/guides/secure/reverification): use supported verification factors; ordinary OAuth login is not itself a supported reverification factor.
