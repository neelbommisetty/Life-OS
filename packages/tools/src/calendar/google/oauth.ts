// Google sign-in for a desktop app: the authorization-code flow with PKCE and
// a loopback listener on 127.0.0.1, then refresh tokens traded for short-lived
// access tokens with a small in-memory cache. Talks to Google through the
// global fetch and Node's http only; nothing else in the package does.
// Secrets (client secret, refresh tokens, access tokens) never appear in an
// error message, and this module logs nothing.

import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { ProviderUnavailable } from "../adapter.ts";
import type { CredentialStore } from "../credentials.ts";

/** What Life-OS asks for: read and write events, read the calendar list, read the account's email. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export const GOOGLE_ENDPOINTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
} as const;

/** Every request to Google gives up after this long. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** How long the browser has to come back with a code before `authorize` gives up. */
export const DEFAULT_AUTHORIZE_TIMEOUT_MS = 5 * 60_000;

/** A cached access token is reused only while it has at least this long to live. */
const EXPIRY_SKEW_MS = 60_000;

/** The root `.env`, resolved from this file the way `src/db/client.ts` resolves it. */
const ENV_FILE = fileURLToPath(new URL("../../../../../.env", import.meta.url));

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type GoogleClientConfig = { clientId: string; clientSecret: string };

/**
 * Life-OS's own OAuth desktop client from LIFE_GOOGLE_CLIENT_ID and
 * LIFE_GOOGLE_CLIENT_SECRET, loading the repository root `.env` first when
 * either is unset. The error names the variables and the file, never a value.
 */
export function googleClientConfig(env: NodeJS.ProcessEnv = process.env): GoogleClientConfig {
  if (env === process.env && (!env.LIFE_GOOGLE_CLIENT_ID || !env.LIFE_GOOGLE_CLIENT_SECRET)) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      // No .env; fall through to the error below.
    }
  }
  const clientId = env.LIFE_GOOGLE_CLIENT_ID;
  const clientSecret = env.LIFE_GOOGLE_CLIENT_SECRET;
  const missing = [clientId ? null : "LIFE_GOOGLE_CLIENT_ID", clientSecret ? null : "LIFE_GOOGLE_CLIENT_SECRET"].filter((name) => name !== null);
  if (!clientId || !clientSecret) {
    throw new Error(`${missing.join(" and ")} not set. Put Life-OS's Google OAuth desktop client in ${ENV_FILE} or in the environment.`);
  }
  return { clientId, clientSecret };
}

/** For `life doctor`: whether a client id is configured, without exposing the secret or requiring it. */
export function googleClientIdPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env && !env.LIFE_GOOGLE_CLIENT_ID) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      // No .env.
    }
  }
  return Boolean(env.LIFE_GOOGLE_CLIENT_ID);
}

/**
 * The account's refresh token no longer works (revoked, expired, or missing):
 * the account must go through `authorize` again. The caller marks the account
 * `needs_reauth`.
 */
export class NeedsReauth extends Error {
  readonly accountId: string;

  constructor(accountId: string, message = `Google access for ${accountId} needs to be granted again`) {
    super(message);
    this.name = "NeedsReauth";
    this.accountId = accountId;
  }
}

/** Where the REST client gets bearer tokens; `GoogleOAuth` is the real one, tests hand in a stub. */
export interface TokenSource {
  /** A valid access token for the account, refreshing when needed. Throws NeedsReauth or ProviderUnavailable. */
  accessToken(accountId: string): Promise<string>;
  /** Forget the cached token; the next `accessToken` refreshes. */
  invalidate(accountId: string): void;
}

export type AccessToken = { token: string; expiresAt: string };

export type AuthorizeResult = {
  identity: string;
  scopes: string[];
  refreshToken: string;
  /** ISO instant the token was obtained; goes into the credential file. */
  obtainedAt: string;
};

export type GoogleOAuthOptions = {
  credentials: CredentialStore;
  /** Defaults to `googleClientConfig()` on first use, so construction never needs the env. */
  config?: GoogleClientConfig;
  fetch?: FetchLike;
  now?: () => Date;
  endpoints?: Partial<typeof GOOGLE_ENDPOINTS>;
  timeoutMs?: number;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const base64url = (bytes: Buffer): string => bytes.toString("base64url");

export class GoogleOAuth implements TokenSource {
  #credentials: CredentialStore;
  #config: GoogleClientConfig | null;
  #fetch: FetchLike;
  #now: () => Date;
  #endpoints: typeof GOOGLE_ENDPOINTS;
  #timeoutMs: number;
  #cache = new Map<string, AccessToken>();
  #inflight = new Map<string, Promise<AccessToken>>();

  constructor(opts: GoogleOAuthOptions) {
    this.#credentials = opts.credentials;
    this.#config = opts.config ?? null;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#now = opts.now ?? (() => new Date());
    this.#endpoints = { ...GOOGLE_ENDPOINTS, ...opts.endpoints };
    this.#timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get credentials(): CredentialStore {
    return this.#credentials;
  }

  // ---------------------------------------------------------------- the desktop flow

  /**
   * Run the sign-in: listen on a random 127.0.0.1 port, hand the consent URL
   * to `open`, wait for the browser to come back with a code, exchange it
   * (PKCE), read the account's email. Resolves with what the credential file
   * needs; writing it is the caller's job, since the account id is not known
   * yet. Rejects on refusal, a timeout, or a Google error; the listener is
   * closed either way.
   */
  async authorize(opts: { open: (url: string) => void | Promise<void>; timeoutMs?: number; loginHint?: string }): Promise<AuthorizeResult> {
    const config = this.#clientConfig();
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const { port } = server.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const url = new URL(this.#endpoints.auth);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);

    let code: string;
    try {
      code = await waitForCode(server, { state, timeoutMs: opts.timeoutMs ?? DEFAULT_AUTHORIZE_TIMEOUT_MS, open: () => opts.open(url.toString()) });
    } finally {
      await closeServer(server);
    }

    const token = await this.#postToken({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    });
    if (!token.access_token) throw new Error("Google's token response carried no access token");
    if (!token.refresh_token) {
      throw new Error("Google returned no refresh token. Remove Life-OS under the account's third-party access and connect again.");
    }
    const identity = await this.#userEmail(token.access_token);
    const scopes = (token.scope ?? "").split(/\s+/).filter((scope) => scope.length > 0);
    return { identity, scopes, refreshToken: token.refresh_token, obtainedAt: this.#now().toISOString().replace(/\.\d{3}Z$/, "Z") };
  }

  // ---------------------------------------------------------------- access tokens

  async accessToken(accountId: string): Promise<string> {
    const cached = this.#cache.get(accountId);
    if (cached && Date.parse(cached.expiresAt) - this.#now().getTime() > EXPIRY_SKEW_MS) return cached.token;
    return (await this.refreshAccessToken(accountId)).token;
  }

  invalidate(accountId: string): void {
    this.#cache.delete(accountId);
  }

  /**
   * Trade the account's refresh token for a new access token and cache it
   * until it expires. Concurrent callers share one request. Throws
   * NeedsReauth when there is no credential or Google says the grant is gone,
   * ProviderUnavailable when Google cannot be reached.
   */
  refreshAccessToken(accountId: string): Promise<AccessToken> {
    const running = this.#inflight.get(accountId);
    if (running) return running;
    const request = this.#refresh(accountId).finally(() => this.#inflight.delete(accountId));
    this.#inflight.set(accountId, request);
    return request;
  }

  async #refresh(accountId: string): Promise<AccessToken> {
    const config = this.#clientConfig();
    const credential = await this.#credentials.read(accountId);
    if (!credential) throw new NeedsReauth(accountId, `No Google credential on file for ${accountId}; connect the account again`);
    const token = await this.#postToken(
      { client_id: config.clientId, client_secret: config.clientSecret, refresh_token: credential.refreshToken, grant_type: "refresh_token" },
      accountId,
    );
    if (!token.access_token) throw new ProviderUnavailable("Google's token response carried no access token");
    const expiresIn = typeof token.expires_in === "number" && token.expires_in > 0 ? token.expires_in : 3600;
    const fresh: AccessToken = { token: token.access_token, expiresAt: new Date(this.#now().getTime() + expiresIn * 1000).toISOString() };
    this.#cache.set(accountId, fresh);
    return fresh;
  }

  // ---------------------------------------------------------------- Google requests

  #clientConfig(): GoogleClientConfig {
    if (!this.#config) this.#config = googleClientConfig();
    return this.#config;
  }

  /** POST a form to the token endpoint and parse the JSON. `accountId` turns a dead grant into NeedsReauth. */
  async #postToken(form: Record<string, string>, accountId?: string): Promise<TokenResponse> {
    const response = await this.#send(this.#endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const body = await readJson<TokenResponse>(response);
    if (response.ok) return body ?? {};
    const reason = body?.error ?? `HTTP ${response.status}`;
    const detail = body?.error_description ? `: ${body.error_description}` : "";
    if (response.status >= 500 || response.status === 429) {
      throw new ProviderUnavailable(`Google's token service is unavailable (${reason}${detail})`, response.status);
    }
    if (reason === "invalid_client") {
      throw new Error(`Google rejected the OAuth client (${reason}${detail}). Check LIFE_GOOGLE_CLIENT_ID and LIFE_GOOGLE_CLIENT_SECRET.`);
    }
    if (accountId && (reason === "invalid_grant" || reason === "unauthorized_client" || response.status === 401)) {
      throw new NeedsReauth(accountId, `Google no longer accepts the refresh token for ${accountId} (${reason}${detail}); connect the account again`);
    }
    throw new Error(`Google's token request failed (${reason}${detail})`);
  }

  async #userEmail(accessToken: string): Promise<string> {
    const response = await this.#send(this.#endpoints.userinfo, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
    const body = await readJson<{ email?: string }>(response);
    if (!response.ok) {
      if (response.status >= 500) throw new ProviderUnavailable(`Google's userinfo service is unavailable (HTTP ${response.status})`, response.status);
      throw new Error(`Google's userinfo request failed (HTTP ${response.status})`);
    }
    const email = body?.email?.trim().toLowerCase();
    if (!email) throw new Error("Google's userinfo response carried no email; the userinfo.email scope was not granted");
    return email;
  }

  /** fetch with the timeout; network failures and timeouts become ProviderUnavailable. */
  async #send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch (error) {
      throw unreachable(url, error, this.#timeoutMs);
    }
  }
}

// ---------------------------------------------------------------- helpers shared with client.ts

/** Parse a JSON body, or null when there is none or it is not JSON. */
export async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The ProviderUnavailable for a fetch that threw: a timeout or a network failure. Never includes headers or bodies. */
export function unreachable(url: string, error: unknown, timeoutMs: number): ProviderUnavailable {
  const host = safeHost(url);
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new ProviderUnavailable(`${host} did not answer within ${Math.round(timeoutMs / 1000)}s`);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new ProviderUnavailable(`Could not reach ${host}: ${detail}`);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "Google";
  }
}

// ---------------------------------------------------------------- the loopback

const PAGE_OK = "<!doctype html><meta charset=utf-8><title>Life-OS</title><p>Signed in. You can close this tab and go back to the terminal.</p>";
const PAGE_REFUSED = "<!doctype html><meta charset=utf-8><title>Life-OS</title><p>Sign-in was not completed. You can close this tab.</p>";
const PAGE_IGNORED = "<!doctype html><meta charset=utf-8><title>Life-OS</title><p>This response did not match the sign-in in progress and was ignored.</p>";

/**
 * Resolve with the authorization code once the browser hits /callback with
 * the expected state. A response with the wrong state is answered 400 and
 * ignored; `error=` from Google rejects; nothing within `timeoutMs` rejects.
 * `open` runs once the listener is ready; if it throws, the wait rejects.
 */
function waitForCode(server: Server, opts: { state: string; timeoutMs: number; open: () => void | Promise<void> }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { code: string } | { error: Error }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.off("request", onRequest);
      if ("code" in outcome) resolve(outcome.code);
      else reject(outcome.error);
    };
    const timer = setTimeout(() => finish({ error: new Error(`Timed out after ${Math.round(opts.timeoutMs / 1000)}s waiting for Google sign-in to finish in the browser`) }), opts.timeoutMs);

    const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        reply(res, 404, "Not found");
        return;
      }
      if (url.searchParams.get("state") !== opts.state) {
        reply(res, 400, PAGE_IGNORED);
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        reply(res, 200, PAGE_REFUSED);
        finish({ error: new Error(`Google sign-in was refused: ${error}`) });
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        reply(res, 400, PAGE_IGNORED);
        return;
      }
      reply(res, 200, PAGE_OK);
      finish({ code });
    };
    server.on("request", onRequest);

    Promise.resolve()
      .then(() => opts.open())
      .catch((error: unknown) => finish({ error: error instanceof Error ? error : new Error(String(error)) }));
  });
}

function reply(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" });
  res.end(html);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
