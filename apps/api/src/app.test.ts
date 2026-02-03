import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("apps/api", () => {
  test("/health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("/ready returns 503 without DATABASE_URL", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    const res = await app.request("/ready");
    expect(res.status).toBe(503);

    if (original) process.env.DATABASE_URL = original;
  });
});
