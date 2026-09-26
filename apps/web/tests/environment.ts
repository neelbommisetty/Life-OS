import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createTestDb } from "../../../packages/tools/src/db/testing.ts";
import { FakeCatalog } from "../../../packages/tools/src/media/catalog/adapter.ts";
import { Tools } from "../../../packages/tools/src/tools.ts";
import { createApi } from "../../../packages/tools/src/api/app.ts";
import { createClient } from "@life-os/tools/client";

/** Only disposable schemas; never seeds or mutates the personal/public schema. */
export async function testEnvironment() {
  const db = await createTestDb();
  const tools = new Tools(db.store, undefined, {
    adapters: {},
    catalogs: {
      tmdb: new FakeCatalog({ source: "tmdb" }),
      igdb: new FakeCatalog({ source: "igdb" }),
      openlibrary: new FakeCatalog({ source: "openlibrary" }),
    },
    region: "US",
  });
  const token = "web-test-only-token-000000000000000000";
  const app = createApi({
    token,
    tools: async () => tools,
    migrate: async () => {},
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening)
    await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = createClient({ url, token, timezone: "America/Los_Angeles" });
  return {
    url,
    token,
    client,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ("closeIdleConnections" in server) server.closeIdleConnections();
      });
      await tools.close();
      await db.drop();
    },
  };
}
