import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/health", (c) => c.json({ status: "ok" }));
healthRoute.get("/api/health", (c) => c.json({ status: "ok" }));
