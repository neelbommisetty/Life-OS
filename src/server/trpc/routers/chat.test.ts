import { describe, test as it, expect } from "bun:test";
import { getThreadSchema, sendMessageSchema } from "@/lib/validations/chat";

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
        content: "Hello, AI!",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("rejects empty content", () => {
      const input = {
        projectId: "clxyz123456789",
        content: "",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only content", () => {
      const input = {
        projectId: "clxyz123456789",
        content: "   ",
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects content exceeding max length", () => {
      const input = {
        projectId: "clxyz123456789",
        content: "a".repeat(10001),
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts content at max length", () => {
      const input = {
        projectId: "clxyz123456789",
        content: "a".repeat(10000),
      };
      const result = sendMessageSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });
});

