import { Hono } from "hono";

type ReadyRouteDependencies = {
  hasDatabaseUrl?: () => boolean;
  checkDatabaseReady?: () => Promise<boolean>;
};

async function checkDatabaseReadyWithPrisma() {
  const { prisma } = await import("@life-os/db");
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

export function createReadyRoute(dependencies: ReadyRouteDependencies = {}) {
  const readyRoute = new Hono();
  const hasDatabaseUrl = dependencies.hasDatabaseUrl ?? (() => Boolean(process.env.DATABASE_URL));
  const checkDatabaseReady = dependencies.checkDatabaseReady ?? checkDatabaseReadyWithPrisma;

  readyRoute.get("/ready", async (c) => {
    if (!hasDatabaseUrl()) {
      return c.json({ status: "not_ready" }, 503);
    }

    try {
      const isReady = await checkDatabaseReady();
      if (isReady) {
        return c.json({ status: "ok" });
      }
    } catch {
      return c.json({ status: "not_ready" }, 503);
    }

    return c.json({ status: "not_ready" }, 503);
  });

  return readyRoute;
}

export const readyRoute = createReadyRoute();
