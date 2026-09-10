import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderUnavailable } from "../adapter.ts";
import { CredentialStore } from "../credentials.ts";
import {
  DEFAULT_AUTHORIZE_TIMEOUT_MS,
  GOOGLE_ENDPOINTS,
  GOOGLE_SCOPES,
  GoogleOAuth,
  NeedsReauth,
  REQUEST_TIMEOUT_MS,
  googleClientConfig,
  googleClientIdPresent,
  type FetchLike,
} from "./oauth.ts";

const config = { clientId: "life-os.apps.googleusercontent.com", clientSecret: "GOCSPX-client-secret-value" };
const REFRESH = "1//refresh-token-secret-value";

const roots: string[] = [];
async function tempStore(): Promise<CredentialStore> {
  const root = await mkdtemp(join(tmpdir(), "life-oauth-"));
  roots.push(root);
  return new CredentialStore(join(root, "google"));
}
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

type Sent = { url: string; method: string; headers: Record<string, string>; form: URLSearchParams | null; signal: AbortSignal | null };

/** A fake Google: answers the token and userinfo endpoints, records every request, and can be told what to answer next. */
function fakeGoogle(opts: { expiresIn?: number; refreshToken?: string | null; email?: string | null } = {}) {
  const sent: Sent[] = [];
  const queued: Response[] = [];
  const revoked: string[] = [];
  let tokenCalls = 0;
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const form = typeof init?.body === "string" && headers["content-type"]?.includes("x-www-form-urlencoded") ? new URLSearchParams(init.body) : null;
    sent.push({ url, method: init?.method ?? "GET", headers, form, signal: init?.signal ?? null });
    const next = queued.shift();
    if (next) return next;
    if (url === GOOGLE_ENDPOINTS.token) {
      tokenCalls += 1;
      const grant = form?.get("grant_type");
      if (grant === "authorization_code") {
        const body: Record<string, unknown> = {
          access_token: `access-from-code-${tokenCalls}`,
          expires_in: opts.expiresIn ?? 3599,
          scope: GOOGLE_SCOPES.join(" "),
          token_type: "Bearer",
        };
        if (opts.refreshToken !== null) body.refresh_token = opts.refreshToken ?? REFRESH;
        return json(200, body);
      }
      if (grant === "refresh_token") {
        if (form?.get("refresh_token") !== REFRESH) return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        return json(200, { access_token: `access-${tokenCalls}`, expires_in: opts.expiresIn ?? 3599, scope: GOOGLE_SCOPES.join(" "), token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url === GOOGLE_ENDPOINTS.revoke) {
      revoked.push(form?.get("token") ?? "");
      return json(200, {});
    }
    if (url === GOOGLE_ENDPOINTS.userinfo) {
      if (opts.email === null) return json(200, { sub: "123" });
      return json(200, { sub: "123", email: opts.email ?? "Neel@Example.com", email_verified: true });
    }
    return json(404, { error: "not_found" });
  };
  return { fetch, sent, revoked, queue: (response: Response) => queued.push(response), tokenCalls: () => tokenCalls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Play the browser: parse the consent URL and hit the loopback with a code, using the real fetch on 127.0.0.1 only. */
async function browserReturns(url: string, params: Record<string, string>): Promise<Response> {
  const consent = new URL(url);
  const redirect = new URL(consent.searchParams.get("redirect_uri") ?? "");
  const state = consent.searchParams.get("state") ?? "";
  const callback = new URL(redirect);
  callback.searchParams.set("state", state);
  for (const [key, value] of Object.entries(params)) callback.searchParams.set(key, value === "$state" ? state : value);
  return fetch(callback);
}

// ---------------------------------------------------------------- the desktop flow

test("authorize builds a PKCE consent URL, receives the code on the loopback, exchanges it, and reads the email", async () => {
  const google = fakeGoogle();
  const oauth = new GoogleOAuth({ credentials: await tempStore(), config, fetch: google.fetch, now: () => new Date("2026-09-09T12:00:00.500Z") });
  let consentUrl = "";
  let browser: Promise<Response> | null = null;
  const result = await oauth.authorize({
    open: (url) => {
      consentUrl = url;
      browser = browserReturns(url, { code: "the-code" });
    },
  });

  const consent = new URL(consentUrl);
  assert.equal(`${consent.origin}${consent.pathname}`, GOOGLE_ENDPOINTS.auth);
  assert.equal(consent.searchParams.get("client_id"), config.clientId);
  assert.equal(consent.searchParams.get("response_type"), "code");
  assert.equal(consent.searchParams.get("scope"), GOOGLE_SCOPES.join(" "));
  assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
  assert.equal(consent.searchParams.get("access_type"), "offline");
  assert.equal(consent.searchParams.get("prompt"), "consent");
  assert.ok(consent.searchParams.get("state"), "a state is set");
  assert.ok(!consentUrl.includes(config.clientSecret), "the secret is not in the URL");
  const redirect = new URL(consent.searchParams.get("redirect_uri") ?? "");
  assert.equal(redirect.hostname, "127.0.0.1");
  assert.equal(redirect.pathname, "/callback");
  assert.ok(Number(redirect.port) > 0, "a random port");

  assert.deepEqual(result, { identity: "neel@example.com", scopes: [...GOOGLE_SCOPES], refreshToken: REFRESH, obtainedAt: "2026-09-09T12:00:00Z" });

  const [exchange, userinfo] = google.sent;
  assert.equal(exchange.url, GOOGLE_ENDPOINTS.token);
  assert.equal(exchange.method, "POST");
  assert.equal(exchange.form?.get("grant_type"), "authorization_code");
  assert.equal(exchange.form?.get("code"), "the-code");
  assert.equal(exchange.form?.get("client_id"), config.clientId);
  assert.equal(exchange.form?.get("client_secret"), config.clientSecret);
  assert.equal(exchange.form?.get("redirect_uri"), redirect.toString());
  const verifier = exchange.form?.get("code_verifier") ?? "";
  assert.ok(verifier.length >= 43 && verifier.length <= 128, "verifier length per RFC 7636");
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), consent.searchParams.get("code_challenge"), "the challenge is S256 of the verifier");
  assert.ok(exchange.signal instanceof AbortSignal, "every request carries a timeout signal");

  assert.equal(userinfo.url, GOOGLE_ENDPOINTS.userinfo);
  assert.equal(userinfo.headers.authorization, "Bearer access-from-code-1");
  assert.equal(google.sent.length, 2);

  const pending = browser as Promise<Response> | null;
  assert.ok(pending);
  const page = await pending;
  assert.equal(page.status, 200);
  assert.match(await page.text(), /close this tab/);
  await assert.rejects(fetch(redirect), "the listener is closed once the code arrived");
});

test("authorize ignores a callback with the wrong state and keeps waiting for the right one", async () => {
  const google = fakeGoogle();
  const oauth = new GoogleOAuth({ credentials: await tempStore(), config, fetch: google.fetch });
  const result = await oauth.authorize({
    open: async (url) => {
      const wrong = new URL(new URL(url).searchParams.get("redirect_uri") ?? "");
      wrong.searchParams.set("state", "forged");
      wrong.searchParams.set("code", "attacker");
      const refused = await fetch(wrong);
      assert.equal(refused.status, 400);
      await refused.text();
      const elsewhere = await fetch(new URL("/other", wrong));
      assert.equal(elsewhere.status, 404);
      await elsewhere.text();
      const ok = await browserReturns(url, { code: "real-code" });
      assert.equal(ok.status, 200);
      await ok.text();
    },
  });
  assert.equal(result.identity, "neel@example.com");
  assert.equal(google.sent[0].form?.get("code"), "real-code", "the forged code was never exchanged");
});

test("authorize rejects when Google reports an error and when the browser never comes back", async () => {
  const google = fakeGoogle();
  const oauth = new GoogleOAuth({ credentials: await tempStore(), config, fetch: google.fetch });
  let redirect = "";
  await assert.rejects(
    oauth.authorize({
      open: (url) => {
        redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
        void browserReturns(url, { error: "access_denied" }).then((response) => response.text());
      },
    }),
    /refused: access_denied/,
  );
  await assert.rejects(fetch(redirect), "the listener is closed after a refusal");
  assert.equal(google.sent.length, 0, "nothing was exchanged");

  await assert.rejects(oauth.authorize({ open: () => {}, timeoutMs: 40 }), /Timed out/);
  await assert.rejects(oauth.authorize({ open: () => { throw new Error("no browser here"); } }), /no browser here/);
  assert.ok(DEFAULT_AUTHORIZE_TIMEOUT_MS >= 60_000);
});

test("authorize rejects when Google returns no refresh token or no email", async () => {
  const oauthNoRefresh = new GoogleOAuth({ credentials: await tempStore(), config, fetch: fakeGoogle({ refreshToken: null }).fetch });
  await assert.rejects(oauthNoRefresh.authorize({ open: (url) => void browserReturns(url, { code: "c" }).then((r) => r.text()) }), /no refresh token/);
  const oauthNoEmail = new GoogleOAuth({ credentials: await tempStore(), config, fetch: fakeGoogle({ email: null }).fetch });
  await assert.rejects(oauthNoEmail.authorize({ open: (url) => void browserReturns(url, { code: "c" }).then((r) => r.text()) }), /no email/);
});

// ---------------------------------------------------------------- refresh and the cache

async function storeWith(accountId: string, refreshToken = REFRESH): Promise<CredentialStore> {
  const store = await tempStore();
  await store.write(accountId, { identity: "neel@example.com", refreshToken, scopes: [...GOOGLE_SCOPES], obtainedAt: "2026-09-09T12:00:00Z" });
  return store;
}

test("accessToken refreshes from the credential file once and serves the cache until the token nears expiry", async () => {
  const google = fakeGoogle({ expiresIn: 3600 });
  let now = Date.parse("2026-09-09T12:00:00Z");
  const oauth = new GoogleOAuth({ credentials: await storeWith("a_one"), config, fetch: google.fetch, now: () => new Date(now) });

  assert.equal(await oauth.accessToken("a_one"), "access-1");
  assert.equal(await oauth.accessToken("a_one"), "access-1", "served from the cache");
  assert.equal(google.tokenCalls(), 1);
  const refresh = google.sent[0];
  assert.equal(refresh.method, "POST");
  assert.equal(refresh.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(refresh.form?.get("grant_type"), "refresh_token");
  assert.equal(refresh.form?.get("refresh_token"), REFRESH);
  assert.equal(refresh.form?.get("client_id"), config.clientId);
  assert.equal(refresh.form?.get("client_secret"), config.clientSecret);
  assert.ok(refresh.signal instanceof AbortSignal);

  now += 58 * 60_000; // two minutes before expiry: still fine
  assert.equal(await oauth.accessToken("a_one"), "access-1");
  now += 90_000; // inside the last minute: refresh
  assert.equal(await oauth.accessToken("a_one"), "access-2");
  assert.equal(google.tokenCalls(), 2);

  oauth.invalidate("a_one");
  assert.equal(await oauth.accessToken("a_one"), "access-3", "invalidate forces a refresh");

  const direct = await oauth.refreshAccessToken("a_one");
  assert.equal(direct.token, "access-4");
  assert.equal(direct.expiresAt, new Date(now + 3600_000).toISOString());
});

test("the cache is per account and concurrent refreshes of one account share a request", async () => {
  const google = fakeGoogle();
  const store = await storeWith("a_one");
  await store.write("a_two", { identity: "work@example.com", refreshToken: REFRESH, scopes: [...GOOGLE_SCOPES], obtainedAt: "2026-09-09T12:00:00Z" });
  const oauth = new GoogleOAuth({ credentials: store, config, fetch: google.fetch });
  const [a, b, c] = await Promise.all([oauth.accessToken("a_one"), oauth.accessToken("a_one"), oauth.accessToken("a_two")]);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(google.tokenCalls(), 2, "one refresh per account");
});

test("a revoked grant, a missing credential, and an outage each map to the right error without leaking secrets", async () => {
  const google = fakeGoogle();
  const store = await storeWith("a_revoked", "1//stale-token-value");
  const oauth = new GoogleOAuth({ credentials: store, config, fetch: google.fetch });

  await assert.rejects(oauth.accessToken("a_revoked"), (error: Error) => {
    assert.ok(error instanceof NeedsReauth);
    assert.equal(error.accountId, "a_revoked");
    assert.match(error.message, /invalid_grant/);
    assert.ok(!error.message.includes("stale-token-value"));
    assert.ok(!error.message.includes(config.clientSecret));
    return true;
  });

  await assert.rejects(oauth.accessToken("a_missing"), (error: Error) => {
    assert.ok(error instanceof NeedsReauth);
    assert.match(error.message, /No Google credential on file for a_missing/);
    return true;
  });

  await store.write("a_ok", { identity: "neel@example.com", refreshToken: REFRESH, scopes: [...GOOGLE_SCOPES], obtainedAt: "2026-09-09T12:00:00Z" });
  google.queue(json(503, { error: "temporarily_unavailable" }));
  await assert.rejects(oauth.accessToken("a_ok"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.equal(error.status, 503);
    return true;
  });
  google.queue(json(401, { error: "invalid_client", error_description: "The OAuth client was not found." }));
  await assert.rejects(oauth.accessToken("a_ok"), (error: Error) => {
    assert.ok(!(error instanceof NeedsReauth), "a broken client configuration is not the account's fault");
    assert.match(error.message, /LIFE_GOOGLE_CLIENT_ID/);
    assert.ok(!error.message.includes(config.clientSecret));
    return true;
  });
  assert.match(await oauth.accessToken("a_ok"), /^access-\d+$/, "a later refresh succeeds and nothing bad was cached");
});

test("a timeout or a network failure while refreshing is ProviderUnavailable naming the host", async () => {
  const timingOut: FetchLike = async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  };
  const oauth = new GoogleOAuth({ credentials: await storeWith("a_one"), config, fetch: timingOut, timeoutMs: 20_000 });
  await assert.rejects(oauth.accessToken("a_one"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.match(error.message, /oauth2\.googleapis\.com did not answer within 20s/);
    return true;
  });
  const offline: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  const oauth2 = new GoogleOAuth({ credentials: await storeWith("a_one"), config, fetch: offline });
  await assert.rejects(oauth2.accessToken("a_one"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.match(error.message, /Could not reach oauth2\.googleapis\.com: fetch failed/);
    return true;
  });
  assert.equal(REQUEST_TIMEOUT_MS, 20_000);
});

test("a fetch that never resolves is cut off by the timeout signal", async () => {
  const hanging: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  const oauth = new GoogleOAuth({ credentials: await storeWith("a_one"), config, fetch: hanging, timeoutMs: 30 });
  await assert.rejects(oauth.accessToken("a_one"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.match(error.message, /did not answer within/);
    return true;
  });
});

// ---------------------------------------------------------------- revocation

test("revoke posts the refresh token to the revoke endpoint with the timeout and treats an already-dead token as done", async () => {
  const google = fakeGoogle();
  const oauth = new GoogleOAuth({ credentials: await tempStore(), config, fetch: google.fetch });
  await oauth.revoke(REFRESH);
  assert.deepEqual(google.revoked, [REFRESH]);
  const request = google.sent[0];
  assert.equal(request.url, GOOGLE_ENDPOINTS.revoke);
  assert.equal(request.url, "https://oauth2.googleapis.com/revoke");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded");
  assert.deepEqual([...(request.form?.keys() ?? [])], ["token"], "only the token goes; no client secret");
  assert.ok(request.signal instanceof AbortSignal, "the usual timeout applies");

  google.queue(json(400, { error: "invalid_token", error_description: "Token expired or revoked" }));
  await oauth.revoke("1//already-dead-token");

  google.queue(json(503, { error: "temporarily_unavailable" }));
  await assert.rejects(oauth.revoke("1//outage-token-value"), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.equal(error.status, 503);
    assert.ok(!error.message.includes("outage-token-value"));
    return true;
  });
  google.queue(json(403, { error: "forbidden" }));
  await assert.rejects(oauth.revoke("1//refused-token-value"), (error: Error) => {
    assert.ok(!(error instanceof ProviderUnavailable));
    assert.match(error.message, /revoke request failed \(forbidden\)/);
    assert.ok(!error.message.includes("refused-token-value"));
    return true;
  });

  const hanging: FetchLike = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  const slow = new GoogleOAuth({ credentials: await tempStore(), config, fetch: hanging, timeoutMs: 30 });
  await assert.rejects(slow.revoke(REFRESH), (error: Error) => {
    assert.ok(error instanceof ProviderUnavailable);
    assert.match(error.message, /oauth2\.googleapis\.com did not answer within/);
    return true;
  });
});

test("revokeCredential revokes the token in a credential file and leaves the file for the caller to delete", async () => {
  const google = fakeGoogle();
  const store = await storeWith("pending-abc", "1//provisional-token-value");
  const oauth = new GoogleOAuth({ credentials: store, config, fetch: google.fetch });
  assert.equal(await oauth.revokeCredential("pending-abc"), true);
  assert.deepEqual(google.revoked, ["1//provisional-token-value"]);
  assert.equal(await store.exists("pending-abc"), true, "deleting the file is the caller's job");
  assert.equal(await oauth.revokeCredential("pending-missing"), false);
  assert.equal(google.sent.length, 1, "nothing is sent for a missing file");
  assert.ok(!google.sent.some((request) => request.url === GOOGLE_ENDPOINTS.token), "revocation needs no client credentials");
});

// ---------------------------------------------------------------- the client configuration

test("googleClientConfig reads the two variables and names what is missing without a value", () => {
  assert.deepEqual(googleClientConfig({ LIFE_GOOGLE_CLIENT_ID: "id", LIFE_GOOGLE_CLIENT_SECRET: "sec" }), { clientId: "id", clientSecret: "sec" });
  assert.throws(() => googleClientConfig({ LIFE_GOOGLE_CLIENT_ID: "id" }), (error: Error) => {
    assert.match(error.message, /^LIFE_GOOGLE_CLIENT_SECRET not set/);
    assert.match(error.message, /\.env/);
    return true;
  });
  assert.throws(() => googleClientConfig({}), /LIFE_GOOGLE_CLIENT_ID and LIFE_GOOGLE_CLIENT_SECRET not set/);
  assert.equal(googleClientIdPresent({ LIFE_GOOGLE_CLIENT_ID: "id" }), true);
  assert.equal(googleClientIdPresent({}), false);
});

test("constructing without a config does not need the environment; only the first Google call does", async () => {
  const saved = { id: process.env.LIFE_GOOGLE_CLIENT_ID, secret: process.env.LIFE_GOOGLE_CLIENT_SECRET };
  delete process.env.LIFE_GOOGLE_CLIENT_ID;
  delete process.env.LIFE_GOOGLE_CLIENT_SECRET;
  try {
    const oauth = new GoogleOAuth({ credentials: await storeWith("a_one"), fetch: fakeGoogle().fetch });
    // Either the root .env supplies the client (then the refresh succeeds) or it does not (then the error names the variables). Never a leak either way.
    try {
      const token = await oauth.accessToken("a_one");
      assert.match(token, /^access-/);
    } catch (error) {
      assert.match((error as Error).message, /LIFE_GOOGLE_CLIENT_ID|LIFE_GOOGLE_CLIENT_SECRET/);
    }
  } finally {
    if (saved.id !== undefined) process.env.LIFE_GOOGLE_CLIENT_ID = saved.id;
    else delete process.env.LIFE_GOOGLE_CLIENT_ID;
    if (saved.secret !== undefined) process.env.LIFE_GOOGLE_CLIENT_SECRET = saved.secret;
    else delete process.env.LIFE_GOOGLE_CLIENT_SECRET;
  }
});
