import { describe, test, expect } from "bun:test";
import {
  encodeSSE,
  parseSSELine,
  parseSSEChunk,
  handleStreamError,
  StreamError,
  type StreamEvent,
} from "@/lib/chat-utils";

describe("SSE Encoding", () => {
  test("encodes chunk event correctly", () => {
    const event: StreamEvent = { type: "chunk", text: "Hello" };
    const encoded = encodeSSE(event);
    expect(encoded).toBe('data: {"type":"chunk","text":"Hello"}\n\n');
  });

  test("encodes done event correctly", () => {
    const event: StreamEvent = { type: "done" };
    const encoded = encodeSSE(event);
    expect(encoded).toBe('data: {"type":"done"}\n\n');
  });

  test("encodes error event correctly", () => {
    const event: StreamEvent = { type: "error", error: "Something went wrong" };
    const encoded = encodeSSE(event);
    expect(encoded).toBe('data: {"type":"error","error":"Something went wrong"}\n\n');
  });

  test("encodes message_saved event correctly", () => {
    const event: StreamEvent = { type: "message_saved", messageId: "msg_123" };
    const encoded = encodeSSE(event);
    expect(encoded).toBe('data: {"type":"message_saved","messageId":"msg_123"}\n\n');
  });

  test("handles special characters in text", () => {
    const event: StreamEvent = { type: "chunk", text: 'Hello "world"\nNew line' };
    const encoded = encodeSSE(event);
    const decoded = JSON.parse(encoded.slice(6, -2)); // Remove 'data: ' and '\n\n'
    expect(decoded.text).toBe('Hello "world"\nNew line');
  });
});

describe("SSE Parsing - Single Line", () => {
  test("parses chunk event", () => {
    const line = 'data: {"type":"chunk","text":"Hello"}';
    const event = parseSSELine(line);
    expect(event).toEqual({ type: "chunk", text: "Hello" });
  });

  test("parses done event", () => {
    const line = 'data: {"type":"done"}';
    const event = parseSSELine(line);
    expect(event).toEqual({ type: "done" });
  });

  test("parses error event", () => {
    const line = 'data: {"type":"error","error":"Test error"}';
    const event = parseSSELine(line);
    expect(event).toEqual({ type: "error", error: "Test error" });
  });

  test("parses message_saved event", () => {
    const line = 'data: {"type":"message_saved","messageId":"abc123"}';
    const event = parseSSELine(line);
    expect(event).toEqual({ type: "message_saved", messageId: "abc123" });
  });

  test("returns null for non-data lines", () => {
    expect(parseSSELine("")).toBeNull();
    expect(parseSSELine(": comment")).toBeNull();
    expect(parseSSELine("event: test")).toBeNull();
    expect(parseSSELine("id: 123")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const line = "data: not valid json";
    const event = parseSSELine(line);
    expect(event).toBeNull();
  });

  test("returns null for invalid event type", () => {
    const line = 'data: {"type":"invalid"}';
    const event = parseSSELine(line);
    expect(event).toBeNull();
  });

  test("returns null for missing type", () => {
    const line = 'data: {"text":"no type"}';
    const event = parseSSELine(line);
    expect(event).toBeNull();
  });
});

describe("SSE Parsing - Chunk", () => {
  test("parses multiple events from chunk", () => {
    const chunk = `data: {"type":"chunk","text":"Hello"}

data: {"type":"chunk","text":" world"}

data: {"type":"done"}

`;
    const events = parseSSEChunk(chunk);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "chunk", text: "Hello" });
    expect(events[1]).toEqual({ type: "chunk", text: " world" });
    expect(events[2]).toEqual({ type: "done" });
  });

  test("handles empty chunk", () => {
    const events = parseSSEChunk("");
    expect(events).toHaveLength(0);
  });

  test("handles chunk with only whitespace", () => {
    const events = parseSSEChunk("   \n\n   ");
    expect(events).toHaveLength(0);
  });

  test("ignores invalid lines in chunk", () => {
    const chunk = `data: {"type":"chunk","text":"valid"}

: this is a comment
invalid line
data: {"type":"done"}
`;
    const events = parseSSEChunk(chunk);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "chunk", text: "valid" });
    expect(events[1]).toEqual({ type: "done" });
  });

  test("handles mixed valid and invalid JSON", () => {
    const chunk = `data: {"type":"chunk","text":"valid"}

data: invalid json
data: {"type":"done"}
`;
    const events = parseSSEChunk(chunk);
    expect(events).toHaveLength(2);
  });
});

describe("Stream Error Handling", () => {
  test("handles StreamError with STREAM_ABORTED code", () => {
    const error = new StreamError("Stream was aborted", "STREAM_ABORTED");
    const message = handleStreamError(error);
    expect(message).toBe("Canceled.");
  });

  test("handles StreamError with NETWORK_ERROR code", () => {
    const error = new StreamError("Network failed", "NETWORK_ERROR");
    const message = handleStreamError(error);
    expect(message).toBe("Couldn't reach the server. Try again.");
  });

  test("handles StreamError with PARSE_ERROR code", () => {
    const error = new StreamError("Parse failed", "PARSE_ERROR");
    const message = handleStreamError(error);
    expect(message).toBe("Couldn't read the response. Try again.");
  });

  test("handles StreamError with STREAM_ERROR code", () => {
    const error = new StreamError("General stream error", "STREAM_ERROR");
    const message = handleStreamError(error);
    expect(message).toBe("Couldn't stream the response. Try again.");
  });

  test("handles AbortError", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    const message = handleStreamError(error);
    expect(message).toBe("Canceled.");
  });

  test("handles generic Error", () => {
    const error = new Error("Something went wrong");
    const message = handleStreamError(error);
    expect(message).toBe("Something went wrong");
  });

  test("handles non-Error values", () => {
    expect(handleStreamError("string error")).toBe("Couldn't complete that request. Try again.");
    expect(handleStreamError(null)).toBe("Couldn't complete that request. Try again.");
    expect(handleStreamError(undefined)).toBe("Couldn't complete that request. Try again.");
    expect(handleStreamError(123)).toBe("Couldn't complete that request. Try again.");
  });
});

describe("StreamError class", () => {
  test("creates StreamError with correct properties", () => {
    const error = new StreamError("Test message", "STREAM_ABORTED");
    expect(error.message).toBe("Test message");
    expect(error.code).toBe("STREAM_ABORTED");
    expect(error.name).toBe("StreamError");
    expect(error instanceof Error).toBe(true);
    expect(error instanceof StreamError).toBe(true);
  });

  test("supports all error codes", () => {
    const codes = ["STREAM_ABORTED", "STREAM_ERROR", "PARSE_ERROR", "NETWORK_ERROR"] as const;
    for (const code of codes) {
      const error = new StreamError(`Error with ${code}`, code);
      expect(error.code).toBe(code);
    }
  });
});

describe("SSE Round-trip", () => {
  test("encode then parse returns original event", () => {
    const original: StreamEvent = { type: "chunk", text: "Hello world" };
    const encoded = encodeSSE(original);
    const lines = encoded.split("\n").filter(Boolean);
    const parsed = parseSSELine(lines[0]);
    expect(parsed).toEqual(original);
  });

  test("handles complex text content round-trip", () => {
    const complexText = `# Heading

Here's some **markdown** with:
- Lists
- \`code\`
- And "quotes"

\`\`\`typescript
const x = 42;
\`\`\``;

    const original: StreamEvent = { type: "chunk", text: complexText };
    const encoded = encodeSSE(original);
    const lines = encoded.split("\n").filter(Boolean);
    const parsed = parseSSELine(lines[0]);
    expect(parsed?.text).toBe(complexText);
  });

  test("handles unicode characters", () => {
    const unicodeText = "Hello 👋 世界 🌍 مرحبا";
    const original: StreamEvent = { type: "chunk", text: unicodeText };
    const encoded = encodeSSE(original);
    const lines = encoded.split("\n").filter(Boolean);
    const parsed = parseSSELine(lines[0]);
    expect(parsed?.text).toBe(unicodeText);
  });
});
