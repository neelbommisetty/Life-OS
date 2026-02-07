import { Hono } from "hono";
import { authRoute } from "./routes/auth.js";
import { statusRoute } from "./routes/status.js";

export const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "Life-OS API is awake and mildly over-caffeinated.",
  }),
);

app.route("/", authRoute);
app.route("/", statusRoute);

export default app;
