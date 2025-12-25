import { router } from "./trpc";
import { projectRouter } from "./routers/project";
import { taskRouter } from "./routers/task";
import { chatRouter } from "./routers/chat";
import { artifactRouter } from "./routers/artifact";

export const appRouter = router({
  project: projectRouter,
  task: taskRouter,
  chat: chatRouter,
  artifact: artifactRouter,
});

export type AppRouter = typeof appRouter;
