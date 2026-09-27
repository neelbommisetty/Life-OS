import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createTestDb } from "../../../packages/tools/src/db/testing.ts";
import { FakeCatalog } from "../../../packages/tools/src/media/catalog/adapter.ts";
import { Tools } from "../../../packages/tools/src/tools.ts";
import { createApi } from "../../../packages/tools/src/api/app.ts";
import {
  FakeAdapter,
  type SeedEvent,
  type ProviderCalendar,
} from "../../../packages/tools/src/calendar/adapter.ts";
import { mutate, newId, okMutation } from "../../../packages/tools/src/core.ts";
import { syncAccount } from "../../../packages/tools/src/calendar/sync.ts";
import { createClient } from "@life-os/tools/client";

/** Only disposable schemas; never seeds or mutates the personal/public schema. */
export async function testEnvironment() {
  const db = await createTestDb();
  const fake = new FakeAdapter();
  const tools = new Tools(db.store, undefined, {
    adapters: { google: fake },
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
    fake,
    async seedCalendar(
      events: SeedEvent[] = [],
      overrides: Partial<ProviderCalendar> = {},
    ) {
      const existing = (await tools.account.list())[0];
      const receipt = existing
        ? { ok: true as const, record: existing }
        : await mutate(
            db.store,
            tools.clock,
            "account",
            "account.add",
            { actor: "neel" },
            async (_tx, _ctx, now) =>
              okMutation("created", null, {
                id: newId("account"),
                provider: "google",
                identity: "demo@example.com",
                label: "Demo account",
                primary: true,
                status: "connected",
                scopes: [],
                syncedAt: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
              }),
          );
      if (!receipt.ok) throw new Error(receipt.issues.join("; "));
      const account = receipt.record;
      fake.link(account.id, account.identity);
      fake.seed(
        account.id,
        {
          id: "demo-calendar",
          name: "Personal",
          color: "#437ba7",
          timezone: "America/Los_Angeles",
          writable: true,
          primary: true,
          hidden: false,
          ...overrides,
        },
        events,
      );
      await syncAccount(db.store, tools.clock, fake, account.id);
      return (await tools.calendar.list({ includeHidden: true })).find(
        (c) =>
          c.accountId === account.id &&
          c.external.id === (overrides.id ?? "demo-calendar"),
      )!;
    },
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
