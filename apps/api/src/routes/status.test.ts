import { describe, expect, test } from "bun:test";
import { createStatusRoute } from "./status.js";
import { createTestApp, requestJson, withEnv } from "../test/harness.js";

describe("statusRoute", () => {
  const mockAIStatus = {
    status: "ready" as const,
    initialized: true,
    providers: {
      openai: "ready" as const,
      anthropic: "ready" as const,
      gemini: "not_configured" as const,
      xai: "ready" as const,
    },
  };

  test("GET /status returns not_ready when DATABASE_URL is missing (default behavior)", async () => {
    await withEnv({ DATABASE_URL: undefined }, async () => {
      const app = createTestApp(
        createStatusRoute({
          getAIServicesStatus: () => mockAIStatus,
        }),
      );
      const { response, body } = await requestJson(app, "/status");

      expect(response.status).toBe(503);
      expect(body).toEqual({
        status: "not_ready",
        db: "not_configured",
        ai: mockAIStatus,
      });
    });
  });

  test("GET /status returns ready when database is reachable", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => true,
        getAIServicesStatus: () => mockAIStatus,
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", db: "ready", ai: mockAIStatus });
  });

  test("GET /status returns not_ready when database check resolves false", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => false,
        getAIServicesStatus: () => mockAIStatus,
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "not_ready",
      db: "not_ready",
      ai: mockAIStatus,
    });
  });

  test("GET /status returns not_ready when database check throws", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => {
          throw new Error("connection failed");
        },
        getAIServicesStatus: () => mockAIStatus,
      }),
    );
    const { response, body } = await requestJson(app, "/status");

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "not_ready",
      db: "not_ready",
      ai: mockAIStatus,
    });
  });

  test("GET /status includes reason when STATUS_DEBUG=true and database check throws", async () => {
    await withEnv({ STATUS_DEBUG: "true" }, async () => {
      const app = createTestApp(
        createStatusRoute({
          hasDatabaseUrl: () => true,
          checkDatabaseReady: async () => {
            throw new Error("connection failed");
          },
          getAIServicesStatus: () => mockAIStatus,
        }),
      );
      const { response, body } = await requestJson(app, "/status");

      expect(response.status).toBe(503);
      expect(body).toEqual({
        status: "not_ready",
        db: "not_ready",
        reason: "connection failed",
        ai: mockAIStatus,
      });
    });
  });

  test("GET /api/status returns ready when database is reachable", async () => {
    const app = createTestApp(
      createStatusRoute({
        hasDatabaseUrl: () => true,
        checkDatabaseReady: async () => true,
        getAIServicesStatus: () => mockAIStatus,
      }),
    );
    const { response, body } = await requestJson(app, "/api/status");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready", db: "ready", ai: mockAIStatus });
  });
});
