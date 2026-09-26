import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "./bridge.ts";
const origin = "http://127.0.0.1:4320";
const headers = {
  host: "127.0.0.1:4320",
  origin,
  "content-type": "application/json",
  "sec-fetch-site": "same-origin",
};
test("same-origin bridge forwards only todo operations, keeps credentials server-side and preserves rejection receipts", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:4319/v1/task.add");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer server-only",
    );
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      args: [{ title: "Read" }, { actor: "neel", key: "stable-key" }],
    });
    return Response.json({
      ok: true,
      result: {
        ok: false,
        outcome: "duplicate",
        issues: ["Already exists"],
        candidates: [],
      },
    });
  };
  const app = createBridge({
    url: "http://127.0.0.1:4319",
    token: "server-only",
    origins: [origin],
    fetch: fetcher,
  });
  const post = (op: string, overrides: Record<string, string> = {}) =>
    app.request(`${origin}/api/v1/${op}`, {
      method: "POST",
      headers: { ...headers, ...overrides },
      body: JSON.stringify({
        args: [{ title: "Read" }, { actor: "neel", key: "stable-key" }],
      }),
    });
  const result = await post("task.add");
  assert.equal(result.status, 200);
  const text = await result.text();
  assert.doesNotMatch(text, /server-only/);
  assert.equal(JSON.parse(text).result.outcome, "duplicate");
  for (const op of [
    "export",
    "system.migrate",
    "account.add",
    "event.add",
    "__proto__",
  ])
    assert.equal((await post(op)).status, 404);
  assert.equal(
    (await post("task.add", { origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await post("task.add", { origin: "" })).status, 403);
  assert.equal((await post("task.add", { host: "evil.example" })).status, 403);
  assert.equal(
    (await post("task.add", { "sec-fetch-site": "cross-site" })).status,
    403,
  );
  assert.equal(
    (await post("task.add", { "content-type": "text/plain" })).status,
    415,
  );
  assert.equal(calls, 1);
});
test("an uncertain upstream write is not retried and missing credentials fail clearly", async () => {
  let calls = 0;
  const app = createBridge({
    url: "http://127.0.0.1:4319",
    token: "token",
    origins: [origin],
    fetch: async () => {
      calls++;
      throw new Error("private detail");
    },
  });
  const result = await app.request(`${origin}/api/v1/task.complete`, {
    method: "POST",
    headers,
    body: '{"args":[]}',
  });
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
  const text = await result.text();
  assert.match(text, /may have saved/);
  assert.doesNotMatch(text, /private detail/);
  const missing = createBridge({
    url: "http://127.0.0.1:4319",
    token: "",
    origins: [origin],
  });
  assert.equal(
    (
      await missing.request(`${origin}/api/v1/task.list`, {
        method: "POST",
        headers,
        body: '{"args":[]}',
      })
    ).status,
    503,
  );
});
test("remote credentials cannot go over plaintext or credential-bearing URLs", () => {
  for (const url of [
    "http://api.example",
    "https://user:password@api.example",
    "file:///etc/passwd",
    "https://api.example?token=secret",
  ])
    assert.throws(() =>
      createBridge({ url, token: "secret", origins: [origin] }),
    );
});
