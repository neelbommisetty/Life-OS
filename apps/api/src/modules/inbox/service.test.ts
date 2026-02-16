import { describe, expect, test } from "bun:test";
import {
  _private,
  processInboxItem,
  recoverInboxItem,
  type InboxDb,
} from "./service.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const ITEM_ID = "ckz1q2w3e4r5t6y7u8i9o0p1i";

function createBaseDb() {
  const db = {
    inboxItem: {
      updateMany: async () => ({}),
      findMany: async () => [],
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
      create: async () => ({ id: ITEM_ID }),
      update: async (args: { data: Record<string, unknown> }) => ({
        id: ITEM_ID,
        userId: USER_ID,
        content: "Capture",
        state: String(args.data.state ?? "REVIEW"),
        processedAt: args.data.processedAt ?? null,
        archivedAt: null,
        processingStartedAt: null,
        processingError: null,
        agentConfigSnapshot: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    inboxProposalOutput: {
      findMany: async () => [{ state: "DECLINED" }, { state: "SKIPPED" }],
      findFirst: async () => null,
      upsert: async () => ({}),
      update: async () => ({}),
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
      create: async () => ({ id: "note_1" }),
    },
    task: {
      create: async () => ({ id: "task_1" }),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  };

  return db as unknown as InboxDb;
}

describe("inbox service", () => {
  test("snapshot parser maps known agent keys", () => {
    const snapshot = {
      version: 1,
      agents: [
        { key: "kb_note", enabled: false },
        { key: "todo_list", enabled: true },
      ],
    };

    const parsed = _private.parseSnapshotConfig(snapshot);

    expect(parsed).not.toBeNull();
    expect(parsed?.find((agent) => agent.key === "kb_note")?.enabled).toBe(false);
    expect(parsed?.find((agent) => agent.key === "todo_list")?.enabled).toBe(true);
  });

  test("processInboxItem resolves pending + failed and computes processed", async () => {
    let pendingResolved = false;
    let failedResolved = false;

    const db = createBaseDb();
    db.inboxProposalOutput.updateMany = async (args: { where: { state: string } }) => {
      if (args.where.state === "PENDING") pendingResolved = true;
      if (args.where.state === "FAILED") failedResolved = true;
      return {};
    };

    const item = await processInboxItem({
      db,
      userId: USER_ID,
      input: {
        id: ITEM_ID,
      },
    });

    expect(pendingResolved).toBe(true);
    expect(failedResolved).toBe(true);
    expect(item).toMatchObject({
      id: ITEM_ID,
      state: "PROCESSED",
    });
  });

  test("recoverInboxItem requires stale processing age", async () => {
    const db = createBaseDb();
    db.inboxItem.findFirst = async () => ({
      id: ITEM_ID,
      userId: USER_ID,
      content: "Capture",
      state: "PROCESSING",
      processedAt: null,
      archivedAt: null,
      processingStartedAt: new Date(),
      processingError: null,
      agentConfigSnapshot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      recoverInboxItem({
        db,
        userId: USER_ID,
        input: {
          id: ITEM_ID,
        },
      }),
    ).rejects.toThrow("Inbox item is not eligible for recovery yet");
  });
});
