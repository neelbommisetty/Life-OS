import { describe, expect, test } from "bun:test";

describe("packages/db", () => {
  test("exports a prisma client", async () => {
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    }
    const { prisma } = await import("./index");
    expect(typeof prisma.$connect).toBe("function");
  });
});
