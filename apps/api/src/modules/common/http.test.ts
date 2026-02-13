import { beforeEach, describe, expect, test, mock } from "bun:test";

const capturedErrors: unknown[] = [];

mock.module("@sentry/node", () => ({
  captureException(error: unknown) {
    capturedErrors.push(error);
  },
}));

const { handleRouteError } = await import("./http.js");
const { badRequestError } = await import("./errors.js");

function createContext() {
  return {
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  };
}

describe("handleRouteError", () => {
  beforeEach(() => {
    capturedErrors.length = 0;
  });

  test("captures server errors and returns 500 payload", async () => {
    const response = handleRouteError(
      createContext() as Parameters<typeof handleRouteError>[0],
      new Error("boom"),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "internal_error",
      message: "boom",
    });
    expect(capturedErrors).toHaveLength(1);
  });

  test("does not capture client errors", async () => {
    const response = handleRouteError(
      createContext() as Parameters<typeof handleRouteError>[0],
      badRequestError("Invalid request"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_request",
      message: "Invalid request",
    });
    expect(capturedErrors).toHaveLength(0);
  });
});
