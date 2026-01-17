import "server-only";
import { appRouter } from "./root";
import { createCallerFactory, createTRPCContext } from "./trpc";

const createCaller = createCallerFactory(appRouter);

export const serverCaller = () => createCaller(createTRPCContext());

