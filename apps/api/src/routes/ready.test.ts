import { describe, expect, test } from "bun:test";
import { createReadyRoute } from "./ready";
import { createTestApp, requestJson, withEnv } from "../test/harness";

describe("readyRoute", () => {
  test("returns 503 when DATABASE_URL is missing (default behavior)", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const app = createTestApp(createReadyRoute());
      const { response, body } = await requestJson(app, "/ready");

      expect(response.status).toBe(503);
      expect(body).toEqual({ status: "not_ready" });
    });
  });

  test("returns 200 when database is reachable", async () => {
    const app = createTestApp(
      createReadyRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => true,
      }),
    );

    const { response, body } = await requestJson(app, "/ready");
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("returns 503 when database check resolves false", async () => {
    const app = createTestApp(
      createReadyRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => false,
      }),
    );

    const { response, body } = await requestJson(app, "/ready");
    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "not_ready" });
  });

  test("returns 503 when database check throws", async () => {
    const app = createTestApp(
      createReadyRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => {
          throw new Error("connection failed");
        },
      }),
    );

    const { response, body } = await requestJson(app, "/ready");
    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "not_ready" });
  });
});
