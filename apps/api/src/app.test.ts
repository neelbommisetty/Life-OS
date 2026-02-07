import { describe, expect, test } from "bun:test";
import { app } from "./app.js";
import { requestJson, withEnv } from "./test/harness.js";

describe("api app integration", () => {
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
});
