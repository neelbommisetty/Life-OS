# Security Best Practices Report

## Executive Summary

This review found one **Critical**, four **High**, five **Medium**, and three **Small** issues. The highest-risk gaps are an untrusted redirect flow in auth, missing ownership enforcement for cross-resource links (`projectId`), weak default JWT claim validation, and sensitive request metadata logging. There are also architectural hardening gaps (CSRF, headers/CSP, rate limiting) and dependency upgrade needs.

---

## Critical Findings

### SEC-001: Unvalidated `callbackURL` can trigger open redirect / script URL navigation
- Severity: Critical
- Location: `apps/web/src/app/auth/[path]/auth-client.tsx:33`, `apps/web/src/app/auth/[path]/auth-client.tsx:73`, `apps/web/src/app/auth/[path]/auth-client.tsx:114`
- Evidence:
  - `const callbackURL = useMemo(() => searchParams.get("callbackURL") ?? "/", ...)`
  - `router.replace(callbackURL)` after sign-in/sign-up
- Impact: Attackers can craft auth links that bounce users to attacker-controlled destinations after login; depending on navigation handling, script-scheme payloads may also execute in browser context.
- Fix:
  - Normalize `callbackURL` through a strict allowlist: only same-origin relative paths beginning with `/`.
  - Reject `//`, `http:`, `https:`, `javascript:`, and encoded variants.
  - Fallback to `/` when invalid.
- Mitigation: Add server-side redirect validation as final enforcement if the auth upstream also supports `callbackURL`.
- False positive notes: If the auth layer already strips unsafe callback URLs server-side, this reduces but does not remove the client-side redirect risk.

---

## High Findings

### SEC-002: Cross-tenant project linkage is not ownership-validated on create flows
- Severity: High
- Location:
  - `apps/api/src/modules/tasks/service.ts:122`
  - `apps/api/src/modules/notes/service.ts:119`
  - `apps/api/src/modules/chat/service.ts:128`
  - `packages/db/prisma/schema.prisma:171`, `packages/db/prisma/schema.prisma:188`, `packages/db/prisma/schema.prisma:75`
- Evidence:
  - Create paths accept and persist `projectId` directly, but do not verify referenced project belongs to `userId`.
  - Schema foreign keys bind only `projectId -> Project.id` (no composite ownership constraint).
- Impact: If a project ID is learned, a user can attach their records to another user’s project (integrity breach) and may leak linked project metadata through `include: { project: true }` reads.
- Fix:
  - Validate `projectId` ownership before create/update (`project.id + userId` lookup).
  - Add DB-level defense where feasible (e.g., ownership-safe relation strategy or RLS).
- Mitigation: Use opaque IDs plus strict access logging/alerting for cross-user project references.
- False positive notes: Exploitability depends on attacker obtaining another user’s project ID, but authorization logic is still incomplete.

### SEC-003: JWT bearer validation does not enforce issuer/audience by default
- Severity: High
- Location:
  - `apps/api/src/modules/common/auth.ts:39`
  - `apps/api/src/modules/common/auth.ts:44`
  - `apps/api/src/modules/common/auth.ts:192`
  - `.env.example:17`
- Evidence:
  - `issuer`/`audience` are optional; `jwtVerify` is called with possibly undefined claim checks.
- Impact: Accepting signature-valid tokens without strict claim scoping can enable token confusion across environments/clients that share signing infrastructure.
- Fix:
  - Require `NEON_AUTH_JWT_ISSUER` and `NEON_AUTH_JWT_AUDIENCE` in production startup checks.
  - Fail closed when missing.
- Mitigation: Restrict API ingress to trusted internal callers until strict claim enforcement is enabled.
- False positive notes: If Neon guarantees tenant-isolated keys and claims externally, risk is reduced but still not defense-in-depth.

### SEC-004: Sensitive query parameters and redirect metadata are logged
- Severity: High
- Location:
  - `apps/api/src/app.ts:76`
  - `apps/web/src/app/api/auth/[...path]/route.ts:42`
  - `apps/web/src/app/api/auth/[...path]/route.ts:61`
  - `apps/web/src/app/api/chat/stream/route.ts:31`
  - `apps/web/src/app/api/chat/stream/route.ts:53`
- Evidence:
  - Query strings and upstream redirect locations are logged in info logs.
- Impact: Password reset tokens, auth callback artifacts, and other sensitive URL data can be exposed to logs and downstream log processors.
- Fix:
  - Stop logging raw query strings and `location` headers.
  - Add a centralized redaction policy (token/key/password patterns).
- Mitigation: Restrict log retention/access and purge sensitive historic logs.
- False positive notes: If upstream never puts secrets in query params, direct risk drops; still a common leakage vector.

### SEC-005: No request throttling/abuse controls on expensive authenticated endpoints
- Severity: High
- Location:
  - `apps/api/src/app.ts:67`
  - `apps/api/src/modules/chat/route.ts:273`
  - `apps/api/src/modules/analytics/route.ts:75`
- Evidence:
  - Middleware stack includes logging and auth only; no rate limiting or quota middleware.
  - AI stream endpoint can drive direct model spend.
- Impact: Account abuse or credential theft can trigger unbounded AI cost and service degradation.
- Fix:
  - Add per-user and per-IP rate limits with burst + sustained windows.
  - Add per-route cost guards (especially chat streaming) and concurrency caps.
- Mitigation: Budget alarms and kill-switches for provider usage.
- False positive notes: External WAF/rate limiting may exist, but none is visible in app code.

---

## Medium Findings

### SEC-006: No explicit CSRF protection on cookie-authenticated state-changing endpoints
- Severity: Medium
- Location:
  - `apps/api/src/app.ts:115`
  - Representative state-changing routes: `apps/api/src/modules/tasks/route.ts:123`, `apps/api/src/modules/projects/route.ts:151`, `apps/api/src/modules/notes/route.ts:122`
- Evidence:
  - No CSRF token validation, origin/referer checks, or same-origin enforcement in API middleware.
- Impact: If cookie policy is permissive or changed, cross-site request forgery can mutate user data.
- Fix:
  - Add origin checks for browser-originated mutating requests.
  - Add CSRF token (double-submit or synchronizer token) for cookie-auth flows.
- Mitigation: Enforce strict SameSite/HttpOnly/Secure cookie policy at auth provider and document it.
- False positive notes: If auth cookies are always `SameSite=Strict` in production, practical risk is lower.

### SEC-007: GET endpoints perform state-changing operations
- Severity: Medium
- Location:
  - `apps/api/src/modules/chat/service.ts:85`
  - `apps/api/src/modules/tasks/service.ts:96`
  - `apps/api/src/modules/tasks/service.ts:197`
- Evidence:
  - `listThreads` auto-creates a thread when none exists.
  - `listTasks` / `listArchivedTasks` invoke `autoArchiveDoneTasks` (write operation).
- Impact: GET side effects weaken CSRF posture and can produce unintended writes via prefetch/navigation behavior.
- Fix:
  - Move writes to explicit POST/PATCH maintenance endpoints or background jobs.
  - Keep GET handlers read-only.
- Mitigation: Disable automatic prefetch on these routes until semantics are corrected.
- False positive notes: Side effects are intentional product behavior, but this is still a security anti-pattern.

### SEC-008: Internal error details are returned directly to clients
- Severity: Medium
- Location:
  - `apps/api/src/modules/common/errors.ts:98`
  - `apps/api/src/routes/auth.ts:149`
  - `apps/web/src/app/api/auth/[...path]/route.ts:85`
- Evidence:
  - Unhandled errors return `error.message` in API JSON responses.
- Impact: Internal implementation details, upstream hostnames, and operational errors can leak to attackers.
- Fix:
  - Return stable generic messages for 5xx classes.
  - Log detailed diagnostics server-side only with redaction.
- Mitigation: Gate detailed errors behind explicit internal debug flags not exposed publicly.
- False positive notes: Some leaked messages may seem harmless, but cumulative detail aids recon.

### SEC-009: Security headers/CSP baseline is missing at web app level
- Severity: Medium
- Location: `apps/web/next.config.ts:3`
- Evidence:
  - No `headers()` policy for CSP, frame-ancestors/X-Frame-Options, nosniff, referrer policy, etc.
- Impact: Reduced browser-enforced protection against XSS/clickjacking/content-type confusion.
- Fix:
  - Add strict baseline headers in Next config (or equivalent edge config), with CSP tuned for current scripts/styles.
- Mitigation: Apply headers at CDN/WAF edge if app-level rollout needs staging.
- False positive notes: Headers may be set in external infra; this is not visible in repo.

### SEC-010: Outdated `hono` version with multiple published advisories
- Severity: Medium
- Location:
  - `apps/api/package.json:13`
  - `bun.lock:1183`
- Evidence:
  - `hono` pinned to `^4.6.0`; lock resolves `4.11.4`.
  - `bun audit` reports advisories affecting `<4.11.7`.
- Impact: Known framework vulnerabilities increase exploit surface and patch lag risk.
- Fix:
  - Upgrade `hono` to `>=4.11.7` and rerun API tests.
- Mitigation: Restrict exposed middleware/features affected by advisories until upgraded.
- False positive notes: Not all advisories may be reachable by current code paths, but version is in vulnerable range.

---

## Small Findings

### SEC-011: Public status endpoints disclose service/provider readiness internals
- Severity: Small
- Location: `apps/api/src/routes/status.ts:42`, `apps/api/src/routes/status.ts:49`
- Evidence:
  - `/status` and `/api/status` include DB and AI provider readiness details.
- Impact: Assists reconnaissance about deployed stack and provider posture.
- Fix:
  - Return minimal health (`ok`/`not_ready`) publicly; move detailed diagnostics behind authenticated/internal endpoint.
- Mitigation: Restrict status endpoints at edge/network layer.
- False positive notes: Some deployments intentionally expose health details; still better to minimize data.

### SEC-012: `shadcn` CLI is in production dependencies and pulls vulnerable transitive packages
- Severity: Small
- Location:
  - `apps/web/package.json:42`
  - `bun.lock:1807`
- Evidence:
  - `shadcn` is in `dependencies` instead of `devDependencies`; lock pulls large CLI-only graph including vulnerable transitive packages (`bun audit` output).
- Impact: Unnecessary production attack surface and supply-chain maintenance burden.
- Fix:
  - Move `shadcn` to `devDependencies` and regenerate lockfile.
- Mitigation: Keep build/runtime environments separate with production-only installs.
- False positive notes: If deployment already prunes dev/unused packages aggressively, runtime impact is lower.

### SEC-013: User-supplied request IDs are accepted and echoed without format constraints
- Severity: Small
- Location: `apps/api/src/app.ts:24`, `apps/api/src/app.ts:94`
- Evidence:
  - `x-request-id` from client is reused directly in logs and responses.
- Impact: Log forging/noise and trace correlation abuse in observability pipelines.
- Fix:
  - Validate request-id format/length (UUID or safe charset), otherwise regenerate server-side.
- Mitigation: Escape/sanitize structured log sinks.
- False positive notes: Risk depends on how logs are consumed downstream.

---

## Recommended Remediation Order

1. Fix SEC-001 (callbackURL validation).
2. Fix SEC-002 and SEC-003 (authorization and JWT claim hardening).
3. Fix SEC-004 and SEC-005 (logging redaction + rate limiting).
4. Address SEC-006 to SEC-010 for systemic hardening.
5. Tidy SEC-011 to SEC-013 during follow-up security hygiene pass.
