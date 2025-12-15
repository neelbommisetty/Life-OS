import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { prisma } from "@/server/db";

export type Context = {
  prisma: typeof prisma;
  req: Request | null;
};

export const createTRPCContext = (
  opts?: FetchCreateContextFnOptions
): Context => {
  return { prisma, req: opts?.req ?? null };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;
