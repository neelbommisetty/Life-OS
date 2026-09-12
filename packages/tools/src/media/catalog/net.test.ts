import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogUnavailable } from "./adapter.ts";
import {
  BUDGET_MS,
  Budget,
  FakeTimer,
  HttpError,
  Net,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_CAP_MS,
  bodyMessage,
  clip,
  retryAfterMs,
  scrub,
  type FetchLike,
} from "./net.ts";

type Sent = { url: string; method: string; headers: Record<string, string>; body: string | null; signal: AbortSignal | null };

/** A fake source: answers from a queue, records what it was sent. A `hang` entry waits until the request's signal aborts. */
function fakeSource(responses: (Response | "hang")[] = []) {
  const sent: Sent[] = [];
  const queue = [...responses];
  const fetch: FetchLike = (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    sent.push({ url: String(input), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? init.body : null, signal: init?.signal ?? null });
    const next = queue.shift();
    if (!next) return Promise.reject(new Error(`fakeSource: no response queued for ${String(input)}`));
    if (next === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    return Promise.resolve(next);
  };
  return { fetch, sent, push: (response: Response | "hang") => queue.push(response) };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const text = (status: number, body: string, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });
/** Let the promise chains inside a request run to their next await. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const URL_ = "https://api.themoviedb.org/3/search/movie?query=Arrival";

// ---------------------------------------------------------------- requests

test("fetchJson GETs with accept: application/json under a timeout signal and returns the parsed body", async () => {
  const source = fakeSource([json(200, { results: [{ id: 329865 }] })]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const body = await net.fetchJson<{ results: { id: number }[] }>(URL_, { source: "TMDB" });
  assert.deepEqual(body, { results: [{ id: 329865 }] });
  assert.equal(source.sent.length, 1);
  assert.equal(source.sent[0]!.method, "GET");
  assert.equal(source.sent[0]!.url, URL_);
  assert.deepEqual(source.sent[0]!.headers, { accept: "application/json" });
  assert.ok(source.sent[0]!.signal instanceof AbortSignal, "a signal on every request");
  assert.equal(source.sent[0]!.body, null);
  assert.deepEqual(timer.waits, [REQUEST_TIMEOUT_MS], "one 20 second timeout was armed");
  assert.equal(timer.pending, 0, "and cleared once the body was read");
  assert.equal(net.timeoutMs, REQUEST_TIMEOUT_MS);
  assert.equal(net.retryAfterCapMs, RETRY_AFTER_CAP_MS);
});

test("a POST with an object body is JSON-encoded with its content type; a string body goes as is with the caller's headers, lower-cased", async () => {
  const source = fakeSource([json(200, { access_token: "t" }), json(200, [{ id: 1 }])]);
  const net = new Net({ fetch: source.fetch, timer: new FakeTimer() });
  await net.fetchJson("https://id.twitch.tv/oauth2/token", { method: "POST", body: { client_id: "abc", grant_type: "client_credentials" } });
  assert.equal(source.sent[0]!.method, "POST");
  assert.equal(source.sent[0]!.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(source.sent[0]!.body!), { client_id: "abc", grant_type: "client_credentials" });

  await net.fetchJson("https://api.igdb.com/v4/games", { method: "POST", body: 'fields name; search "Hades";', headers: { "Client-ID": "abc", Authorization: "Bearer tok", "Content-Type": "text/plain" } });
  assert.equal(source.sent[1]!.body, 'fields name; search "Hades";');
  assert.deepEqual(source.sent[1]!.headers, { accept: "application/json", "client-id": "abc", authorization: "Bearer tok", "content-type": "text/plain" });
});

test("a 2xx that is not JSON is CatalogUnavailable: the source did not answer as itself", async () => {
  const source = fakeSource([text(200, "<html>maintenance</html>"), text(200, "")]);
  const net = new Net({ fetch: source.fetch, timer: new FakeTimer() });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.message, "TMDB answered with something other than JSON");
    assert.equal(error.status, 200);
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), CatalogUnavailable, "an empty body too");
});

// ---------------------------------------------------------------- 429

test("a 429 is retried once after Retry-After seconds, on the injected timer, and the retry's answer is returned", async () => {
  const source = fakeSource([json(429, { status_message: "Slow down" }, { "retry-after": "2" }), json(200, { ok: true })]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const pending = net.fetchJson<{ ok: boolean }>(URL_, { source: "TMDB" });
  await tick();
  assert.equal(source.sent.length, 1, "waiting before the retry");
  assert.deepEqual(timer.waits, [REQUEST_TIMEOUT_MS, 2000], "the request timeout, then the two second wait");
  timer.advance(2000);
  assert.deepEqual(await pending, { ok: true });
  assert.equal(source.sent.length, 2);
  assert.equal(source.sent[1]!.url, URL_, "the same request again");
  assert.equal(timer.pending, 0);
});

test("Retry-After as an HTTP date waits until that moment on the timer's clock; a missing or unreadable header waits one second; every wait is capped", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  assert.equal(retryAfterMs("3", now), 3000);
  assert.equal(retryAfterMs("0.5", now), 500);
  assert.equal(retryAfterMs("Sat, 12 Sep 2026 12:00:04 GMT", now), 4000);
  assert.equal(retryAfterMs("Sat, 12 Sep 2026 11:00:00 GMT", now), 0, "a date in the past waits nothing");
  assert.equal(retryAfterMs(null, now), 1000);
  assert.equal(retryAfterMs("soon", now), 1000);
  assert.equal(retryAfterMs("", now), 1000);
  assert.equal(retryAfterMs("120", now), RETRY_AFTER_CAP_MS, "two minutes is cut to the cap");
  assert.equal(retryAfterMs("Sat, 12 Sep 2026 13:00:00 GMT", now), RETRY_AFTER_CAP_MS);
  assert.equal(retryAfterMs("120", now, 500), 500, "the cap is configurable");
});

test("a second 429 is CatalogUnavailable with status 429 and the source's message; the cap bounds the wait", async () => {
  const source = fakeSource([json(429, { status_message: "Slow down" }, { "retry-after": "3600" }), json(429, { status_message: "Still too fast" })]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer, retryAfterCapMs: 5000 });
  const pending = net.fetchJson(URL_, { source: "TMDB" });
  await tick();
  assert.equal(timer.waits[1], 5000, "an hour is cut to the configured cap");
  timer.advance(5000);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.status, 429);
    assert.equal(error.message, "TMDB is unavailable (HTTP 429): Still too fast");
    return true;
  });
  assert.equal(source.sent.length, 2, "exactly one retry");
});

test("the wait before a retry ends early when the signal aborts, with the budget's error", async () => {
  const source = fakeSource([json(429, {}, { "retry-after": "5" })]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const budget = net.budget(3000);
  const pending = net.fetchJson(URL_, { source: "TMDB", signal: budget.signal });
  await tick();
  assert.equal(timer.pending, 2, "the budget and the retry wait");
  timer.advance(3000);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.message, "The 3s lookup budget ran out");
    return true;
  });
  assert.equal(source.sent.length, 1, "no retry once the budget is gone");
  assert.equal(timer.pending, 0, "the wait was cleared");
});

// ---------------------------------------------------------------- status mapping

test("5xx is CatalogUnavailable with the status and the body's message", async () => {
  const source = fakeSource([json(503, { status_message: "The service is temporarily unavailable" }), text(502, "Bad Gateway", {}), new Response(null, { status: 500, statusText: "Internal Server Error" })]);
  const net = new Net({ fetch: source.fetch, timer: new FakeTimer() });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.status, 503);
    assert.equal(error.message, "TMDB is unavailable (HTTP 503): The service is temporarily unavailable");
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), { message: "TMDB is unavailable (HTTP 502): Bad Gateway" });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), { message: "TMDB is unavailable (HTTP 500): HTTP 500 Internal Server Error" });
});

test("other 4xx are HttpError with the status, the parsed body, and the body's message in each source's shape", async () => {
  const source = fakeSource([
    json(404, { status_code: 34, status_message: "The resource you requested could not be found." }),
    json(400, { error: "Bad query" }),
    json(401, [{ title: "Authorization Failure", status: 401, cause: "Expired access token" }]),
    json(403, { message: "Forbidden" }),
    text(400, "plain text\n  reason"),
    json(422, { code: 22 }),
  ]);
  const net = new Net({ fetch: source.fetch, timer: new FakeTimer() });
  await assert.rejects(net.fetchJson(URL_, { source: "TMDB" }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.ok(!(error instanceof CatalogUnavailable), "a refusal is not an outage");
    assert.equal(error.status, 404);
    assert.equal(error.message, "TMDB refused the request (HTTP 404): The resource you requested could not be found.");
    assert.deepEqual(error.body, { status_code: 34, status_message: "The resource you requested could not be found." });
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, { source: "Open Library" }), { message: "Open Library refused the request (HTTP 400): Bad query" });
  await assert.rejects(net.fetchJson(URL_, { source: "IGDB" }), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401, "an adapter reads the status to refresh its token");
    assert.equal(error.message, "IGDB refused the request (HTTP 401): Authorization Failure: Expired access token");
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, { source: "IGDB" }), { message: "IGDB refused the request (HTTP 403): Forbidden" });
  await assert.rejects(net.fetchJson(URL_, { source: "IGDB" }), { message: "IGDB refused the request (HTTP 400): plain text reason" });
  await assert.rejects(net.fetchJson(URL_, { source: "IGDB" }), { message: "IGDB refused the request (HTTP 422): HTTP 422" });
});

test("bodyMessage reads the common shapes and falls back to the text", () => {
  assert.equal(bodyMessage({ status_message: "x" }, ""), "x");
  assert.equal(bodyMessage({ message: " spaced " }, ""), "spaced");
  assert.equal(bodyMessage({ error: "oops" }, ""), "oops");
  assert.equal(bodyMessage({ error: { message: "nested" } }, ""), "nested");
  assert.equal(bodyMessage({ error_description: "bad secret" }, ""), "bad secret");
  assert.equal(bodyMessage([{ title: "Syntax Error", cause: "Expecting a field" }], ""), "Syntax Error: Expecting a field");
  assert.equal(bodyMessage([{ title: "Syntax Error" }], ""), "Syntax Error");
  assert.equal(bodyMessage(["a string"], ""), "a string");
  assert.equal(bodyMessage({ code: 1 }, "ignored when the body parsed"), "");
  assert.equal(bodyMessage(undefined, " raw \n text "), "raw text");
  assert.equal(bodyMessage(null, ""), "");
});

test("a network failure is CatalogUnavailable naming the source, or the host when no source name was given", async () => {
  const offline = new Net({
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    timer: new FakeTimer(),
  });
  await assert.rejects(offline.fetchJson(URL_, { source: "TMDB" }), (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.message, "Could not reach TMDB: fetch failed");
    assert.equal(error.status, undefined);
    return true;
  });
  await assert.rejects(offline.fetchJson(URL_), { message: "Could not reach api.themoviedb.org: fetch failed" });
  await assert.rejects(offline.fetchJson("not a url"), { message: "Could not reach the catalog: fetch failed" });
});

test("a request that does not answer within the timeout is CatalogUnavailable saying so, and the fetch is aborted", async () => {
  const source = fakeSource(["hang"]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const pending = net.fetchJson(URL_, { source: "TMDB" });
  timer.advance(REQUEST_TIMEOUT_MS - 1);
  await tick();
  assert.equal(source.sent[0]!.signal!.aborted, false, "not yet");
  timer.advance(1);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailable);
    assert.equal(error.message, "TMDB did not answer within 20s");
    return true;
  });
  assert.equal(source.sent[0]!.signal!.aborted, true);

  const quick = new Net({ fetch: fakeSource(["hang"]).fetch, timer, timeoutMs: 500 });
  const short = quick.fetchJson(URL_, { source: "IGDB" });
  timer.advance(500);
  await assert.rejects(short, { message: "IGDB did not answer within 1s" });
});

// ---------------------------------------------------------------- budget

test("a Budget aborts its signal with the budget's CatalogUnavailable when the time is up, reports remaining time, and release stops the clock", () => {
  const timer = new FakeTimer();
  const budget = new Budget(BUDGET_MS, timer);
  assert.equal(budget.ms, BUDGET_MS);
  assert.equal(budget.exhausted, false);
  assert.equal(budget.remainingMs, BUDGET_MS);
  timer.advance(15_000);
  assert.equal(budget.remainingMs, 5_000);
  assert.equal(budget.exhausted, false);
  timer.advance(5_000);
  assert.equal(budget.exhausted, true);
  assert.equal(budget.remainingMs, 0);
  assert.ok(budget.signal.aborted);
  assert.ok(budget.signal.reason instanceof CatalogUnavailable);
  assert.equal((budget.signal.reason as Error).message, "The 20s lookup budget ran out");

  const released = new Budget(1000, timer);
  assert.equal(timer.pending, 1);
  released.release();
  assert.equal(timer.pending, 0);
  timer.advance(2000);
  assert.equal(released.exhausted, false, "a released budget never fires");

  const cancelled = new Budget(1000, timer);
  cancelled.cancel();
  assert.equal(cancelled.exhausted, true);
  assert.equal((cancelled.signal.reason as Error).message, "The lookup was cancelled");
  assert.equal(timer.pending, 0);
});

test("an already-exhausted budget is refused before anything is sent; one that runs out mid-request ends the request with its own error", async () => {
  const source = fakeSource(["hang", json(200, {})]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const budget = net.budget();
  assert.equal(budget.ms, BUDGET_MS);
  const pending = net.fetchJson(URL_, { source: "TMDB", signal: budget.signal });
  await tick();
  timer.advance(BUDGET_MS);
  await assert.rejects(pending, (error: unknown) => error === budget.signal.reason);
  assert.equal(budget.exhausted, true);
  assert.equal(source.sent.length, 1);
  assert.equal(source.sent[0]!.signal!.aborted, true, "the fetch was cancelled with the budget");

  await assert.rejects(net.fetchJson(URL_, { source: "TMDB", signal: budget.signal }), (error: unknown) => error === budget.signal.reason);
  assert.equal(source.sent.length, 1, "nothing was sent on an exhausted budget");
  assert.equal(timer.pending, 0, "no timer left behind");
});

test("several requests share one budget: the first uses part of it, the second gets what is left", async () => {
  const source = fakeSource([json(200, { first: true }), "hang"]);
  const timer = new FakeTimer();
  const net = new Net({ fetch: source.fetch, timer });
  const budget = net.budget(10_000);
  assert.deepEqual(await net.fetchJson(URL_, { source: "TMDB", signal: budget.signal }), { first: true });
  timer.advance(4_000);
  assert.equal(budget.remainingMs, 6_000);
  const second = net.fetchJson(URL_, { source: "TMDB", signal: budget.signal });
  timer.advance(6_000);
  await assert.rejects(second, { message: "The 10s lookup budget ran out" });
  assert.equal(source.sent.length, 2);
  budget.release();
});

test("sleep waits on the timer and ends early with the aborted error when the signal aborts", async () => {
  const timer = new FakeTimer();
  const net = new Net({ timer });
  let slept = false;
  const napping = net.sleep(250).then(() => {
    slept = true;
  });
  await tick();
  assert.equal(slept, false);
  assert.deepEqual(timer.waits, [250]);
  timer.advance(250);
  await napping;
  assert.equal(slept, true);

  const controller = new AbortController();
  const interrupted = net.sleep(1000, controller.signal, "IGDB");
  controller.abort(new CatalogUnavailable("budget gone"));
  await assert.rejects(interrupted, { message: "budget gone" });
  assert.equal(timer.pending, 0, "the wait was cleared");
  controller.abort();
  await assert.rejects(net.sleep(10, controller.signal, "IGDB"), { message: "budget gone" });
});

// ---------------------------------------------------------------- secrets

test("no bearer token, Client-ID, key-like header, or named secret reaches an error message, and messages stay a line's worth", async () => {
  const source = fakeSource([
    json(400, { status_message: "Bad token tok-secret-1 with client abc-client and key k-1234 and s3cr3t-value" }),
    json(500, { status_message: `x${"y".repeat(1000)}` }),
  ]);
  const net = new Net({
    fetch: async (input, init) => {
      try {
        return await source.fetch(input, init);
      } catch {
        throw new Error("fetch failed: tok-secret-1 rejected");
      }
    },
    timer: new FakeTimer(),
  });
  const request = { source: "IGDB", headers: { Authorization: "Bearer tok-secret-1", "Client-ID": "abc-client", "X-Api-Key": "k-1234" }, secrets: ["s3cr3t-value"] };
  await assert.rejects(net.fetchJson(URL_, request), (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.message, "IGDB refused the request (HTTP 400): Bad token [redacted] with client [redacted] and key [redacted] and [redacted]");
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, request), (error: unknown) => {
    assert.ok((error as Error).message.length <= 500, "messages stay a line's worth");
    return true;
  });
  await assert.rejects(net.fetchJson(URL_, request), { message: "Could not reach IGDB: fetch failed: [redacted] rejected" });
  assert.equal(scrub("a tok b", ["tok"]), "a [redacted] b");
  assert.equal(scrub("plain", []), "plain");
  assert.equal(clip("short"), "short");
  assert.equal(clip("x".repeat(600)).length, 500);
  assert.ok(clip("x".repeat(600)).endsWith("…"));
});

// ---------------------------------------------------------------- FakeTimer

test("FakeTimer fires due timers in time order as the clock advances and drops cleared ones", () => {
  const timer = new FakeTimer(1000);
  const fired: string[] = [];
  timer.setTimeout(() => fired.push("late"), 300);
  const early = timer.setTimeout(() => fired.push("early"), 100);
  const cleared = timer.setTimeout(() => fired.push("cleared"), 200);
  timer.setTimeout(() => fired.push("nested"), 150);
  timer.clearTimeout(cleared);
  assert.equal(timer.pending, 3);
  timer.advance(120);
  assert.deepEqual(fired, ["early"]);
  assert.equal(timer.now(), 1120);
  timer.advance(200);
  assert.deepEqual(fired, ["early", "nested", "late"]);
  assert.equal(timer.now(), 1320);
  assert.equal(timer.pending, 0);
  assert.deepEqual(timer.waits, [300, 100, 200, 150]);
  timer.clearTimeout(early);
  timer.setTimeout(() => fired.push("chained"), 0);
  timer.advance(0);
  assert.deepEqual(fired.at(-1), "chained");
});
