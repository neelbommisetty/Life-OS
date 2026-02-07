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
