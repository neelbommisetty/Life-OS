import { describe, expect, test } from "bun:test";
import { createHealthRoute } from "./health";
import { createTestApp, requestJson } from "../test/harness";

describe("healthRoute", () => {
  test("GET /health returns ok", async () => {
    const app = createTestApp(createHealthRoute());
    const { response, body } = await requestJson(app, "/health");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("GET /api/health returns ok", async () => {
    const app = createTestApp(createHealthRoute());
    const { response, body } = await requestJson(app, "/api/health");

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
