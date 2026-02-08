import { describe, expect, test } from "bun:test";
import { toApiError } from "./errors.js";

describe("toApiError", () => {
  test("maps missing environment variable errors to 503", () => {
    const apiError = toApiError(
      new Error("DATABASE_URL environment variable is not set"),
    );

    expect(apiError.status).toBe(503);
    expect(apiError.code).toBe("service_unavailable");
    expect(apiError.message).toBe("DATABASE_URL environment variable is not set");
  });

  test("maps AI API key configuration errors to 503", () => {
    const apiError = toApiError(
      new Error(
        "OpenAI API key is not configured. Provide credentials when creating the model or call setOpenAIDefaults() before registering models.",
      ),
    );

    expect(apiError.status).toBe(503);
    expect(apiError.code).toBe("service_unavailable");
    expect(apiError.message).toBe(
      "AI provider credentials are not configured on the server",
    );
  });

  test("keeps unknown errors as 500", () => {
    const apiError = toApiError(new Error("boom"));

    expect(apiError.status).toBe(500);
    expect(apiError.code).toBe("internal_error");
    expect(apiError.message).toBe("boom");
  });
});
