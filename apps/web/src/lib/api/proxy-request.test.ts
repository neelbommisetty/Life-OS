import { describe, expect, test } from "bun:test";
import { getProxyBodyAndNormalizeHeaders } from "./proxy-request";

describe("getProxyBodyAndNormalizeHeaders", () => {
  test("strips content headers for empty non-GET body", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "content-length": "0",
      },
      body: "",
    });
    const headers = new Headers(request.headers);

    const body = await getProxyBodyAndNormalizeHeaders(request, headers);

    expect(body).toBeUndefined();
    expect(headers.has("content-type")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
  });

  test("keeps headers and body for non-empty non-GET body", async () => {
    const request = new Request("http://localhost:3000/api/auth/update-user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Neel" }),
    });
    const headers = new Headers(request.headers);

    const body = await getProxyBodyAndNormalizeHeaders(request, headers);

    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(headers.get("content-type")).toBe("application/json");
  });
});
