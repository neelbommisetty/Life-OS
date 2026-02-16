import { describe, expect, test } from "bun:test";
import { createInboxRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const ITEM_ID = "ckz1q2w3e4r5t6y7u8i9o0p1i";
const OUTPUT_ID = "ckz1q2w3e4r5t6y7u8i9o0p9o";

function createMockDb(overrides: Record<string, unknown> = {}) {
  const db = {
    inboxItem: {
      updateMany: async () => ({}),
      findMany: async () => [],
      findFirst: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        content: "Capture this",
        state: "SAVED",
        processedAt: null,
        archivedAt: null,
        processingStartedAt: null,
        processingError: null,
        agentConfigSnapshot: null,
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
        updatedAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
      create: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        state: "PROCESSING",
      }),
      update: async () => ({
        id: ITEM_ID,
        userId: USER_ID,
        state: "PROCESSED",
        processedAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
    },
    inboxProposalOutput: {
      findMany: async () => [],
      findFirst: async () => ({
        id: OUTPUT_ID,
        userId: USER_ID,
        inboxItemId: ITEM_ID,
        agentKey: "KB_NOTE",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {
          title: "Title",
          content: "Body",
        },
        payloadPreview: "preview",
        state: "PENDING",
        errorMessage: null,
        resolvedAt: null,
        createdArtifacts: null,
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
        updatedAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
      upsert: async () => ({}),
      update: async () => ({
        id: OUTPUT_ID,
        userId: USER_ID,
        inboxItemId: ITEM_ID,
        agentKey: "KB_NOTE",
        outputIndex: 0,
        payloadVersion: 1,
        payload: {
          title: "Title",
          content: "Body",
        },
        payloadPreview: "preview",
        state: "APPROVED",
        errorMessage: null,
        resolvedAt: new Date("2026-02-15T00:00:00.000Z"),
        createdArtifacts: [{ type: "note", id: "ckz1q2w3e4r5t6y7u8i9o0p2n" }],
        createdAt: new Date("2026-02-15T00:00:00.000Z"),
        updatedAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
      updateMany: async () => ({}),
    },
    inboxProposalActionIdempotency: {
      findFirst: async () => null,
      create: async () => ({}),
    },
    inboxAgentUserSetting: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
    note: {
      create: async () => ({ id: "ckz1q2w3e4r5t6y7u8i9o0p2n" }),
    },
    task: {
      create: async () => ({ id: "ckz1q2w3e4r5t6y7u8i9o0p3t" }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    ...overrides,
  };

  return db;
}

describe("inboxRoute", () => {
  test("GET /api/inbox lists non-archived items", async () => {
    let findManyArgs: unknown;

    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findMany: async (args: unknown) => {
          findManyArgs = args;
          return [{ id: ITEM_ID, state: "SAVED" }];
        },
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, "/api/inbox?search=idea");

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: ITEM_ID, state: "SAVED" }]);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        state: { not: "ARCHIVED" },
      },
    });
  });

  test("POST /api/inbox creates processing inbox item and queues generation", async () => {
    let queuedItemId: string | null = null;

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
        queueProposalGeneration: ({ inboxItemId }) => {
          queuedItemId = inboxItemId;
        },
      }),
    );

    const { response, body } = await requestJson(app, "/api/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Remember this idea" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: ITEM_ID, state: "PROCESSING" });
    expect(queuedItemId).toBe(ITEM_ID);
  });

  test("POST /api/inbox/:id/process resolves pending outputs and returns processed item", async () => {
    let pendingResolved = false;
    let failedResolved = false;

    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
        updateMany: async (args: { where: { state: string } }) => {
          if (args.where.state === "PENDING") {
            pendingResolved = true;
          }
          if (args.where.state === "FAILED") {
            failedResolved = true;
          }
          return {};
        },
        findMany: async () => [],
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/api/inbox/${ITEM_ID}/process`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: ITEM_ID, state: "PROCESSED" });
    expect(pendingResolved).toBe(true);
    expect(failedResolved).toBe(true);
  });

  test("GET /inbox/:itemId/outputs returns proposal outputs in review flow", async () => {
    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
        findMany: async () => [
          {
            id: OUTPUT_ID,
            userId: USER_ID,
            inboxItemId: ITEM_ID,
            agentKey: "KB_NOTE",
            outputIndex: 0,
            payloadVersion: 1,
            payload: {
              title: "Title",
              content: "Body",
            },
            payloadPreview: "Create a note",
            state: "PENDING",
            errorMessage: null,
            resolvedAt: null,
            createdArtifacts: null,
            createdAt: new Date("2026-02-15T00:00:00.000Z"),
            updatedAt: new Date("2026-02-15T00:00:00.000Z"),
          },
        ],
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/outputs`);

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: OUTPUT_ID,
      agentKey: "kb_note",
      state: "PENDING",
    });
  });

  test("POST /inbox/outputs/:outputId/approve requires Idempotency-Key", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/approve`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(body.message).toContain("Idempotency-Key");
  });

  test("POST /inbox/outputs/:outputId/approve approves output and creates artifact", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/approve`, {
      method: "POST",
      headers: {
        "Idempotency-Key": "idem-1",
      },
    });

    expect(response.status).toBe(200);
    expect(body.output).toMatchObject({
      id: OUTPUT_ID,
      state: "APPROVED",
      createdArtifacts: [{ type: "note" }],
    });
  });

  test("POST /inbox/:id/recover transitions stale processing item to review", async () => {
    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          content: "Capture",
          state: "PROCESSING",
          processedAt: null,
          archivedAt: null,
          processingStartedAt: new Date(Date.now() - 5 * 60 * 1000),
          processingError: null,
          agentConfigSnapshot: null,
          createdAt: new Date(Date.now() - 5 * 60 * 1000),
          updatedAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
        update: async (args: { data: { state: string } }) => ({
          id: ITEM_ID,
          state: args.data.state,
        }),
      },
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
        findMany: async () => [{ id: OUTPUT_ID }],
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/recover`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: ITEM_ID, state: "REVIEW" });
  });

  test("POST /inbox/:itemId/outputs/approve-all returns bulk result payload", async () => {
    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
        findMany: async () => [
          {
            id: OUTPUT_ID,
            userId: USER_ID,
            inboxItemId: ITEM_ID,
            agentKey: "KB_NOTE",
            outputIndex: 0,
            payloadVersion: 1,
            payload: {
              title: "Title",
              content: "Body",
            },
            payloadPreview: "Create note",
            state: "PENDING",
            errorMessage: null,
            resolvedAt: null,
            createdArtifacts: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(
      app,
      `/inbox/${ITEM_ID}/outputs/approve-all`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "bulk-idem-1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      itemId: ITEM_ID,
    });
    expect(body.results).toHaveLength(1);
  });
});
