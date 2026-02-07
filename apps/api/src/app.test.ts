import { describe, expect, test } from "bun:test";
import { app } from "./app";
import { requestJson, withEnv } from "./test/harness";

describe("api app integration", () => {
  test("mounts health route", async () => {
    const { response, body } = await requestJson(app, "/health");
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("mounts ready route", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const { response, body } = await requestJson(app, "/ready");
      expect(response.status).toBe(503);
      expect(body).toEqual({ status: "not_ready" });
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
