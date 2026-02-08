import { describe, expect, test } from "bun:test";
import { createAuthRoute } from "./auth.js";
import { createTestApp, requestJson } from "../test/harness.js";

describe("authRoute", () => {
  test("proxies GET requests to the Neon Auth base URL", async () => {
    let proxiedUrl = "";
    let proxiedMethod = "";
    let proxiedHeaders: Headers | undefined;
    let proxiedBody: BodyInit | null | undefined;

    const app = createTestApp(
      createAuthRoute({
        getAuthBaseUrl: () => "https://auth.example.com/neondb/auth",
        fetchFn: async (input, init) => {
          proxiedUrl = String(input);
          proxiedMethod = init?.method ?? "GET";
          proxiedHeaders = new Headers(init?.headers);
          proxiedBody = init?.body;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    );

    const { response, body } = await requestJson(
      app,
      "/api/auth/get-session?force=true",
      {
        headers: {
          host: "localhost:3001",
          "x-test-header": "test-value",
          "x-forwarded-host": "localhost:3000",
          "x-forwarded-proto": "https",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(proxiedMethod).toBe("GET");
    expect(proxiedUrl).toBe(
      "https://auth.example.com/neondb/auth/get-session?force=true",
    );
    expect(proxiedHeaders?.get("x-test-header")).toBe("test-value");
    expect(proxiedHeaders?.has("host")).toBe(false);
    expect(proxiedHeaders?.has("x-forwarded-host")).toBe(false);
    expect(proxiedHeaders?.has("x-forwarded-proto")).toBe(false);
    expect(proxiedBody).toBeUndefined();
  });

  test("proxies POST requests and forwards upstream status/headers", async () => {
    let proxiedMethod = "";
    let proxiedBody: BodyInit | null | undefined;

    const app = createTestApp(
      createAuthRoute({
        getAuthBaseUrl: () => "https://auth.example.com/neondb/auth/",
        fetchFn: async (_, init) => {
          proxiedMethod = init?.method ?? "GET";
          proxiedBody = init?.body;
          return new Response("denied", {
            status: 401,
            headers: { "x-upstream-status": "auth-denied" },
          });
        },
      }),
    );

    const response = await app.request("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("x-upstream-status")).toBe("auth-denied");
    expect(await response.text()).toBe("denied");
    expect(proxiedMethod).toBe("POST");
    expect(proxiedBody).toBeDefined();
  });

  test("drops empty text/plain body headers for sign-out proxy requests", async () => {
    let proxiedHeaders: Headers | undefined;
    let proxiedBody: BodyInit | null | undefined;

    const app = createTestApp(
      createAuthRoute({
        getAuthBaseUrl: () => "https://auth.example.com/neondb/auth",
        fetchFn: async (_, init) => {
          proxiedHeaders = new Headers(init?.headers);
          proxiedBody = init?.body;
          return new Response(null, { status: 204 });
        },
      }),
    );

    const response = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
      },
      body: "",
    });

    expect(response.status).toBe(204);
    expect(proxiedHeaders?.has("content-type")).toBe(false);
    expect(proxiedHeaders?.has("content-length")).toBe(false);
    expect(proxiedBody).toBeUndefined();
  });

  test("returns 500 when base URL is missing", async () => {
    const app = createTestApp(
      createAuthRoute({
        getAuthBaseUrl: () => {
          throw new Error("missing base url");
        },
      }),
    );

    const { response, body } = await requestJson(app, "/api/auth/get-session");
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "auth_proxy_error",
      message: "missing base url",
    });
  });

  test("rewrites upstream auth redirects to proxy-relative location", async () => {
    const app = createTestApp(
      createAuthRoute({
        getAuthBaseUrl: () => "https://auth.example.com/neondb/auth",
        fetchFn: async () =>
          new Response(null, {
            status: 307,
            headers: {
              location:
                "https://auth.example.com/neondb/auth/sign-in?callbackURL=%2Fchat",
            },
          }),
      }),
    );

    const response = await app.request("/api/auth/sign-out", {
      method: "POST",
      redirect: "manual",
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/api/auth/sign-in?callbackURL=%2Fchat",
    );
  });
});
