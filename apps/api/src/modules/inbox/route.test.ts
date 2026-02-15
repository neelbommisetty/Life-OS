import { describe, expect, test } from "bun:test";
import { createInboxRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const ITEM_ID = "ckz1q2w3e4r5t6y7u8i9o0p1i";

describe("inboxRoute", () => {
  test("GET /api/inbox lists non-archived items", async () => {
    let updateManyCalled = false;
    let findManyArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => {
              updateManyCalled = true;
              return {};
            },
            findMany: async (args) => {
              findManyArgs = args;
              return [{ id: ITEM_ID, state: "SAVED" }];
            },
            findFirst: async () => ({ id: ITEM_ID, state: "SAVED", processedAt: null }),
            create: async () => ({ id: ITEM_ID }),
            update: async () => ({ id: ITEM_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/inbox?search=idea");

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: ITEM_ID, state: "SAVED" }]);
    expect(updateManyCalled).toBe(true);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        state: { not: "ARCHIVED" },
      },
    });
  });

  test("GET /api/inbox/archived lists archived items", async () => {
    let findManyArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async (args) => {
              findManyArgs = args;
              return [{ id: ITEM_ID, state: "ARCHIVED" }];
            },
            findFirst: async () => ({ id: ITEM_ID, state: "ARCHIVED", processedAt: null }),
            create: async () => ({ id: ITEM_ID }),
            update: async () => ({ id: ITEM_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/inbox/archived");

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: ITEM_ID, state: "ARCHIVED" }]);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        state: "ARCHIVED",
      },
    });
  });

  test("GET /api/inbox/:id returns item", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async () => [],
            findFirst: async () => ({
              id: ITEM_ID,
              content: "Capture this",
              state: "SAVED",
              processedAt: null,
              archivedAt: null,
            }),
            create: async () => ({ id: ITEM_ID }),
            update: async () => ({ id: ITEM_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/inbox/${ITEM_ID}`);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      content: "Capture this",
      state: "SAVED",
    });
  });

  test("POST /api/inbox creates inbox item", async () => {
    let createArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async () => [],
            findFirst: async () => ({ id: ITEM_ID, state: "SAVED", processedAt: null }),
            create: async (args) => {
              createArgs = args;
              return { id: ITEM_ID, state: "SAVED" };
            },
            update: async () => ({ id: ITEM_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Remember this idea" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: ITEM_ID, state: "SAVED" });
    expect(createArgs).toMatchObject({
      data: {
        userId: USER_ID,
        content: "Remember this idea",
        state: "SAVED",
      },
    });
  });

  test("POST /api/inbox/:id/process marks item as processed", async () => {
    let updateArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async () => [],
            findFirst: async () => ({
              id: ITEM_ID,
              state: "SAVED",
              processedAt: null,
              archivedAt: null,
            }),
            create: async () => ({ id: ITEM_ID }),
            update: async (args) => {
              updateArgs = args;
              return {
                id: ITEM_ID,
                state: "PROCESSED",
                processedAt: new Date().toISOString(),
                archivedAt: null,
              };
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/inbox/${ITEM_ID}/process`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "PROCESSED",
    });
    expect(updateArgs).toMatchObject({
      where: { id: ITEM_ID },
      data: { state: "PROCESSED" },
    });
  });

  test("POST /api/inbox/:id/archive archives item", async () => {
    let updateArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async () => [],
            findFirst: async () => ({
              id: ITEM_ID,
              state: "SAVED",
              processedAt: null,
              archivedAt: null,
            }),
            create: async () => ({ id: ITEM_ID }),
            update: async (args) => {
              updateArgs = args;
              return {
                id: ITEM_ID,
                state: "ARCHIVED",
                archivedAt: new Date().toISOString(),
              };
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/inbox/${ITEM_ID}/archive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "ARCHIVED",
    });
    expect(updateArgs).toMatchObject({
      where: { id: ITEM_ID },
      data: { state: "ARCHIVED" },
    });
  });

  test("POST /api/inbox/:id/unarchive restores processed state", async () => {
    let updateArgs: unknown;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          inboxItem: {
            updateMany: async () => ({}),
            findMany: async () => [],
            findFirst: async () => ({
              id: ITEM_ID,
              state: "ARCHIVED",
              processedAt: new Date("2026-02-13T00:00:00.000Z"),
              archivedAt: new Date("2026-02-13T00:00:00.000Z"),
            }),
            create: async () => ({ id: ITEM_ID }),
            update: async (args) => {
              updateArgs = args;
              return {
                id: ITEM_ID,
                state: "PROCESSED",
                archivedAt: null,
              };
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/inbox/${ITEM_ID}/unarchive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: ITEM_ID, state: "PROCESSED" });
    expect(updateArgs).toMatchObject({
      where: { id: ITEM_ID },
      data: {
        state: "PROCESSED",
        archivedAt: null,
      },
    });
  });
});
