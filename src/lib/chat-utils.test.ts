import { describe, test as it, expect } from "bun:test";
import {
  estimateTokens,
  buildSystemPrompt,
  formatMessagesForAI,
  calculateHistoryTokens,
  buildSummarizationPrompt,
  extractTasksFromMessage,
  isApproval,
} from "./chat-utils";
import type { ChatMessage, Project } from "@prisma/client";

describe("Chat Utils", () => {
  describe("estimateTokens", () => {
    it("estimates tokens correctly", () => {
      expect(estimateTokens("test")).toBe(1); // 4 chars = 1 token
      expect(estimateTokens("hello world")).toBe(3); // 11 chars = ~3 tokens
      expect(estimateTokens("a".repeat(100))).toBe(25); // 100 chars = 25 tokens
    });

    it("handles empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });
  });

  describe("buildSystemPrompt", () => {
    it("builds prompt with project details", () => {
      const project = {
        id: "test-id",
        name: "Test Project",
        description: "A test project",
        status: "IN_PROGRESS",
        priority: "HIGH",
        tags: ["test", "demo"],
        color: null,
        icon: null,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Project;

      const prompt = buildSystemPrompt(project);

      expect(prompt).toContain("Test Project");
      expect(prompt).toContain("IN_PROGRESS");
      expect(prompt).toContain("HIGH");
      expect(prompt).toContain("A test project");
      expect(prompt).toContain("test, demo");
    });

    it("handles missing optional fields", () => {
      const project = {
        id: "test-id",
        name: "Minimal Project",
        description: null,
        status: "IDEA",
        priority: null,
        tags: [],
        color: null,
        icon: null,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Project;

      const prompt = buildSystemPrompt(project);

      expect(prompt).toContain("Minimal Project");
      expect(prompt).toContain("IDEA");
      expect(prompt).toContain("Not set");
      expect(prompt).toContain("No description");
    });
  });

  describe("formatMessagesForAI", () => {
    it("formats messages without summary", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          threadId: "thread-1",
          role: "USER",
          content: "Hello",
          createdAt: new Date(),
        },
        {
          id: "2",
          threadId: "thread-1",
          role: "ASSISTANT",
          content: "Hi there!",
          createdAt: new Date(),
        },
      ];

      const formatted = formatMessagesForAI("System prompt", messages);

      expect(formatted).toContain("System prompt");
      expect(formatted).toContain("User: Hello");
      expect(formatted).toContain("Assistant: Hi there!");
      expect(formatted).not.toContain("summary");
    });

    it("includes summary when provided", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          threadId: "thread-1",
          role: "USER",
          content: "New message",
          createdAt: new Date(),
        },
      ];

      const formatted = formatMessagesForAI(
        "System prompt",
        messages,
        "This is a summary"
      );

      expect(formatted).toContain("System prompt");
      expect(formatted).toContain("Previous conversation summary");
      expect(formatted).toContain("This is a summary");
      expect(formatted).toContain("User: New message");
    });
  });

  describe("calculateHistoryTokens", () => {
    it("calculates total tokens correctly", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          threadId: "thread-1",
          role: "USER",
          content: "test", // 1 token
          createdAt: new Date(),
        },
        {
          id: "2",
          threadId: "thread-1",
          role: "ASSISTANT",
          content: "hello world", // 3 tokens
          createdAt: new Date(),
        },
      ];

      const total = calculateHistoryTokens(messages);
      expect(total).toBe(4);
    });

    it("handles empty messages array", () => {
      expect(calculateHistoryTokens([])).toBe(0);
    });
  });

  describe("buildSummarizationPrompt", () => {
    it("builds summarization prompt", () => {
      const messages: ChatMessage[] = [
        {
          id: "1",
          threadId: "thread-1",
          role: "USER",
          content: "What is AI?",
          createdAt: new Date(),
        },
        {
          id: "2",
          threadId: "thread-1",
          role: "ASSISTANT",
          content: "AI stands for Artificial Intelligence.",
          createdAt: new Date(),
        },
      ];

      const prompt = buildSummarizationPrompt(messages);

      expect(prompt).toContain("concise summary");
      expect(prompt).toContain("User: What is AI?");
      expect(prompt).toContain("Assistant: AI stands for Artificial Intelligence.");
    });
  });

  describe("extractTasksFromMessage", () => {
    it("extracts tasks from valid JSON block", () => {
      const content = `Sure, I can help with that.
\`\`\`json
{
  "tasks": [
    {
      "title": "Task 1",
      "status": "TODO"
    },
    {
      "title": "Task 2"
    }
  ]
}
\`\`\`
Let me know if this looks good.`;

      const tasks = extractTasksFromMessage(content);
      expect(tasks).toBeArray();
      expect(tasks).toHaveLength(2);
      expect(tasks![0].title).toBe("Task 1");
      expect(tasks![1].title).toBe("Task 2");
    });

    it("returns null if no JSON block found", () => {
      const content = "Just some text without JSON.";
      const tasks = extractTasksFromMessage(content);
      expect(tasks).toBeNull();
    });

    it("returns null if JSON is invalid", () => {
      const content = `
\`\`\`json
{ "tasks": [ ... invalid ... ] }
\`\`\`
`;
      const tasks = extractTasksFromMessage(content);
      expect(tasks).toBeNull();
    });

    it("returns null if structure is incorrect", () => {
        const content = `
\`\`\`json
{ "notTasks": [] }
\`\`\`
`;
        const tasks = extractTasksFromMessage(content);
        expect(tasks).toBeNull();
    });
  });

  describe("isApproval", () => {
    it("returns true for approval phrases", () => {
      expect(isApproval("yes")).toBe(true);
      expect(isApproval("Yes")).toBe(true);
      expect(isApproval("approve")).toBe(true);
      expect(isApproval("ok")).toBe(true);
      expect(isApproval("do it")).toBe(true);
      expect(isApproval("create them")).toBe(true);
    });

    it("returns false for non-approval phrases", () => {
      expect(isApproval("no")).toBe(false);
      expect(isApproval("wait")).toBe(false);
      expect(isApproval("what?")).toBe(false);
      expect(isApproval("maybe later")).toBe(false);
      expect(isApproval("create something else")).toBe(false); // "create something else" doesn't match strict patterns
    });
  });
});

