import { Hono } from "hono";
import { healthRoute } from "./routes/health";
import { readyRoute } from "./routes/ready";

export const app = new Hono();

app.route("/", healthRoute);
app.route("/", readyRoute);
