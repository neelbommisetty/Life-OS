import { describe, expect, test } from "bun:test";
import { resolveApiBaseUrl } from "@/lib/api/base-url-resolver";

describe("resolveApiBaseUrl", () => {
  test("uses API_BASE_URL when provided", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "development",
        apiBaseUrl: "http://localhost:3001/",
        publicApiBaseUrl: "https://public.example.com",
      }),
    ).toBe("http://localhost:3001");
  });

  test("uses localhost API fallback in development when API_BASE_URL is missing", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "development",
        apiBaseUrl: "",
        publicApiBaseUrl: "https://public.example.com",
      }),
    ).toBe("http://localhost:3001");
  });

  test("uses NEXT_PUBLIC_API_BASE_URL in production when API_BASE_URL is missing", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "production",
        apiBaseUrl: "",
        publicApiBaseUrl: "https://api.example.com/",
      }),
    ).toBe("https://api.example.com");
  });

  test("throws in production when both API base URL vars are missing", () => {
    expect(() =>
      resolveApiBaseUrl({
        nodeEnv: "production",
        apiBaseUrl: "",
        publicApiBaseUrl: "",
      }),
    ).toThrow("API_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be set");
  });

  test("normalizes leading and trailing whitespace", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "production",
        apiBaseUrl: "  https://api.example.com/base/  ",
      }),
    ).toBe("https://api.example.com/base");
  });

  test("uses fallback in non-production when no vars are provided", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "test",
        apiBaseUrl: undefined,
        publicApiBaseUrl: undefined,
      }),
    ).toBe("http://localhost:3001");
  });

  test("treats whitespace-only values as missing", () => {
    expect(
      resolveApiBaseUrl({
        nodeEnv: "development",
        apiBaseUrl: "  ",
        publicApiBaseUrl: "  ",
      }),
    ).toBe("http://localhost:3001");
    expect(() =>
      resolveApiBaseUrl({
        nodeEnv: "production",
        apiBaseUrl: "  ",
        publicApiBaseUrl: "  ",
      }),
    ).toThrow("API_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be set");
  });
});
