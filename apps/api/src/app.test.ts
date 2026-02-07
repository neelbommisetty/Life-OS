import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("apps/api", () => {
  test("/health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("/api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("/ready returns 503 without DATABASE_URL", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const res = await app.request("/ready");
      expect(res.status).toBe(503);
    } finally {
      if (original) process.env.DATABASE_URL = original;
    }
  });

  test("/api/auth proxies request to Neon Auth base URL", async () => {
    const originalAuthBaseUrl = process.env.NEON_AUTH_BASE_URL;
    const originalFetch = globalThis.fetch;
    let proxiedUrl = "";
    let proxiedMethod = "";

    process.env.NEON_AUTH_BASE_URL = "https://auth.example.com/neondb/auth";
    globalThis.fetch = (async (input, init) => {
      proxiedUrl = String(input);
      proxiedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const res = await app.request("/api/auth/get-session?force=true");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(proxiedMethod).toBe("GET");
      expect(proxiedUrl).toBe("https://auth.example.com/neondb/auth/get-session?force=true");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalAuthBaseUrl) {
        process.env.NEON_AUTH_BASE_URL = originalAuthBaseUrl;
      } else {
        delete process.env.NEON_AUTH_BASE_URL;
      }
    }
  });

  test("/api/auth returns 500 when NEON_AUTH_BASE_URL is missing", async () => {
    const originalAuthBaseUrl = process.env.NEON_AUTH_BASE_URL;
    delete process.env.NEON_AUTH_BASE_URL;

    try {
      const res = await app.request("/api/auth/get-session");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "auth_proxy_error",
        message: "NEON_AUTH_BASE_URL is required to proxy auth requests",
      });
    } finally {
      if (originalAuthBaseUrl) {
        process.env.NEON_AUTH_BASE_URL = originalAuthBaseUrl;
      }
    }
  });
});
