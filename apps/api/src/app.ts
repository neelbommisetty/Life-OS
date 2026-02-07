import { Hono } from "hono";
import { authRoute } from "./routes/auth";
import { statusRoute } from "./routes/status";

export const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "Life-OS API is awake and mildly over-caffeinated.",
  }),
);

app.route("/", authRoute);
app.route("/", statusRoute);
