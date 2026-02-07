import { Hono } from "hono";

type StatusRouteDependencies = {
  hasDatabaseUrl?: () => boolean;
  checkDatabaseReady?: () => Promise<boolean>;
};

async function checkDatabaseReadyWithPrisma() {
  const { prisma } = await import("@life-os/db");
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

export function createStatusRoute(dependencies: StatusRouteDependencies = {}) {
  const statusRoute = new Hono();
  const hasDatabaseUrl = dependencies.hasDatabaseUrl ?? (() => Boolean(process.env.DATABASE_URL));
  const checkDatabaseReady = dependencies.checkDatabaseReady ?? checkDatabaseReadyWithPrisma;

  const getStatus = async () => {
    if (!hasDatabaseUrl()) {
      return { code: 503 as const, body: { status: "not_ready", db: "not_configured" } };
    }

    try {
      const isReady = await checkDatabaseReady();
      if (isReady) {
        return { code: 200 as const, body: { status: "ready", db: "ready" } };
      }
    } catch {
      return { code: 503 as const, body: { status: "not_ready", db: "not_ready" } };
    }

    return { code: 503 as const, body: { status: "not_ready", db: "not_ready" } };
  };

  statusRoute.get("/status", async (c) => {
    const { code, body } = await getStatus();
    return c.json(body, code);
  });

  statusRoute.get("/api/status", async (c) => {
    const { code, body } = await getStatus();
    return c.json(body, code);
  });

  return statusRoute;
}

export const statusRoute = createStatusRoute();
