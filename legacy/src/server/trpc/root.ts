import { router } from "./trpc";
import { projectRouter } from "./routers/project";
import { taskRouter } from "./routers/task";
import { chatRouter } from "./routers/chat";
import { artifactRouter } from "./routers/artifact";
import { dashboardRouter } from "./routers/dashboard";
import { aiUsageRouter } from "./routers/ai-usage";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
  chat: chatRouter,
  artifact: artifactRouter,
  dashboard: dashboardRouter,
  aiUsage: aiUsageRouter,
});

export type AppRouter = typeof appRouter;
