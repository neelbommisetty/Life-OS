import { describe, expect, test } from "bun:test";
import { createInboxAgentSettingsRoute } from "./inbox-agents-route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";

describe("inboxAgentSettingsRoute", () => {
  test("GET /settings/inbox-agents returns effective settings", async () => {
    const app = createTestApp(
      createInboxAgentSettingsRoute({
        getUserId: async () => USER_ID,
        getDb: async () =>
          ({
            inboxAgentUserSetting: {
              findMany: async () => [],
              upsert: async () => ({}),
            },
          }) as never,
      }),
    );

    const { response, body } = await requestJson(app, "/settings/inbox-agents");

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        key: "kb_note",
        defaultEnabled: true,
        enabled: true,
        source: "default",
      },
      {
        key: "todo_list",
        defaultEnabled: true,
        enabled: true,
        source: "default",
      },
    ]);
  });

  test("PATCH /settings/inbox-agents updates overrides", async () => {
    let upsertCalls = 0;

    const app = createTestApp(
      createInboxAgentSettingsRoute({
        getUserId: async () => USER_ID,
        getDb: async () =>
          ({
            inboxAgentUserSetting: {
              findMany: async () => [{ agentKey: "KB_NOTE", enabled: false }],
              upsert: async () => {
                upsertCalls += 1;
                return {};
              },
            },
          }) as never,
      }),
    );

    const { response, body } = await requestJson(app, "/settings/inbox-agents", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agents: [
          {
            key: "kb_note",
            enabled: false,
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(upsertCalls).toBe(1);
    expect(body[0]).toMatchObject({ key: "kb_note", enabled: false, source: "user" });
  });
});
