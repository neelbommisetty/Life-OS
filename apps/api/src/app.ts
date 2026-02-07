import { Hono } from "hono";
import { initializeAIServices } from "@life-os/ai/services";
import { authRoute } from "./routes/auth.js";
import { statusRoute } from "./routes/status.js";
import { homeRoute } from "./modules/home/route.js";
import { projectsRoute } from "./modules/projects/route.js";
import { notesRoute } from "./modules/notes/route.js";
import { tasksRoute } from "./modules/tasks/route.js";
import { chatRoute } from "./modules/chat/route.js";

try {
  initializeAIServices();
} catch (error) {
  console.error(
    "[api] failed to initialize AI services:",
    error instanceof Error ? error.message : String(error),
  );
}

export const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "Life-OS API is awake and mildly over-caffeinated.",
  }),
);

app.route("/", authRoute);
app.route("/", statusRoute);
app.route("/", homeRoute);
app.route("/", projectsRoute);
app.route("/", notesRoute);
app.route("/", tasksRoute);
app.route("/", chatRoute);

export default app;
