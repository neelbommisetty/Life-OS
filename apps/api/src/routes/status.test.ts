import { describe, expect, test } from "bun:test";
import { createStatusRoute } from "./status";
import { createTestApp, requestJson, withEnv } from "../test/harness";

describe("statusRoute", () => {
  test("GET /status returns not_ready when DATABASE_URL is missing (default behavior)", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const app = createTestApp(createStatusRoute());
      const { response, body } = await requestJson(app, "/status");

      expect(response.status).toBe(503);
      expect(body).toEqual({ status: "not_ready", db: "not_configured" });
    });
  });

  test("GET /status returns ready when database is reachable", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => true,
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", db: "ready" });
  });

  test("GET /status returns not_ready when database check resolves false", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => false,
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "not_ready", db: "not_ready" });
  });

  test("GET /status returns not_ready when database check throws", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => {
          throw new Error("connection failed");
        },
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "not_ready", db: "not_ready" });
  });

  test("GET /api/status returns ready when database is reachable", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => true,
      }),
    );
    const { response, body } = await requestJson(app, "/api/status");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", db: "ready" });
  });
});
