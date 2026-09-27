import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { clientConfig } from "../../../packages/tools/src/api/config.ts";
import { createBridge } from "./bridge.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.LIFE_WEB_PORT ?? 4320);
const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const app = createBridge({ ...(await clientConfig(process.env)), origins });
const api = getRequestListener(app.fetch);
const production = process.argv.includes("--production");
const staticApp = new Hono();
staticApp.use("*", async (c, next) => {
  c.header(
    "Cache-Control",
    c.req.path.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  await next();
});
staticApp.get("/", (c) => c.redirect("/todo"));
staticApp.use("/assets/*", serveStatic({ root: root + "dist" }));
staticApp.get("/favicon.svg", serveStatic({ path: root + "dist/favicon.svg" }));
staticApp.get("/todo", serveStatic({ path: root + "dist/index.html" }));
staticApp.get("/todo/*", serveStatic({ path: root + "dist/index.html" }));
staticApp.get("/calendar", serveStatic({ path: root + "dist/index.html" }));
staticApp.get("/calendar/*", serveStatic({ path: root + "dist/index.html" }));
const staticHandler = getRequestListener(staticApp.fetch);
const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.url?.startsWith("/api/")) {
    void api(req, res);
    return;
  }
  if (req.url === "/") {
    res.writeHead(302, { location: "/todo" });
    res.end();
    return;
  }
  if (vite) vite.middlewares(req, res);
  else void staticHandler(req, res);
});
const vite = production
  ? undefined
  : await (
      await import("vite")
    ).createServer({
      root,
      configFile: root + "vite.config.ts",
      server: {
        middlewareMode: true,
        hmr: { server },
        allowedHosts: ["localhost", "127.0.0.1"],
      },
      appType: "spa",
    });
server.listen(port, "127.0.0.1", () =>
  console.log(`Life-OS · http://127.0.0.1:${port}/todo`),
);
async function shutdown() {
  await vite?.close();
  server.close();
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
