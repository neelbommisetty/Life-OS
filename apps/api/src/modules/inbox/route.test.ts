import { describe, expect, test } from "bun:test";
import { createInboxRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const ITEM_ID = "ckz1q2w3e4r5t6y7u8i9o0p1i";
const ITEM_ID_2 = "ckz1q2w3e4r5t6y7u8i9o0p2i";
const OUTPUT_ID = "ckz1q2w3e4r5t6y7u8i9o0p9o";
const OUTPUT_ID_2 = "ckz1q2w3e4r5t6y7u8i9o0p8o";

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
  test("GET /inbox lists non-archived items", async () => {
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

    const { response, body } = await requestJson(app, "/inbox?search=idea");

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: ITEM_ID, state: "SAVED" }]);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        state: { not: "ARCHIVED" },
      },
    });
  });

  test("POST /inbox creates processing inbox item and queues generation", async () => {
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

    const { response, body } = await requestJson(app, "/inbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Remember this idea" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: ITEM_ID, state: "PROCESSING" });
    expect(queuedItemId).toBe(ITEM_ID);
  });

  test("POST /inbox/:id/process resolves pending outputs and returns processed item", async () => {
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

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/process`, {
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

  test("GET /inbox/archived lists archived items", async () => {
    let findManyArgs: unknown;

    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findMany: async (args: unknown) => {
          findManyArgs = args;
          return [{ id: ITEM_ID, state: "ARCHIVED" }];
        },
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, "/inbox/archived?search=done");

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: ITEM_ID, state: "ARCHIVED" }]);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        state: "ARCHIVED",
      },
    });
  });

  test("GET /inbox/:id returns item by id", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}`);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      userId: USER_ID,
    });
  });

  test("GET /inbox/:id returns 404 when item does not exist", async () => {
    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => null,
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID_2}`);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "not_found",
      message: "Inbox item not found",
    });
  });

  test("POST /inbox/:id/archive archives inbox item", async () => {
    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          content: "Capture",
          state: "SAVED",
          processedAt: null,
          archivedAt: null,
          processingStartedAt: null,
          processingError: null,
          agentConfigSnapshot: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-15T00:00:00.000Z"),
        }),
        update: async (args: { data: { state: string } }) => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: args.data.state,
          archivedAt: new Date("2026-02-16T00:00:00.000Z"),
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/archive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "ARCHIVED",
    });
  });

  test("POST /inbox/:id/archive is idempotent when item is already archived", async () => {
    let updateCalled = false;

    const archivedItem = {
      id: ITEM_ID,
      userId: USER_ID,
      content: "Capture",
      state: "ARCHIVED",
      processedAt: null,
      archivedAt: new Date("2026-02-16T00:00:00.000Z"),
      processingStartedAt: null,
      processingError: null,
      agentConfigSnapshot: null,
      createdAt: new Date("2026-02-15T00:00:00.000Z"),
      updatedAt: new Date("2026-02-16T00:00:00.000Z"),
    };

    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => archivedItem,
        update: async () => {
          updateCalled = true;
          return archivedItem;
        },
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/archive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "ARCHIVED",
    });
    expect(updateCalled).toBe(false);
  });

  test("POST /inbox/:id/unarchive returns SAVED when processedAt is null", async () => {
    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          content: "Capture",
          state: "ARCHIVED",
          processedAt: null,
          archivedAt: new Date("2026-02-16T00:00:00.000Z"),
          processingStartedAt: null,
          processingError: null,
          agentConfigSnapshot: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        }),
        update: async (args: { data: { state: string; archivedAt: null } }) => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: args.data.state,
          archivedAt: args.data.archivedAt,
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/unarchive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "SAVED",
      archivedAt: null,
    });
  });

  test("POST /inbox/:id/unarchive returns PROCESSED when processedAt exists", async () => {
    const processedAt = new Date("2026-02-15T00:00:00.000Z");

    const db = createMockDb({
      inboxItem: {
        ...createMockDb().inboxItem,
        findFirst: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          content: "Capture",
          state: "ARCHIVED",
          processedAt,
          archivedAt: new Date("2026-02-16T00:00:00.000Z"),
          processingStartedAt: null,
          processingError: null,
          agentConfigSnapshot: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        }),
        update: async (args: { data: { state: string; archivedAt: null } }) => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: args.data.state,
          archivedAt: args.data.archivedAt,
          processedAt,
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/${ITEM_ID}/unarchive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: ITEM_ID,
      state: "PROCESSED",
      archivedAt: null,
    });
  });

  test("POST /inbox/outputs/:outputId/decline requires Idempotency-Key", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(body.message).toContain("Idempotency-Key");
  });

  test("POST /inbox/outputs/:outputId/decline declines pending output", async () => {
    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
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
          state: "DECLINED",
          errorMessage: null,
          resolvedAt: new Date("2026-02-16T00:00:00.000Z"),
          createdArtifacts: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        }),
      },
      inboxItem: {
        ...createMockDb().inboxItem,
        update: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: "REVIEW",
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/decline`, {
      method: "POST",
      headers: {
        "Idempotency-Key": "decline-idem-1",
      },
    });

    expect(response.status).toBe(200);
    expect(body.output).toMatchObject({
      id: OUTPUT_ID,
      state: "DECLINED",
    });
  });

  test("POST /inbox/outputs/:outputId/retry requires Idempotency-Key", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/retry`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(body.message).toContain("Idempotency-Key");
  });

  test("POST /inbox/outputs/:outputId/retry retries failed output", async () => {
    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
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
          state: "FAILED",
          errorMessage: "previous error",
          resolvedAt: null,
          createdArtifacts: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-15T00:00:00.000Z"),
        }),
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
          resolvedAt: new Date("2026-02-16T00:00:00.000Z"),
          createdArtifacts: [{ type: "note", id: "ckz1q2w3e4r5t6y7u8i9o0p2n" }],
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-16T00:00:00.000Z"),
        }),
      },
      inboxItem: {
        ...createMockDb().inboxItem,
        update: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: "PROCESSED",
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/retry`, {
      method: "POST",
      headers: {
        "Idempotency-Key": "retry-idem-1",
      },
    });

    expect(response.status).toBe(200);
    expect(body.output).toMatchObject({
      id: OUTPUT_ID,
      state: "APPROVED",
    });
  });

  test("POST /inbox/outputs/:outputId/skip requires Idempotency-Key", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/skip`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "manual skip" }),
    });

    expect(response.status).toBe(400);
    expect(body.message).toContain("Idempotency-Key");
  });

  test("POST /inbox/outputs/:outputId/skip skips failed output and stores reason", async () => {
    let capturedUpdateData: unknown;

    const db = createMockDb({
      inboxProposalOutput: {
        ...createMockDb().inboxProposalOutput,
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
          state: "FAILED",
          errorMessage: "generation failed",
          resolvedAt: null,
          createdArtifacts: null,
          createdAt: new Date("2026-02-15T00:00:00.000Z"),
          updatedAt: new Date("2026-02-15T00:00:00.000Z"),
        }),
        update: async (args: { data: unknown }) => {
          capturedUpdateData = args.data;
          return {
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
            state: "SKIPPED",
            errorMessage: "Skipped: manual skip",
            resolvedAt: new Date("2026-02-16T00:00:00.000Z"),
            createdArtifacts: null,
            createdAt: new Date("2026-02-15T00:00:00.000Z"),
            updatedAt: new Date("2026-02-16T00:00:00.000Z"),
          };
        },
      },
      inboxItem: {
        ...createMockDb().inboxItem,
        update: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: "PROCESSED",
        }),
      },
    });

    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => db as never,
      }),
    );

    const { response, body } = await requestJson(app, `/inbox/outputs/${OUTPUT_ID}/skip`, {
      method: "POST",
      headers: {
        "Idempotency-Key": "skip-idem-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "manual skip" }),
    });

    expect(response.status).toBe(200);
    expect(capturedUpdateData).toMatchObject({
      state: "SKIPPED",
      errorMessage: "Skipped: manual skip",
    });
    expect(body.output).toMatchObject({
      id: OUTPUT_ID,
      state: "SKIPPED",
      errorMessage: "Skipped: manual skip",
    });
  });

  test("POST /inbox/:itemId/outputs/decline-all requires Idempotency-Key", async () => {
    const app = createTestApp(
      createInboxRoute({
        getUserId: async () => USER_ID,
        getDb: async () => createMockDb() as never,
      }),
    );

    const { response, body } = await requestJson(
      app,
      `/inbox/${ITEM_ID}/outputs/decline-all`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(400);
    expect(body.message).toContain("Idempotency-Key");
  });

  test("POST /inbox/:itemId/outputs/decline-all returns bulk result payload", async () => {
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
          {
            id: OUTPUT_ID_2,
            userId: USER_ID,
            inboxItemId: ITEM_ID,
            agentKey: "KB_NOTE",
            outputIndex: 1,
            payloadVersion: 1,
            payload: {
              title: "Second Title",
              content: "Second Body",
            },
            payloadPreview: "Create second note",
            state: "FAILED",
            errorMessage: "generation failed",
            resolvedAt: null,
            createdArtifacts: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
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
          payloadPreview: "Create note",
          state: "DECLINED",
          errorMessage: null,
          resolvedAt: new Date(),
          createdArtifacts: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      inboxItem: {
        ...createMockDb().inboxItem,
        update: async () => ({
          id: ITEM_ID,
          userId: USER_ID,
          state: "PROCESSED",
        }),
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
      `/inbox/${ITEM_ID}/outputs/decline-all`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": "bulk-decline-idem-1",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      itemId: ITEM_ID,
    });
    expect(body.results).toHaveLength(2);
    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputId: OUTPUT_ID,
          state: "updated",
        }),
        expect.objectContaining({
          outputId: OUTPUT_ID_2,
          state: "failed",
          error: "Failed outputs require skip or retry",
        }),
      ]),
    );
  });
});
