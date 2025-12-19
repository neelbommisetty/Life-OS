import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { prisma } from "@/server/db";
import { createLogger } from "@/lib/ai/logger";

const logger = createLogger("trpc:context");

export type Context = {
  prisma: typeof prisma;
  req: Request | null;
};

export const createTRPCContext = (
  opts?: FetchCreateContextFnOptions
): Context => {
  try {
    // Ensure prisma is available
    if (!prisma || typeof prisma !== "object") {
      logger.error("Prisma client is not properly initialized", {
        prismaType: typeof prisma,
        hasPrisma: !!prisma,
      });
      throw new Error("Prisma client is not initialized");
    }

    logger.debug("Creating tRPC context", {
      hasPrisma: !!prisma,
      hasReq: !!opts?.req,
    });

    return { prisma, req: opts?.req ?? null };
  } catch (error) {
    logger.error("Failed to create tRPC context", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;
