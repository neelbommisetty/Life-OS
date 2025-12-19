import { router } from "./trpc";
import { projectRouter } from "./routers/project";
import { taskRouter } from "./routers/task";
import { chatRouter } from "./routers/chat";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;
