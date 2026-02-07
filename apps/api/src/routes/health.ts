import { Hono } from "hono";

export function createHealthRoute() {
  const healthRoute = new Hono();

  healthRoute.get("/health", (c) => c.json({ status: "ok" }));
  healthRoute.get("/api/health", (c) => c.json({ status: "ok" }));

  return healthRoute;
}

export const healthRoute = createHealthRoute();
