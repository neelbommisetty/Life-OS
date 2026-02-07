import { serve } from "bun";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3001);

serve({
  port,
  fetch: app.fetch,
});

console.log(`API listening on http://localhost:${port}`);
