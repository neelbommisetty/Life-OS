import { describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { resolveUserIdFromRequest } from "./auth.js";
import { ApiError } from "./errors.js";
import { withEnv } from "../../test/harness.js";

const AUTH_BASE_URL = "https://auth.example.com/neondb/auth";

describe("resolveUserIdFromRequest", () => {
  test("resolves user id from a valid bearer token", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    const token = await new SignJWT({ sub: "user_from_jwt" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer("https://issuer.example.com")
      .setAudience("life-os-api")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);

    let fetchedJwks = false;
    const userId = await resolveUserIdFromRequest(
      new Request("https://api.example.com/api/projects", {
        headers: {
          authorization: `Bearer ${token}`,
        },
      }),
      {
        getAuthBaseUrl: () => AUTH_BASE_URL,
        getJwtIssuer: () => "https://issuer.example.com",
        getJwtAudience: () => "life-os-api",
        fetchFn: async (input) => {
          if (String(input) === `${AUTH_BASE_URL}/jwt`) {
            fetchedJwks = true;
            return new Response(JSON.stringify({ keys: [publicJwk] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }

          return new Response("not found", { status: 404 });
        },
      },
    );

    expect(userId).toBe("user_from_jwt");
    expect(fetchedJwks).toBe(true);
  });

  test("throws unauthorized for invalid bearer token", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "test-key";
    const token = await new SignJWT({ sub: "user_from_jwt" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);

    const invalidToken = `${token}corrupted`;

    await expect(
      resolveUserIdFromRequest(
        new Request("https://api.example.com/api/projects", {
          headers: {
            authorization: `Bearer ${invalidToken}`,
          },
        }),
        {
          getAuthBaseUrl: () => AUTH_BASE_URL,
          fetchFn: async () =>
            new Response(JSON.stringify({ keys: [publicJwk] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    } satisfies Partial<ApiError>);
  });

  test("falls back to session resolution when bearer token is absent", async () => {
    let sessionRequestHeaders: Headers | null = null;

    const userId = await resolveUserIdFromRequest(
      new Request("https://api.example.com/api/projects", {
        headers: {
          cookie: "neon-auth.session_token=abc123",
          host: "api.example.com",
        },
      }),
      {
        getAuthBaseUrl: () => AUTH_BASE_URL,
        fetchFn: async (input, init) => {
          expect(String(input)).toBe(`${AUTH_BASE_URL}/get-session`);
          sessionRequestHeaders = new Headers(init?.headers);
          return new Response(
            JSON.stringify({
              data: {
                session: {
                  user: { id: "user_from_session" },
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(userId).toBe("user_from_session");
    expect(sessionRequestHeaders?.get("cookie")).toBe(
      "neon-auth.session_token=abc123",
    );
    expect(sessionRequestHeaders?.has("host")).toBe(false);
  });

  test("strips body-specific headers when resolving session for non-GET requests", async () => {
    let sessionRequestHeaders: Headers | null = null;

    const userId = await resolveUserIdFromRequest(
      new Request("https://api.example.com/api/tasks", {
        method: "POST",
        headers: {
          cookie: "neon-auth.session_token=abc123",
          host: "api.example.com",
          "content-type": "application/json",
          "content-length": "17",
          forwarded: "for=10.0.0.1;proto=https;host=localhost:3000",
          "x-forwarded-for": "10.0.0.1",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "https",
          "x-forwarded-port": "443",
        },
        body: JSON.stringify({ title: "Task" }),
      }),
      {
        getAuthBaseUrl: () => AUTH_BASE_URL,
        fetchFn: async (_, init) => {
          sessionRequestHeaders = new Headers(init?.headers);
          return new Response(
            JSON.stringify({
              data: {
                session: {
                  user: { id: "user_from_session" },
                },
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    );

    expect(userId).toBe("user_from_session");
    expect(sessionRequestHeaders?.get("cookie")).toBe(
      "neon-auth.session_token=abc123",
    );
    expect(sessionRequestHeaders?.has("host")).toBe(false);
    expect(sessionRequestHeaders?.has("content-type")).toBe(false);
    expect(sessionRequestHeaders?.has("content-length")).toBe(false);
    expect(sessionRequestHeaders?.has("forwarded")).toBe(false);
    expect(sessionRequestHeaders?.has("x-forwarded-for")).toBe(false);
    expect(sessionRequestHeaders?.has("x-forwarded-host")).toBe(false);
    expect(sessionRequestHeaders?.has("x-forwarded-proto")).toBe(false);
    expect(sessionRequestHeaders?.has("x-forwarded-port")).toBe(false);
  });

  test("fails fast when auth session lookup times out", async () => {
    await expect(
      resolveUserIdFromRequest(
        new Request("https://api.example.com/api/tasks", {
          method: "POST",
          headers: {
            cookie: "neon-auth.session_token=abc123",
          },
        }),
        {
          getAuthBaseUrl: () => AUTH_BASE_URL,
          sessionTimeoutMs: 10,
          fetchFn: async (_, init) =>
            await new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const abortError = new Error("Aborted");
                abortError.name = "AbortError";
                reject(abortError);
              });
            }),
        },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: "auth_resolution_error",
    } satisfies Partial<ApiError>);
  });

  test("fails fast for self-referential auth proxy base URL", async () => {
    let fetchCalled = false;

    await expect(
      resolveUserIdFromRequest(
        new Request("https://api.example.com/api/tasks", {
          method: "POST",
          headers: {
            cookie: "neon-auth.session_token=abc123",
          },
        }),
        {
          getAuthBaseUrl: () => "https://api.example.com/api/auth",
          fetchFn: async () => {
            fetchCalled = true;
            return new Response("ok", { status: 200 });
          },
        },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: "auth_configuration_error",
    } satisfies Partial<ApiError>);

    expect(fetchCalled).toBe(false);
  });

  test("fails fast for cross-origin /api/auth proxy base URL", async () => {
    let fetchCalled = false;

    await expect(
      resolveUserIdFromRequest(
        new Request("https://api.example.com/api/tasks", {
          method: "POST",
          headers: {
            cookie: "neon-auth.session_token=abc123",
          },
        }),
        {
          getAuthBaseUrl: () => "https://web.example.com/api/auth",
          fetchFn: async () => {
            fetchCalled = true;
            return new Response("ok", { status: 200 });
          },
        },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: "auth_configuration_error",
      message:
        "NEON_AUTH_BASE_URL cannot point to a /api/auth proxy endpoint; set it to the Neon Auth upstream URL",
    } satisfies Partial<ApiError>);

    expect(fetchCalled).toBe(false);
  });

  test("includes upstream status when session lookup fails", async () => {
    await expect(
      resolveUserIdFromRequest(
        new Request("https://api.example.com/api/tasks", {
          method: "POST",
          headers: {
            cookie: "neon-auth.session_token=abc123",
          },
        }),
        {
          getAuthBaseUrl: () => AUTH_BASE_URL,
          fetchFn: async () =>
            new Response(JSON.stringify({ error: "bad_gateway" }), {
              status: 502,
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    ).rejects.toMatchObject({
      status: 500,
      code: "auth_resolution_error",
      message: "Failed to resolve auth session (upstream status 502)",
    } satisfies Partial<ApiError>);
  });

  test("caches user resolution per request with default dependencies", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          data: {
            session: {
              user: { id: "cached_user" },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    try {
      await withEnv({ NEON_AUTH_BASE_URL: AUTH_BASE_URL }, async () => {
        const request = new Request("https://api.example.com/api/projects", {
          headers: {
            cookie: "neon-auth.session_token=abc123",
          },
        });

        const [first, second] = await Promise.all([
          resolveUserIdFromRequest(request),
          resolveUserIdFromRequest(request),
        ]);

        expect(first).toBe("cached_user");
        expect(second).toBe("cached_user");
        expect(fetchCount).toBe(1);
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
