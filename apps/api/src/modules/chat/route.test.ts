import { describe, expect, test } from "bun:test";
import { createChatRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const THREAD_ID = "ckz1q2w3e4r5t6y7u8i9o0p1f";
const MESSAGE_ID_1 = "ckz1q2w3e4r5t6y7u8i9o0p1g";
const MESSAGE_ID_2 = "ckz1q2w3e4r5t6y7u8i9o0p1h";

function createModelRegistry() {
  return {
    has: (key: string) => key === "openai:gpt-4.1-mini",
    getMetadata: (key: string) =>
      key === "openai:gpt-4.1-mini"
        ? {
            key,
            label: "GPT-4.1 mini",
            providerId: "openai",
            modes: ["text"],
            supportsStreaming: true,
          }
        : undefined,
    listMetadata: () => [
      {
        key: "openai:gpt-4.1-mini",
        label: "GPT-4.1 mini",
        providerId: "openai",
        modes: ["text"],
        supportsStreaming: true,
      },
    ],
  };
}

describe("chatRoute", () => {
  test("GET /api/chat/threads lists threads", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [{ id: THREAD_ID, name: "Main" }],
            create: async () => ({ id: THREAD_ID, name: "Main" }),
            findFirst: async () => ({ id: THREAD_ID, modelKey: null }),
            update: async () => ({ id: THREAD_ID, modelKey: null }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/chat/threads");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: THREAD_ID, name: "Main" }]);
  });

  test("POST /api/chat/threads creates thread", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID, name: "Created" }),
            findFirst: async () => ({ id: THREAD_ID, modelKey: null }),
            update: async () => ({ id: THREAD_ID, modelKey: null }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/chat/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Created" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: THREAD_ID, name: "Created" });
  });

  test("POST /api/chat/threads/:id/archive archives thread", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID }),
            update: async () => ({ id: THREAD_ID, archivedAt: new Date().toISOString() }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response } = await requestJson(app, `/api/chat/threads/${THREAD_ID}/archive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
  });

  test("GET /api/chat/threads/:id returns thread", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID, modelKey: null }),
            update: async () => ({ id: THREAD_ID, modelKey: null }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/chat/threads/${THREAD_ID}`);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: THREAD_ID, modelKey: null });
  });

  test("POST /api/chat/threads/:id/model sets thread model", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID }),
            update: async () => ({ id: THREAD_ID, modelKey: "openai:gpt-4.1-mini" }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(
      app,
      `/api/chat/threads/${THREAD_ID}/model`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelKey: "openai:gpt-4.1-mini" }),
      },
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: THREAD_ID, modelKey: "openai:gpt-4.1-mini" });
  });

  test("GET /api/chat/threads/:id/messages lists messages", async () => {
    const messageDate = new Date("2026-02-01T10:00:00.000Z");

    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID }),
            update: async () => ({ id: THREAD_ID, modelKey: null }),
          },
          chatMessage: {
            findMany: async () => [
              { id: MESSAGE_ID_2, createdAt: new Date("2026-02-01T10:01:00.000Z") },
              { id: MESSAGE_ID_1, createdAt: messageDate },
            ],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(
      app,
      `/api/chat/threads/${THREAD_ID}/messages?limit=1`,
    );

    expect(response.status).toBe(200);
    expect(body.threadId).toBe(THREAD_ID);
    expect(body.messages).toHaveLength(1);
    expect(body.nextCursor).toBeDefined();
  });

  test("GET /api/chat/models lists text models", async () => {
    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID, modelKey: null }),
            update: async () => ({ id: THREAD_ID, modelKey: null }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/chat/models");
    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        key: "openai:gpt-4.1-mini",
        label: "GPT-4.1 mini",
        provider: "openai",
        costTier: null,
        description: null,
        supportsStreaming: true,
      },
    ]);
  });

  test("POST /api/chat/stream delegates to API stream handler", async () => {
    let capturedUserId: string | null = null;
    let capturedBody: unknown;

    const app = createTestApp(
      createChatRoute({
        getUserId: async () => USER_ID,
        modelRegistry: createModelRegistry(),
        getDb: async () => ({
          chatThread: {
            findMany: async () => [],
            create: async () => ({ id: THREAD_ID }),
            findFirst: async () => ({ id: THREAD_ID }),
            update: async () => ({ id: THREAD_ID }),
          },
          chatMessage: {
            findMany: async () => [],
          },
        }),
        streamChat: async ({ request, userId }) => {
          capturedUserId = userId;
          capturedBody = await request.json().catch(() => null);
          return Response.json({ ok: true });
        },
      }),
    );

    const { response, body } = await requestJson(app, "/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId: THREAD_ID, content: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(capturedUserId).toBe(USER_ID);
    expect(capturedBody).toEqual({ threadId: THREAD_ID, content: "hello" });
  });
});
