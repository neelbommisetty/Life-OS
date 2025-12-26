import { router } from "./trpc";
import { projectRouter } from "./routers/project";
import { taskRouter } from "./routers/task";
import { chatRouter } from "./routers/chat";
import { artifactRouter } from "./routers/artifact";
import { dashboardRouter } from "./routers/dashboard";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
  chat: chatRouter,
  artifact: artifactRouter,
  dashboard: dashboardRouter,
});

export type AppRouter = typeof appRouter;
