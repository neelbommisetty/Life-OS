import { describe, expect, test } from "bun:test";
import { requestJson, withEnv } from "./test/harness.js";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://life_os_test:life_os_test@localhost:5432/life_os_test";
}

const { app } = await import("./app.js");

describe("api app integration", () => {
  test("adds x-request-id header when request id is missing", async () => {
    const response = await app.request("/");
    const requestId = response.headers.get("x-request-id");

    expect(response.status).toBe(200);
    expect(requestId).toBeString();
    expect(requestId).not.toBe("");
  });

  test("preserves x-request-id header on error responses", async () => {
    const requestId = "req_test_custom_id_001";
    const response = await withEnv({ NEON_AUTH_BASE_URL: undefined }, () =>
      app.request("/api/auth/get-session", {
        headers: {
          "x-request-id": requestId,
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  test("mounts root route", async () => {
    const response = await app.request("/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: "Life-OS API is awake and mildly over-caffeinated.",
    });
  });

  test("mounts status route", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const { response, body } = await requestJson(app, "/status");
      expect(response.status).toBe(503);
      expect(body.status).toBe("not_ready");
      expect(body.db).toBe("not_configured");
      expect(typeof body.ai.status).toBe("string");
      expect(typeof body.ai.initialized).toBe("boolean");
      expect(typeof body.ai.providers.openai).toBe("string");
      expect(typeof body.ai.providers.anthropic).toBe("string");
      expect(typeof body.ai.providers.gemini).toBe("string");
      expect(typeof body.ai.providers.xai).toBe("string");
    });
  });

  test("mounts /api/status route", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const { response, body } = await requestJson(app, "/api/status");
      expect(response.status).toBe(503);
      expect(body.status).toBe("not_ready");
      expect(body.db).toBe("not_configured");
      expect(typeof body.ai.status).toBe("string");
      expect(typeof body.ai.initialized).toBe("boolean");
      expect(typeof body.ai.providers.openai).toBe("string");
      expect(typeof body.ai.providers.anthropic).toBe("string");
      expect(typeof body.ai.providers.gemini).toBe("string");
      expect(typeof body.ai.providers.xai).toBe("string");
    });
  });

  test("mounts auth route", async () => {
    await withEnv({ NEON_AUTH_BASE_URL: undefined }, async () => {
      const { response, body } = await requestJson(app, "/api/auth/get-session");
      expect(response.status).toBe(500);
      expect(body).toEqual({
        error: "auth_proxy_error",
        message: "NEON_AUTH_BASE_URL is required to proxy auth requests",
      });
    });
  });

  test("protects business routes when auth is missing", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      await withEnv(
        { NEON_AUTH_BASE_URL: "https://auth.example.com/neondb/auth" },
        async () => {
          const { response, body } = await requestJson(app, "/api/chat/models");

          expect(response.status).toBe(401);
          expect(body).toEqual({
            error: "unauthorized",
            message: "Unauthorized",
          });
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns populated chat model list for authenticated requests", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (requestUrl.endsWith("/get-session")) {
        return new Response(
          JSON.stringify({
            data: {
              session: {
                user: { id: "user_123" },
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await withEnv(
        { NEON_AUTH_BASE_URL: "https://auth.example.com/neondb/auth" },
        async () => {
          const { response, body } = await requestJson(app, "/api/chat/models");

          expect(response.status).toBe(200);
          expect(Array.isArray(body)).toBe(true);
          expect(body.length).toBeGreaterThan(0);

          const first = body[0] as Record<string, unknown>;
          expect(typeof first.key).toBe("string");
          expect(typeof first.label).toBe("string");
          expect(typeof first.provider).toBe("string");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
