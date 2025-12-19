import { router } from "./trpc";
import { projectRouter } from "./routers/project";
import { taskRouter } from "./routers/task";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;
