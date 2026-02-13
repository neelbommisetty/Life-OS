import "./instrument.js";
import { serve } from "bun";
import { createLogger } from "@life-os/logger";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const logger = createLogger("api:server");

serve({
  port,
  fetch: app.fetch,
});

logger.info("API listening", {
  port,
  url: `http://localhost:${port}`,
});
