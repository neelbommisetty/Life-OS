import { describe, expect, test } from "bun:test";
import {
  appendMessageToContext,
  formatPromptFromContext,
  getOrCreateContext,
  parseConversationContext,
  serializeConversationContext,
  summarizeContextIfOverBudget,
  type ContextMessageEntry,
} from "./thread-context-service.js";

function buildMessage(
  id: string,
  role: "USER" | "ASSISTANT",
  content: string,
  tokenCount: number,
  createdAt: string,
): ContextMessageEntry {
  return {
    id,
    role,
    content,
    tokenCount,
    createdAt: new Date(createdAt),
  };
}

describe("thread-context-service", () => {
  test("serializes and parses conversation context with summary and multiline content", () => {
    const input = {
      summary: "Summary line 1\nSummary line 2",
      messages: [
        buildMessage("msg_1", "USER", "Line A\nLine B", 10, "2026-02-15T10:00:00.000Z"),
        buildMessage("msg_2", "ASSISTANT", "Answer paragraph", 14, "2026-02-15T10:01:00.000Z"),
      ],
    };

    const serialized = serializeConversationContext(input);
    const parsed = parseConversationContext(serialized);

    expect(parsed.summary).toBe(input.summary);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]?.content).toBe("Line A\nLine B");
    expect(parsed.messages[1]?.role).toBe("ASSISTANT");
  });

  test("getOrCreateContext lazily backfills from legacy summary and unsummarized messages", async () => {
    let createData: Record<string, unknown> | null = null;
    const createdRow = {
      threadId: "thread_1",
      baseContext: "",
      conversationContext: "",
      conversationTokenCount: 0,
      messageCount: 0,
      lastMessageId: null,
    };

    const db = {
      chatThreadContext: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return {
            ...createdRow,
            ...data,
          };
        },
        update: async () => createdRow,
        updateMany: async () => ({ count: 0 }),
      },
      chatMessage: {
        findMany: async () => [
          {
            id: "msg_tail",
            role: "USER" as const,
            content: "Unsummarized question",
            tokenCount: 12,
            createdAt: new Date("2026-02-15T11:00:00.000Z"),
          },
        ],
      },
    };

    const context = await getOrCreateContext({
      db,
      thread: {
        id: "thread_1",
        summary: "Legacy summary block",
        summaryUpTo: new Date("2026-02-15T10:30:00.000Z"),
        project: {
          name: "Project Alpha",
          description: "Description",
          aiInstructions: "Always concise",
        },
      },
    });

    expect(context.threadId).toBe("thread_1");
    expect(context.messageCount).toBe(1);
    expect(context.lastMessageId).toBe("msg_tail");
    expect(typeof createData?.baseContext).toBe("string");
    expect((createData?.baseContext as string).includes("Project Alpha")).toBe(true);

    const parsed = parseConversationContext(context.conversationContext);
    expect(parsed.summary).toBe("Legacy summary block");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]?.id).toBe("msg_tail");
  });

  test("appendMessageToContext uses idempotent lastMessageId guard", async () => {
    let row = {
      threadId: "thread_1",
      baseContext: "base",
      conversationContext: serializeConversationContext({
        summary: null,
        messages: [],
      }),
      conversationTokenCount: 0,
      messageCount: 0,
      lastMessageId: null as string | null,
    };

    const db = {
      chatThreadContext: {
        findUnique: async () => ({ ...row }),
        create: async () => row,
        update: async () => row,
        updateMany: async ({
          where,
          data,
        }: {
          where: { lastMessageId: string | null };
          data: {
            conversationContext: string;
            conversationTokenCount: number;
            messageCount: number;
            lastMessageId: string;
          };
        }) => {
          if (where.lastMessageId !== row.lastMessageId) {
            return { count: 0 };
          }
          row = { ...row, ...data };
          return { count: 1 };
        },
      },
      chatMessage: {
        findMany: async () => [],
      },
    };

    const message = buildMessage(
      "msg_1",
      "USER",
      "hello",
      2,
      "2026-02-15T12:00:00.000Z",
    );

    const first = await appendMessageToContext({
      db,
      threadId: "thread_1",
      message,
    });
    const second = await appendMessageToContext({
      db,
      threadId: "thread_1",
      message,
    });

    expect(first.messageCount).toBe(1);
    expect(second.messageCount).toBe(1);
    expect(second.lastMessageId).toBe("msg_1");

    const parsed = parseConversationContext(second.conversationContext);
    expect(parsed.messages).toHaveLength(1);
  });

  test("summarizeContextIfOverBudget compacts old messages and keeps recency window", async () => {
    const messages = [
      buildMessage("m1", "USER", "one", 20, "2026-02-15T01:00:00.000Z"),
      buildMessage("m2", "ASSISTANT", "two", 20, "2026-02-15T01:01:00.000Z"),
      buildMessage("m3", "USER", "three", 20, "2026-02-15T01:02:00.000Z"),
      buildMessage("m4", "ASSISTANT", "four", 20, "2026-02-15T01:03:00.000Z"),
      buildMessage("m5", "USER", "five", 20, "2026-02-15T01:04:00.000Z"),
    ];

    let updatedRow = {
      threadId: "thread_1",
      baseContext: "base",
      conversationContext: serializeConversationContext({
        summary: null,
        messages,
      }),
      conversationTokenCount: 100,
      messageCount: 5,
      lastMessageId: "m5" as string | null,
    };

    const db = {
      chatThreadContext: {
        findUnique: async () => updatedRow,
        create: async () => updatedRow,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updatedRow = {
            ...updatedRow,
            ...data,
          } as typeof updatedRow;
          return updatedRow;
        },
        updateMany: async () => ({ count: 1 }),
      },
      chatMessage: {
        findMany: async () => [],
      },
    };

    const result = await summarizeContextIfOverBudget({
      db,
      context: updatedRow,
      tokenCap: 40,
      summarize: async (toSummarize) =>
        `summary(${toSummarize.map((message) => message.id).join(",")})`,
    });

    expect(result.summary).toContain("summary(");
    expect(result.summaryUpTo?.toISOString()).toBe("2026-02-15T01:02:00.000Z");
    expect(result.context.messageCount).toBe(2);

    const prompt = formatPromptFromContext({
      baseContext: result.context.baseContext,
      conversationContext: result.context.conversationContext,
    });
    expect(prompt.includes("Previous conversation summary:")).toBe(true);
    expect(prompt.includes("User: five")).toBe(true);
  });
});
