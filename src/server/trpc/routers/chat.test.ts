import { describe, test as it, expect } from "bun:test";
import {
  getThreadSchema,
  listMessagesSchema,
  sendMessageSchema,
  setThreadModelSchema,
  listThreadsSchema,
  createThreadSchema,
  archiveThreadSchema,
} from "@/lib/validations/chat";

describe("Chat Validations", () => {
  describe("getThreadSchema", () => {
    it("validates valid project ID", () => {
      const input = { projectId: "clxyz123456789" };
      const result = getThreadSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid project ID", () => {
      const input = { projectId: "" };
      const result = getThreadSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing project ID", () => {
      const input = {};
      const result = getThreadSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("sendMessageSchema", () => {
    it("validates valid message", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        content: "Hello, AI!",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects empty content", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        content: "",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only content", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        content: "   ",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects content exceeding max length", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        content: "a".repeat(10001),
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts content at max length", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        content: "a".repeat(10000),
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("setThreadModelSchema", () => {
    it("validates valid model selection", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        modelKey: "openai.gpt-5-mini",
      };
      const result = setThreadModelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts auto model selection", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        modelKey: null,
      };
      const result = setThreadModelSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects missing model key", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        modelKey: "",
      };
      const result = setThreadModelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects invalid project ID", () => {
      const input = {
        projectId: "",
        modelKey: "openai.gpt-5-mini",
      };
      const result = setThreadModelSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("listMessagesSchema", () => {
    it("validates basic pagination input", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        limit: 40,
      };
      const result = listMessagesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts cursor with date", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        cursor: { id: "clxyz987654321", createdAt: new Date() },
      };
      const result = listMessagesSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects invalid limit", () => {
      const input = {
        projectId: "clxyz123456789",
        threadId: "clxyz987654321",
        limit: 0,
      };
      const result = listMessagesSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("listThreadsSchema", () => {
    it("validates basic list input", () => {
      const input = { projectId: "clxyz123456789" };
      const result = listThreadsSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("createThreadSchema", () => {
    it("accepts optional name", () => {
      const input = { projectId: "clxyz123456789", name: "Brainstorm" };
      const result = createThreadSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("archiveThreadSchema", () => {
    it("requires threadId", () => {
      const input = { projectId: "clxyz123456789", threadId: "clxyz987654321" };
      const result = archiveThreadSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});
