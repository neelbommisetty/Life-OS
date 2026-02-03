import { Hono } from "hono";

export const readyRoute = new Hono();

readyRoute.get("/ready", async (c) => {
  if (!process.env.DATABASE_URL) {
    return c.json({ status: "not_ready" }, 503);
  }

  try {
    const { prisma } = await import("@life-os/db");
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "not_ready" }, 503);
  }
});
