import { appRouter } from "./root";
import { prisma } from "../db";
import { createCallerFactory } from "./trpc";

const createCaller = createCallerFactory(appRouter);

export const serverCaller = () => createCaller({ prisma, req: null });

