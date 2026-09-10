import { test } from "node:test";
import assert from "node:assert/strict";
import { CursorExpired, ProviderRejected, ProviderUnavailable } from "../adapter.ts";
import { CALENDAR_API, GoogleClient, type GoogleEvent } from "./client.ts";
import { NeedsReauth, type FetchLike, type TokenSource } from "./oauth.ts";

type Sent = { url: URL; method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null };

/** A fake Google Calendar API: answers from a queue, records what it was sent. */
function fakeApi(responses: Response[] = []) {
  const sent: Sent[] = [];
  const queue = [...responses];
  const fetch: FetchLike = async (input, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    sent.push({ url: new URL(String(input)), method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : null, signal: init?.signal ?? null });
    const next = queue.shift();
    if (!next) throw new Error(`fakeApi: no response queued for ${init?.method ?? "GET"} ${String(input)}`);
    return next;
  };
  return { fetch, sent, push: (response: Response) => queue.push(response) };
}

/** A token source handing out tokens in order and recording invalidations. */
function fakeTokens(tokens: string[] = ["tok-1", "tok-2", "tok-3"]) {
  const invalidated: string[] = [];
  const asked: string[] = [];
  let index = 0;
  const source: TokenSource = {
    async accessToken(accountId) {
      asked.push(accountId);
      return tokens[Math.min(index, tokens.length - 1)];
    },
    invalidate(accountId) {
      invalidated.push(accountId);
      index += 1;
    },
  };
  return { source, invalidated, asked };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const empty = (status: number): Response => new Response(null, { status });
const googleError = (status: number, message: string, reason?: string): Response =>
  json(status, { error: { code: status, message, errors: reason ? [{ domain: "usageLimits", reason, message }] : [{ reason: "notFound", message }] } });

const ACCOUNT = "a_test000001";
const CALENDAR = "neel@example.com";
const event: GoogleEvent = { id: "evt1", etag: '"etag-1"', summary: "Dentist", start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-10T10:00:00-07:00" } };

function client(api: ReturnType<typeof fakeApi>, tokens = fakeTokens()): GoogleClient {
  return new GoogleClient({ tokens: tokens.source, fetch: api.fetch });
}

const params = (url: URL): Record<string, string> => Object.fromEntries(url.searchParams.entries());

// ---------------------------------------------------------------- parameter construction

test("events.list: the first page of a full sync carries timeMin and the fixed parameters, later pages the pageToken, incremental the syncToken", async () => {
  const api = fakeApi([
    json(200, { items: [event], nextPageToken: "p2" }),
    json(200, { items: [], nextSyncToken: "sync-A", timeZone: "America/Los_Angeles" }),
    json(200, { items: [{ ...event, status: "cancelled" }], nextSyncToken: "sync-B" }),
  ]);
  const google = client(api);

  const first = await google.events.list(ACCOUNT, CALENDAR, { timeMin: "2025-09-09T00:00:00Z", syncToken: null, pageToken: null });
  assert.deepEqual(first, { items: [event], nextPageToken: "p2", nextSyncToken: null, timeZone: null });
  assert.equal(api.sent[0].method, "GET");
  assert.equal(api.sent[0].url.origin + api.sent[0].url.pathname, `${CALENDAR_API}/calendars/${encodeURIComponent(CALENDAR)}/events`);
  assert.deepEqual(params(api.sent[0].url), { singleEvents: "false", showDeleted: "true", maxResults: "250", timeMin: "2025-09-09T00:00:00Z" });
  assert.equal(api.sent[0].headers.authorization, "Bearer tok-1");
  assert.equal(api.sent[0].headers.accept, "application/json");
  assert.ok(api.sent[0].signal instanceof AbortSignal, "a timeout signal on every request");

  const second = await google.events.list(ACCOUNT, CALENDAR, { timeMin: "2025-09-09T00:00:00Z", syncToken: null, pageToken: "p2" });
  assert.deepEqual(second, { items: [], nextPageToken: null, nextSyncToken: "sync-A", timeZone: "America/Los_Angeles" });
  assert.deepEqual(params(api.sent[1].url), { singleEvents: "false", showDeleted: "true", maxResults: "250", pageToken: "p2" }, "no timeMin after the first page");

  const incremental = await google.events.list(ACCOUNT, CALENDAR, { timeMin: "2025-09-09T00:00:00Z", syncToken: "sync-A", pageToken: null });
  assert.equal(incremental.nextSyncToken, "sync-B");
  assert.equal(incremental.items[0].status, "cancelled");
  assert.deepEqual(params(api.sent[2].url), { singleEvents: "false", showDeleted: "true", maxResults: "250", syncToken: "sync-A" }, "syncToken and never timeMin");
});

test("calendarList.list follows page tokens, asks for hidden entries, and concatenates", async () => {
  const api = fakeApi([
    json(200, { items: [{ id: "neel@example.com", summary: "Personal", accessRole: "owner", primary: true }], nextPageToken: "next" }),
    json(200, { items: [{ id: "holidays#group", summary: "Holidays", accessRole: "reader", hidden: true }] }),
  ]);
  const entries = await client(api).calendarList.list(ACCOUNT);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["neel@example.com", "holidays#group"],
  );
  assert.equal(api.sent[0].url.pathname, "/calendar/v3/users/me/calendarList");
  assert.deepEqual(params(api.sent[0].url), { showHidden: "true", maxResults: "250" });
  assert.deepEqual(params(api.sent[1].url), { showHidden: "true", maxResults: "250", pageToken: "next" });
});

test("events.insert posts the body with sendUpdates=none and returns the readback", async () => {
  const api = fakeApi([json(200, { ...event, id: "new1", etag: '"e-new"', extendedProperties: { private: { lifeId: "e_abc1234567" } } })]);
  const body = { summary: "Dentist", start: event.start, end: event.end, extendedProperties: { private: { lifeId: "e_abc1234567" } } };
  const created = await client(api).events.insert(ACCOUNT, CALENDAR, body);
  assert.equal(created.id, "new1");
  assert.equal(created.extendedProperties?.private?.lifeId, "e_abc1234567");
  const [sent] = api.sent;
  assert.equal(sent.method, "POST");
  assert.equal(sent.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`);
  assert.deepEqual(params(sent.url), { sendUpdates: "none" });
  assert.equal(sent.headers["content-type"], "application/json");
  assert.deepEqual(sent.body, body);
});

test("events.patch sends PATCH with If-Match and sendUpdates=none; an empty etag sends no guard", async () => {
  const api = fakeApi([json(200, { ...event, summary: "Dentist (moved)", etag: '"etag-2"' }), json(200, event)]);
  const google = client(api);
  const patched = await google.events.patch(ACCOUNT, CALENDAR, "evt/1", { summary: "Dentist (moved)", description: null }, '"etag-1"');
  assert.equal(patched.etag, '"etag-2"');
  const [sent] = api.sent;
  assert.equal(sent.method, "PATCH");
  assert.equal(sent.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/${encodeURIComponent("evt/1")}`);
  assert.deepEqual(params(sent.url), { sendUpdates: "none" });
  assert.equal(sent.headers["if-match"], '"etag-1"');
  assert.deepEqual(sent.body, { summary: "Dentist (moved)", description: null });

  await google.events.patch(ACCOUNT, CALENDAR, "evt1", { summary: "x" }, "");
  assert.equal(api.sent[1].headers["if-match"], undefined);
});

test("events.delete sends DELETE with sendUpdates=none and accepts a 204", async () => {
  const api = fakeApi([empty(204)]);
  await client(api).events.delete(ACCOUNT, CALENDAR, "evt1");
  const [sent] = api.sent;
  assert.equal(sent.method, "DELETE");
  assert.equal(sent.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/evt1`);
  assert.deepEqual(params(sent.url), { sendUpdates: "none" });
  assert.equal(sent.body, null);
});

test("events.move posts to the event's move endpoint with the destination and sendUpdates=none, no body, and returns the readback", async () => {
  const api = fakeApi([json(200, { ...event, etag: '"etag-moved"', organizer: { email: "side@group.calendar.google.com" } })]);
  const moved = await client(api).events.move(ACCOUNT, CALENDAR, "evt/1", "side@group.calendar.google.com");
  assert.equal(moved.id, "evt1");
  assert.equal(moved.etag, '"etag-moved"');
  const [sent] = api.sent;
  assert.equal(sent.method, "POST");
  assert.equal(sent.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/${encodeURIComponent("evt/1")}/move`);
  assert.deepEqual(params(sent.url), { destination: "side@group.calendar.google.com", sendUpdates: "none" });
  assert.equal(sent.body, null);
  assert.equal(sent.headers["content-type"], undefined);
});

test("events.byICalUID lists the master and its exception rows by iCalUID without expanding the rule, cancelled rows included, following page tokens", async () => {
  const api = fakeApi([
    json(200, { items: [{ ...event, recurrence: ["RRULE:FREQ=WEEKLY"], iCalUID: "uid1@google.com" }], nextPageToken: "p2" }),
    json(200, { items: [{ ...event, id: "evt1_20260917T160000Z", recurringEventId: "evt1", status: "cancelled", iCalUID: "uid1@google.com" }], nextSyncToken: "ignored" }),
  ]);
  const rows = await client(api).events.byICalUID(ACCOUNT, CALENDAR, "uid1@google.com");
  assert.deepEqual(rows.map((row) => [row.id, row.status ?? "confirmed"]), [["evt1", "confirmed"], ["evt1_20260917T160000Z", "cancelled"]]);
  assert.equal(api.sent[0].method, "GET");
  assert.equal(api.sent[0].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`);
  assert.deepEqual(params(api.sent[0].url), { iCalUID: "uid1@google.com", singleEvents: "false", showDeleted: "true", maxResults: "250" }, "no timeMin and no syncToken: this is a lookup, not a sync");
  assert.deepEqual(params(api.sent[1].url), { iCalUID: "uid1@google.com", singleEvents: "false", showDeleted: "true", maxResults: "250", pageToken: "p2" });
});

test("events.instances and events.get address the event and pass the narrowing parameters", async () => {
  const api = fakeApi([json(200, { items: [{ ...event, id: "evt1_20260910T160000Z", recurringEventId: "evt1" }] }), json(200, event)]);
  const google = client(api);
  const page = await google.events.instances(ACCOUNT, CALENDAR, "evt1", { originalStart: "2026-09-10T16:00:00Z" });
  assert.equal(page.items[0].recurringEventId, "evt1");
  assert.equal(api.sent[0].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/evt1/instances`);
  assert.deepEqual(params(api.sent[0].url), { maxResults: "250", showDeleted: "true", originalStart: "2026-09-10T16:00:00Z" });

  const got = await google.events.get(ACCOUNT, CALENDAR, "evt1");
  assert.equal(got.id, "evt1");
  assert.equal(api.sent[1].method, "GET");
  assert.equal(api.sent[1].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events/evt1`);
});

// ---------------------------------------------------------------- error mapping

test("410 on events.list is CursorExpired; 410 anywhere else is ProviderRejected with the status", async () => {
  const api = fakeApi([googleError(410, "Sync token is no longer valid, a full sync is required."), googleError(410, "Resource has been deleted")]);
  const google = client(api);
  await assert.rejects(google.events.list(ACCOUNT, CALENDAR, { timeMin: "2025-01-01T00:00:00Z", syncToken: "old", pageToken: null }), (error: Error) => {
    assert.ok(error instanceof CursorExpired);
    assert.match(error.message, /full sync is required/);
    return true;
  });
  await assert.rejects(google.events.delete(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error instanceof ProviderRejected);
    assert.equal(error.status, 410);
    assert.equal(error.message, "Resource has been deleted");
    return true;
  });
});

test("401 once: invalidate, refresh, retry with the new token; 401 twice: NeedsReauth for the account", async () => {
  const api = fakeApi([googleError(401, "Invalid Credentials"), json(200, event), googleError(401, "Invalid Credentials"), googleError(401, "Invalid Credentials")]);
  const tokens = fakeTokens(["tok-old", "tok-new", "tok-newer"]);
  const google = client(api, tokens);

  const got = await google.events.get(ACCOUNT, CALENDAR, "evt1");
  assert.equal(got.id, "evt1");
  assert.deepEqual(tokens.invalidated, [ACCOUNT]);
  assert.equal(api.sent[0].headers.authorization, "Bearer tok-old");
  assert.equal(api.sent[1].headers.authorization, "Bearer tok-new");

  await assert.rejects(google.events.get(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error instanceof NeedsReauth);
    assert.equal(error.accountId, ACCOUNT);
    return true;
  });
  assert.equal(api.sent.length, 4, "exactly one retry");
  assert.deepEqual(tokens.invalidated, [ACCOUNT, ACCOUNT]);
});

test("403 with a rate-limit reason, 429, and 5xx are ProviderUnavailable with the status", async () => {
  const api = fakeApi([
    googleError(403, "Rate Limit Exceeded", "rateLimitExceeded"),
    googleError(403, "User Rate Limit Exceeded", "userRateLimitExceeded"),
    googleError(429, "Too many requests"),
    googleError(503, "Backend Error", "backendError"),
    new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }),
  ]);
  const google = client(api);
  const call = () => google.events.get(ACCOUNT, CALENDAR, "evt1");
  for (const [status, pattern] of [
    [403, /Rate Limit Exceeded/],
    [403, /User Rate Limit Exceeded/],
    [429, /Too many requests/],
    [503, /Backend Error/],
    [502, /HTTP 502 Bad Gateway/],
  ] as const) {
    await assert.rejects(call(), (error: Error) => {
      assert.ok(error instanceof ProviderUnavailable, `${status} is unavailable`);
      assert.equal(error.status, status);
      assert.match(error.message, pattern);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      return true;
    });
  }
});

test("other 4xx are ProviderRejected carrying Google's message, a 403 without a rate-limit reason included", async () => {
  const api = fakeApi([
    googleError(404, "Not Found"),
    googleError(403, "You need to have writer access to this calendar.", "requiredAccessLevel"),
    googleError(412, "Precondition Failed", "conditionNotMet"),
    googleError(400, "The requested minimum modification time lies too far in the past.", "updatedMinTooLongAgo"),
    new Response("plain text failure", { status: 422 }),
  ]);
  const google = client(api);
  const expect = async (status: number, message: string) => {
    await assert.rejects(google.events.patch(ACCOUNT, CALENDAR, "evt1", { summary: "x" }, '"e"'), (error: Error) => {
      assert.ok(error instanceof ProviderRejected, `${status} is rejected`);
      assert.equal(error.status, status);
      assert.equal(error.message, message);
      return true;
    });
  };
  await expect(404, "Not Found");
  await expect(403, "You need to have writer access to this calendar.");
  await expect(412, "Precondition Failed");
  await expect(400, "The requested minimum modification time lies too far in the past.");
  await expect(422, "HTTP 422");
});

test("a network failure or timeout is ProviderUnavailable naming the host, and no token ever reaches an error message", async () => {
  const offline = new GoogleClient({
    tokens: fakeTokens(["secret-token"]).source,
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(offline.events.get(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.equal(error.message, "Could not reach www.googleapis.com: fetch failed");
    return true;
  });

  const hanging = new GoogleClient({
    tokens: fakeTokens(["secret-token"]).source,
    timeoutMs: 30,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  });
  await assert.rejects(hanging.events.get(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.match(error.message, /www\.googleapis\.com did not answer within 0s/);
    return true;
  });

  const echoing = fakeApi([googleError(400, "Bad token secret-token in request"), googleError(400, `x${"y".repeat(1000)}`)]);
  const google = new GoogleClient({ tokens: fakeTokens(["secret-token"]).source, fetch: echoing.fetch });
  await assert.rejects(google.events.get(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error instanceof ProviderRejected);
    assert.equal(error.message, "Bad token [redacted] in request");
    return true;
  });
  await assert.rejects(google.events.get(ACCOUNT, CALENDAR, "evt1"), (error: Error) => {
    assert.ok(error.message.length <= 500, "messages stay a line's worth");
    return true;
  });
});

test("the token source's own failures pass through untouched, so the adapter can mark the account", async () => {
  const api = fakeApi();
  const source: TokenSource = {
    async accessToken(accountId) {
      throw new NeedsReauth(accountId);
    },
    invalidate() {},
  };
  const google = new GoogleClient({ tokens: source, fetch: api.fetch });
  await assert.rejects(google.calendarList.list(ACCOUNT), (error: Error) => error instanceof NeedsReauth && error.accountId === ACCOUNT);
  assert.equal(api.sent.length, 0, "no request without a token");
});

test("a custom baseUrl is honoured and trailing slashes do not double up", async () => {
  const api = fakeApi([json(200, { items: [] })]);
  const google = new GoogleClient({ tokens: fakeTokens().source, fetch: api.fetch, baseUrl: "http://127.0.0.1:1/calendar/v3/" });
  await google.calendarList.list(ACCOUNT);
  assert.equal(api.sent[0].url.href.split("?")[0], "http://127.0.0.1:1/calendar/v3/users/me/calendarList");
});
