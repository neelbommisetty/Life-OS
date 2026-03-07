# Neon Auth API + Web Token Forwarding Design

Date: 2026-02-03
Owner: Life-OS

## Summary

Add Neon Auth JWT verification to `apps/api` and forward a server-only JWT from `apps/web` to the API. The API becomes the single enforcement point for authorization for the web product.

## Goals

- Verify Neon Auth JWTs in `apps/api` for all routes except `/health` and `/ready`.
- Forward a server-side JWT from `apps/web` to the API using `Authorization: Bearer <token>`.
- Keep tokens off the client; no browser JS access.
- Keep the web app and API on the same auth contract.

## Non-Goals

- Client-side token usage in the web UI.
- Alternate session introspection calls for every request.

## Auth Design

### API (apps/api)

- Add Hono middleware that:
  - Reads `Authorization: Bearer <jwt>`.
  - Verifies the JWT using Neon Auth JWKS (`${NEON_AUTH_BASE_URL}/jwt`) via `jose`.
  - Attaches `auth` context to the request (`userId`, optional org/role claims).
  - Returns `401` on missing/invalid/expired tokens.
- Apply the middleware to all routes except `/health` and `/ready`.
- Optional strict checks:
  - `NEON_AUTH_JWT_ISSUER`
  - `NEON_AUTH_JWT_AUDIENCE`

### Web (apps/web)

- Add a server-only helper to fetch a JWT using Neon Auth server client.
- Server actions use a shared `apiFetch()` that:
  - Obtains JWT from the session.
  - Calls API with `Authorization: Bearer <token>`.
- Fail fast with `Unauthorized` if no session token exists.

## Data Flow

1. Web server action reads Neon Auth session cookies.
2. Web server calls Neon Auth `token` endpoint to fetch a JWT.
3. Web server calls API with Bearer token.
4. API verifies JWT and proceeds using `auth.userId`.

## Error Shape

- `{ code: "UNAUTHORIZED" | "INVALID_TOKEN", message }` with `401` status.

## Environment Variables

- `NEON_AUTH_BASE_URL` (required in API and web).
- `NEON_AUTH_JWT_ISSUER` (optional, API only).
- `NEON_AUTH_JWT_AUDIENCE` (optional, API only).
- `NEXT_PUBLIC_API_BASE_URL` (web only).

## Testing

- API middleware tests (Bun):
  - Missing auth header -> `401`.
  - Invalid token -> `401`.
  - Valid token -> request passes and `auth.userId` is set.

## Rollout

- Ship API middleware and web forwarding helpers.
- Migrate server actions to use `apiFetch()`.

## Open Questions

- Which JWT claims should be considered authoritative for org/role.
