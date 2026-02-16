import { Hono } from "hono";
import {
  getAIServicesStatus as getAIServicesStatusFromPackage,
  type AIServicesStatus,
} from "@life-os/ai";
import { createLogger } from "@life-os/logger";

type StatusRouteDependencies = {
  hasDatabaseUrl?: () => boolean;
  checkDatabaseReady?: () => Promise<boolean>;
  getAIServicesStatus?: () => AIServicesStatus;
};

const logger = createLogger("api:status");

async function checkDatabaseReadyWithPrisma() {
  const { prisma } = await import("@life-os/db");
  await prisma.$queryRaw`SELECT 1`;
  return true;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createStatusRoute(dependencies: StatusRouteDependencies = {}) {
  const statusRoute = new Hono();
  const hasDatabaseUrl = dependencies.hasDatabaseUrl ?? (() => Boolean(process.env.DATABASE_URL));
  const checkDatabaseReady = dependencies.checkDatabaseReady ?? checkDatabaseReadyWithPrisma;
  const getAIServicesStatus =
    dependencies.getAIServicesStatus ?? getAIServicesStatusFromPackage;

  const getStatus = async () => {
    const ai = getAIServicesStatus();

    if (!hasDatabaseUrl()) {
      return {
        code: 503 as const,
        body: { status: "not_ready", db: "not_configured", ai },
      };
    }

    try {
      const isReady = await checkDatabaseReady();
      if (isReady) {
        return { code: 200 as const, body: { status: "ready", db: "ready", ai } };
      }
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error("Database readiness check failed", { message });

      if (process.env.STATUS_DEBUG === "true") {
        return {
          code: 503 as const,
          body: { status: "not_ready", db: "not_ready", reason: message, ai },
        };
      }

      return { code: 503 as const, body: { status: "not_ready", db: "not_ready", ai } };
    }

    return { code: 503 as const, body: { status: "not_ready", db: "not_ready", ai } };
  };

  statusRoute.get("/status", async (c) => {
    const { code, body } = await getStatus();
    return c.json(body, code);
  });
  return statusRoute;
}

export const statusRoute = createStatusRoute();
