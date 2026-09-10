import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventPatch, EventWrite } from "../../contract.ts";
import { fixedClock } from "../../db/testing.ts";
import { CursorExpired, ProviderRejected } from "../adapter.ts";
import { CredentialStore } from "../credentials.ts";
import { CALENDAR_API } from "./client.ts";
import { GoogleAdapter } from "./index.ts";
import { GOOGLE_ENDPOINTS, type FetchLike } from "./oauth.ts";

const CONFIG = { clientId: "life-os.apps.googleusercontent.com", clientSecret: "GOCSPX-secret" };
const CLOCK = fixedClock("2026-09-09T12:00:00Z");
const ACCOUNT = "a_test0000001";
const CALENDAR_ID = "neel@example.com";

const roots: string[] = [];
async function tempStore(): Promise<CredentialStore> {
  const root = await mkdtemp(join(tmpdir(), "life-google-adapter-"));
  roots.push(root);
  return new CredentialStore(join(root, "google"));
}
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

type Sent = { url: URL; method: string; headers: Record<string, string>; body: unknown };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function empty(status: number): Response {
  return new Response(null, { status });
}

/**
 * One fake Google for both the token endpoint (answered directly, so every
 * test gets working access tokens without exercising the OAuth flow itself,
 * which oauth.test.ts already covers) and the Calendar API, answered from a
 * queue in call order. Every request is recorded.
 */
function fakeGoogle(responses: Response[] = []) {
  const sent: Sent[] = [];
  const queue = [...responses];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const rawBody = typeof init?.body === "string" ? init.body : null;
    const body = rawBody ? (headers["content-type"]?.includes("json") ? JSON.parse(rawBody) : Object.fromEntries(new URLSearchParams(rawBody))) : null;
    sent.push({ url, method: init?.method ?? "GET", headers, body });
    if (url.toString() === GOOGLE_ENDPOINTS.token && (body as Record<string, string> | null)?.grant_type === "refresh_token") {
      return json(200, { access_token: "access-token-1", expires_in: 3600, token_type: "Bearer" });
    }
    const next = queue.shift();
    if (!next) throw new Error(`fakeGoogle: no response queued for ${init?.method ?? "GET"} ${url}`);
    return next;
  };
  return { fetch, sent, push: (response: Response) => queue.push(response) };
}

async function adapterWithCredential(responses: Response[] = []) {
  const credentials = await tempStore();
  await credentials.write(ACCOUNT, { identity: "neel@example.com", refreshToken: "1//refresh-token", scopes: ["calendar.events"], obtainedAt: "2026-09-01T00:00:00Z" });
  const api = fakeGoogle(responses);
  const adapter = new GoogleAdapter({ credentials, clock: CLOCK, fetch: api.fetch, config: CONFIG });
  return { adapter, api, credentials };
}

function calendarCalls(sent: Sent[]): Sent[] {
  return sent.filter((s) => s.url.toString() !== GOOGLE_ENDPOINTS.token && s.url.toString() !== GOOGLE_ENDPOINTS.userinfo);
}

// ---------------------------------------------------------------- connect

test("connect runs the OAuth flow and stores the credential under a fresh provisional id", async () => {
  const credentials = await tempStore();
  const api = fakeGoogle();
  api.push(json(200, { access_token: "access-from-code", refresh_token: "1//new-refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/calendar.events" }));
  api.push(json(200, { email: "Neel@Example.com", email_verified: true }));

  const adapter = new GoogleAdapter({ credentials, clock: CLOCK, fetch: api.fetch, config: CONFIG });

  let consentUrl = "";
  let browser: Promise<Response> | null = null;
  const result = await adapter.connect({
    open: (url) => {
      consentUrl = url;
      const consent = new URL(url);
      const redirect = new URL(consent.searchParams.get("redirect_uri") ?? "");
      redirect.searchParams.set("state", consent.searchParams.get("state") ?? "");
      redirect.searchParams.set("code", "the-code");
      browser = fetch(redirect);
    },
  });

  assert.ok(consentUrl.startsWith(GOOGLE_ENDPOINTS.auth), "the consent URL goes to Google");
  await browser;
  assert.equal(result.identity, "neel@example.com", "the email is lowercased");
  assert.deepEqual(result.scopes, ["https://www.googleapis.com/auth/calendar.events"]);
  assert.match(result.credentialId, /^pending-/, "a provisional id, not an account id yet");

  const stored = await credentials.read(result.credentialId);
  assert.deepEqual(stored, { identity: "neel@example.com", refreshToken: "1//new-refresh", scopes: ["https://www.googleapis.com/auth/calendar.events"], obtainedAt: "2026-09-09T12:00:00Z" });
});

// ---------------------------------------------------------------- listCalendars

test("listCalendars maps every non-deleted entry and remembers each calendar's timezone", async () => {
  const { adapter, api } = await adapterWithCredential([
    json(200, {
      items: [
        { id: CALENDAR_ID, summary: "Neel", timeZone: "America/Los_Angeles", accessRole: "owner", primary: true },
        { id: "team@group.calendar.google.com", summary: "Team", timeZone: "America/New_York", accessRole: "reader", hidden: true },
        { id: "gone@group.calendar.google.com", summary: "Gone", deleted: true, accessRole: "reader" },
      ],
    }),
  ]);

  const calendars = await adapter.listCalendars(ACCOUNT);
  assert.deepEqual(calendars, [
    { id: CALENDAR_ID, name: "Neel", color: null, timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false },
    { id: "team@group.calendar.google.com", name: "Team", color: null, timezone: "America/New_York", writable: false, primary: false, hidden: true },
  ]);

  const calls = calendarCalls(api.sent);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/calendar/v3/users/me/calendarList");
});

// ---------------------------------------------------------------- syncPage

test("syncPage: a full sync from null, a follow-on page, then the sync cursor for next time", async () => {
  const { adapter, api } = await adapterWithCredential([
    json(200, {
      items: [{ id: "evt1", etag: '"e1"', summary: "Dentist", start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-10T10:00:00-07:00" } }],
      nextPageToken: "p2",
      timeZone: "America/Los_Angeles",
    }),
    json(200, { items: [], nextSyncToken: "sync-tok-1" }),
  ]);

  const first = await adapter.syncPage(ACCOUNT, CALENDAR_ID, null, "2025-09-09T00:00:00Z");
  assert.equal(first.done, false);
  assert.equal(first.nextCursor, "page:p2");
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items[0].start, { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" });
  assert.equal(first.items[0].external.id, "evt1");

  const calls = calendarCalls(api.sent);
  assert.equal(calls[0].url.searchParams.get("timeMin"), "2025-09-09T00:00:00Z");
  assert.equal(calls[0].url.searchParams.get("syncToken"), null);
  assert.equal(calls[0].url.searchParams.get("pageToken"), null);

  const second = await adapter.syncPage(ACCOUNT, CALENDAR_ID, first.nextCursor, "2025-09-09T00:00:00Z");
  assert.equal(second.done, true);
  assert.equal(second.nextCursor, "sync:sync-tok-1");
  assert.equal(second.items.length, 0);
  const callsAfterSecond = calendarCalls(api.sent);
  assert.equal(callsAfterSecond[1].url.searchParams.get("pageToken"), "p2");
  assert.equal(callsAfterSecond[1].url.searchParams.get("timeMin"), null, "no timeMin once a page token continues the fetch");
});

test("syncPage: an incremental sync passes the stored sync token, and a cursor Google rejects surfaces as CursorExpired", async () => {
  const { adapter, api } = await adapterWithCredential([json(200, { items: [], nextSyncToken: "sync-tok-2" }), json(410, { error: { code: 410, message: "Sync token is no longer valid" } })]);

  const page = await adapter.syncPage(ACCOUNT, CALENDAR_ID, "sync:sync-tok-1", "2025-09-09T00:00:00Z");
  assert.equal(page.nextCursor, "sync:sync-tok-2");
  const calls = calendarCalls(api.sent);
  assert.equal(calls[0].url.searchParams.get("syncToken"), "sync-tok-1");

  await assert.rejects(adapter.syncPage(ACCOUNT, CALENDAR_ID, "sync:sync-tok-2", "2025-09-09T00:00:00Z"), CursorExpired);
});

// ---------------------------------------------------------------- create

test("create stamps lifeId, uses the calendar's known timezone for a floating start, and maps the readback", async () => {
  const { adapter, api } = await adapterWithCredential([
    json(200, { items: [{ id: CALENDAR_ID, summary: "Neel", timeZone: "America/Los_Angeles", accessRole: "owner", primary: true }] }),
    json(200, {
      id: "new-evt",
      etag: '"e-new"',
      summary: "Dentist",
      status: "confirmed",
      start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      extendedProperties: { private: { lifeId: "e_abc0000001" } },
    }),
  ]);
  await adapter.listCalendars(ACCOUNT); // learn the calendar's timezone first, as accounts.ts does before writing

  const write: EventWrite = {
    title: "Dentist",
    notes: null,
    location: null,
    start: { at: "2026-09-10T16:00:00Z", timezone: null },
    end: { at: "2026-09-10T17:00:00Z", timezone: null },
    repeat: null,
    busy: true,
    status: "confirmed",
  };
  const created = await adapter.create(ACCOUNT, CALENDAR_ID, write, "e_abc0000001");

  assert.equal(created.external.id, "new-evt");
  assert.equal(created.lifeId, "e_abc0000001");
  assert.equal(created.title, "Dentist");

  const calls = calendarCalls(api.sent);
  const insert = calls[calls.length - 1];
  assert.equal(insert.method, "POST");
  assert.equal(insert.url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`);
  assert.equal(insert.url.searchParams.get("sendUpdates"), "none");
  const body = insert.body as Record<string, unknown>;
  assert.equal((body.extendedProperties as { private: Record<string, string> }).private.lifeId, "e_abc0000001");
  assert.equal((body.extendedProperties as { private: Record<string, string> }).private.lifeFloating, "true", "a floating start is stamped so it round-trips");
  assert.equal((body.start as Record<string, unknown>).timeZone, "America/Los_Angeles", "a floating write uses the calendar's zone, learned from listCalendars");
});

// ---------------------------------------------------------------- update

test("update sends only the changed fields guarded by the etag, and maps the readback", async () => {
  const { adapter, api } = await adapterWithCredential([
    json(200, {
      id: "evt1",
      etag: '"e2"',
      summary: "Dentist (moved)",
      status: "confirmed",
      start: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T11:00:00-07:00", timeZone: "America/Los_Angeles" },
    }),
  ]);

  const patch: EventPatch = { title: "Dentist (moved)" };
  const updated = await adapter.update(ACCOUNT, CALENDAR_ID, "evt1", patch, '"e1"');

  assert.equal(updated.title, "Dentist (moved)");
  const calls = calendarCalls(api.sent);
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/evt1`);
  assert.equal(calls[0].headers["if-match"], '"e1"');
  assert.deepEqual(calls[0].body, { summary: "Dentist (moved)" });
});

// ---------------------------------------------------------------- delete

test("delete calls the provider with sendUpdates=none and returns nothing", async () => {
  const { adapter, api } = await adapterWithCredential([empty(204)]);
  await adapter.delete(ACCOUNT, CALENDAR_ID, "evt1");
  const calls = calendarCalls(api.sent);
  assert.equal(calls[0].method, "DELETE");
  assert.equal(calls[0].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/evt1`);
  assert.equal(calls[0].url.searchParams.get("sendUpdates"), "none");
});

// ---------------------------------------------------------------- respond

test("respond patches Neel's own attendee entry, leaving the others alone", async () => {
  const { adapter, api } = await adapterWithCredential([
    json(200, {
      id: "evt1",
      etag: '"e1"',
      summary: "Planning",
      start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      attendees: [
        { email: "priya@example.com", responseStatus: "accepted" },
        { email: "neel@example.com", self: true, responseStatus: "needsAction" },
      ],
    }),
    json(200, {
      id: "evt1",
      etag: '"e2"',
      summary: "Planning",
      start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      attendees: [
        { email: "priya@example.com", responseStatus: "accepted" },
        { email: "neel@example.com", self: true, responseStatus: "accepted" },
      ],
    }),
  ]);

  const result = await adapter.respond(ACCOUNT, CALENDAR_ID, "evt1", "accepted");
  assert.equal(result.myResponse, "accepted");

  const calls = calendarCalls(api.sent);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "PATCH");
  assert.equal(calls[1].headers["if-match"], '"e1"', "guarded by the etag just read");
  const body = calls[1].body as { attendees: { email: string; responseStatus: string }[] };
  assert.deepEqual(body.attendees, [
    { email: "priya@example.com", responseStatus: "accepted" },
    { email: "neel@example.com", self: true, responseStatus: "accepted" },
  ]);
});

test("respond rejects when Neel is not an attendee", async () => {
  const { adapter } = await adapterWithCredential([
    json(200, {
      id: "evt1",
      etag: '"e1"',
      summary: "Someone else's meeting",
      start: { dateTime: "2026-09-10T09:00:00-07:00", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-09-10T10:00:00-07:00", timeZone: "America/Los_Angeles" },
      attendees: [{ email: "priya@example.com", responseStatus: "accepted" }],
    }),
  ]);
  await assert.rejects(adapter.respond(ACCOUNT, CALENDAR_ID, "evt1", "accepted"), ProviderRejected);
});

// ---------------------------------------------------------------- instanceId

test("instanceId follows Google's convention: the master id, an underscore, and the basic-format original start", async () => {
  const { adapter } = await adapterWithCredential();
  assert.equal(adapter.instanceId("master1", { at: "2026-09-10T16:00:00Z", timezone: "America/Los_Angeles" }), "master1_20260910T160000Z");
  assert.equal(adapter.instanceId("master1", { date: "2026-09-10" }), "master1_20260910");
});

test("the calendar API base URL is stable, for anyone pointing a fake at it", () => {
  assert.equal(CALENDAR_API, "https://www.googleapis.com/calendar/v3");
});
