import { Hono } from "hono";
import { authRoute } from "./routes/auth";
import { healthRoute } from "./routes/health";
import { readyRoute } from "./routes/ready";

export const app = new Hono();

app.route("/", authRoute);
app.route("/", healthRoute);
app.route("/", readyRoute);
