import { Hono } from "hono";
import { initializeAIServices } from "@life-os/ai";
import { authRoute } from "./routes/auth.js";
import { statusRoute } from "./routes/status.js";

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

export default app;
