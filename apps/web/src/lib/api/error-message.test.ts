import { describe, expect, test } from "bun:test";
import {
  getErrorMessage,
  readApiErrorMessageFromResponse,
} from "@/lib/api/error-message";

describe("getErrorMessage", () => {
  test("returns Error message when present", () => {
    expect(getErrorMessage(new Error("Boom"), "Fallback")).toBe("Boom");
  });

  test("returns fallback for non-Error values", () => {
    expect(getErrorMessage(null, "Fallback")).toBe("Fallback");
    expect(getErrorMessage("", "Fallback")).toBe("Fallback");
  });
});

describe("readApiErrorMessageFromResponse", () => {
  test("uses message from API payload", async () => {
    const response = new Response(JSON.stringify({ message: "Bad request" }), {
      status: 400,
      headers: {
        "content-type": "application/json",
      },
    });

    await expect(
      readApiErrorMessageFromResponse(response, "Fallback"),
    ).resolves.toBe("Bad request");
  });

  test("uses error from API payload when message is missing", async () => {
    const response = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: {
        "content-type": "application/json",
      },
    });

    await expect(
      readApiErrorMessageFromResponse(response, "Fallback"),
    ).resolves.toBe("Forbidden");
  });

  test("uses unauthorized fallback for 401 without payload", async () => {
    const response = new Response(null, {
      status: 401,
    });

    await expect(
      readApiErrorMessageFromResponse(response, "Fallback"),
    ).resolves.toBe("Unauthorized: Please sign in to continue");
  });

  test("uses provided fallback for non-json payloads", async () => {
    const response = new Response("not-json", {
      status: 500,
    });

    await expect(
      readApiErrorMessageFromResponse(response, "Fallback"),
    ).resolves.toBe("Fallback");
  });
});
