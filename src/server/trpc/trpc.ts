import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";

export type Context = {
  prisma: typeof prisma;
  req: NextRequest | null;
};

export const createTRPCContext = ({
  req,
}: FetchCreateContextFnOptions): Context => {
  return { prisma, req: req as NextRequest };
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const createCallerFactory = t.createCallerFactory;

