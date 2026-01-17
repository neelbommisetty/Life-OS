import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { prisma } from "@/server/db";
import { createLogger } from "@/lib/logger";

const contextLogger = createLogger("trpc:context");
const procedureLogger = createLogger("trpc:procedure");

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
      contextLogger.error("Prisma client is not properly initialized", {
        prismaType: typeof prisma,
        hasPrisma: !!prisma,
      });
      throw new Error("Prisma client is not initialized");
    }

    contextLogger.debug("Creating tRPC context", {
      hasPrisma: !!prisma,
      hasReq: !!opts?.req,
    });

    return { prisma, req: opts?.req ?? null };
  } catch (error) {
    contextLogger.error("Failed to create tRPC context", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

const logProcedureMiddleware = t.middleware(async ({ path, type, input, next }) => {
  const start = Date.now();
  const inputMeta =
    input === undefined
      ? { hasInput: false }
      : typeof input === "object" && input !== null
      ? {
          hasInput: true,
          inputKeyCount: Object.keys(input).length,
        }
      : {
          hasInput: true,
          inputType: typeof input,
        };

  procedureLogger.debug("Starting tRPC procedure", {
    path,
    type,
    ...inputMeta,
  });

  try {
    const result = await next();
    procedureLogger.info("tRPC procedure succeeded", {
      path,
      type,
      durationMs: Date.now() - start,
    });
    return result;
  } catch (error) {
    procedureLogger.error("tRPC procedure failed", {
      path,
      type,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

export const router = t.router;
export const publicProcedure = t.procedure.use(logProcedureMiddleware);
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;
