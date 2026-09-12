// Network plumbing shared by the catalog adapters, and only by them: JSON
// requests with a 20 second per-request timeout, one retry on 429 after
// Retry-After, HTTP failures mapped to CatalogUnavailable (the source is down
// or asking us to back off) or HttpError (the source said no, with its own
// message and status), and Budget, one 20 second allowance a whole resolve
// shares through a single AbortSignal. fetch and the timer are injected so
// tests use a fake of each and never the network. The calendar keeps its own
// helpers in src/calendar/google; nothing here is shared with them. Secrets a
// request carries never reach an error message.

import { CatalogUnavailable, HttpError, abortedError } from "./adapter.ts";

export { HttpError };

/** How long one request may take, headers and body included. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** How long a whole resolve (search, detail, editions, availability) may take. */
export const BUDGET_MS = 20_000;
/** The most a 429's Retry-After is honoured for; longer waits are cut to this. */
export const RETRY_AFTER_CAP_MS = 10_000;
/** The wait when a 429 carries no usable Retry-After. */
const RETRY_AFTER_DEFAULT_MS = 1_000;
/** Error messages stay a line's worth. */
const MESSAGE_LIMIT = 500;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type TimerHandle = unknown;

/** The clock and timers a Net runs on: the real ones by default, a FakeTimer in tests. */
export type Timer = {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
};

/** Wall-clock timers; each is unref'd so a pending budget never keeps the process alive. */
export const realTimer: Timer = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** A timer a test drives by hand: `advance(ms)` fires what fell due, in order; `waits` lists every delay asked for. */
export class FakeTimer implements Timer {
  readonly waits: number[] = [];
  #now: number;
  #pending: { id: number; at: number; fn: () => void }[] = [];
  #ids = 0;

  constructor(start = Date.parse("2026-09-12T12:00:00Z")) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    this.waits.push(ms);
    const id = ++this.#ids;
    this.#pending.push({ id, at: this.#now + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.#pending = this.#pending.filter((timer) => timer.id !== handle);
  }

  /** How many timers are waiting. */
  get pending(): number {
    return this.#pending.length;
  }

  /** Move the clock forward, firing every timer that falls due, earliest first. */
  advance(ms: number): void {
    const until = this.#now + ms;
    for (;;) {
      const due = this.#pending.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.#pending = this.#pending.filter((timer) => timer.id !== due.id);
      this.#now = Math.max(this.#now, due.at);
      due.fn();
    }
    this.#now = until;
  }
}

/**
 * One resolve's time allowance: a signal every request of the resolve passes
 * along, aborted with a CatalogUnavailable when the time is up so the adapter
 * throws exactly that and `add` can say the budget ran out. `release` stops the
 * clock once the resolve is done.
 */
export class Budget {
  readonly ms: number;
  readonly signal: AbortSignal;
  #timer: Timer;
  #startedAt: number;
  #handle: TimerHandle;
  #controller = new AbortController();

  constructor(ms = BUDGET_MS, timer: Timer = realTimer) {
    this.ms = ms;
    this.#timer = timer;
    this.#startedAt = timer.now();
    this.signal = this.#controller.signal;
    this.#handle = timer.setTimeout(() => this.#controller.abort(new CatalogUnavailable(`The ${seconds(ms)}s lookup budget ran out`)), ms);
  }

  /** True once the time is up (or `cancel` was called). */
  get exhausted(): boolean {
    return this.signal.aborted;
  }

  /** What is left, never below zero. */
  get remainingMs(): number {
    if (this.signal.aborted) return 0;
    return Math.max(0, this.ms - (this.#timer.now() - this.#startedAt));
  }

  /** Stop the clock; the signal stays as it is. Call when the resolve is done. */
  release(): void {
    this.#timer.clearTimeout(this.#handle);
  }

  /** End the budget early: the signal aborts as if the time were up. */
  cancel(): void {
    this.release();
    if (!this.signal.aborted) this.#controller.abort(new CatalogUnavailable("The lookup was cancelled"));
  }
}

export type NetOptions = {
  fetch?: FetchLike;
  timer?: Timer;
  timeoutMs?: number;
  retryAfterCapMs?: number;
};

export type JsonRequest = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** A string is sent as is (an Apicalypse body, a form); anything else is JSON-encoded with the matching content type. */
  body?: unknown;
  /** The budget's signal, typically; an already-aborted one is refused before anything is sent. */
  signal?: AbortSignal;
  /** The source's display name for messages; the URL's host otherwise. */
  source?: string;
  /** Values that must never appear in an error message, besides the authorization and Client-ID headers. */
  secrets?: string[];
};

type Answer = { status: number; statusText: string; headers: Headers; text: string };

/**
 * A fetch with a timeout, a retry on 429, and one error vocabulary. Adapters
 * construct one with their injected fetch and timer and share its timer for
 * their own pacing.
 */
export class Net {
  readonly timer: Timer;
  readonly timeoutMs: number;
  readonly retryAfterCapMs: number;
  #fetch: FetchLike;

  constructor(opts: NetOptions = {}) {
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timer = opts.timer ?? realTimer;
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.retryAfterCapMs = opts.retryAfterCapMs ?? RETRY_AFTER_CAP_MS;
  }

  /**
   * GET or POST `url` and parse the JSON answer. A 429 is retried once after
   * Retry-After (seconds or an HTTP date, capped); a 429 again, a 5xx, a network
   * failure, a timeout, or an aborted signal is CatalogUnavailable; any other
   * failure is HttpError with the body's message; a 2xx that is not JSON is
   * CatalogUnavailable too, since the source did not answer as itself.
   */
  async fetchJson<T>(url: string, request: JsonRequest = {}): Promise<T> {
    const source = request.source ?? safeHost(url);
    const secrets = secretsOf(request);
    if (request.signal?.aborted) throw abortedError(request.signal, source);
    let answer = await this.#send(url, request, source);
    if (answer.status === 429) {
      const wait = retryAfterMs(answer.headers.get("retry-after"), this.timer.now(), this.retryAfterCapMs);
      await this.sleep(wait, request.signal, source);
      answer = await this.#send(url, request, source);
    }
    const body = parseJson(answer.text);
    if (answer.status >= 200 && answer.status < 300) {
      if (body === undefined) throw new CatalogUnavailable(`${source} answered with something other than JSON`, answer.status);
      return body as T;
    }
    const message = scrub(bodyMessage(body, answer.text) || `HTTP ${answer.status}${answer.statusText ? ` ${answer.statusText}` : ""}`, secrets);
    if (answer.status >= 500 || answer.status === 429) {
      throw new CatalogUnavailable(clip(`${source} is unavailable (HTTP ${answer.status}): ${message}`), answer.status);
    }
    throw new HttpError(clip(`${source} refused the request (HTTP ${answer.status}): ${message}`), answer.status, body);
  }

  /** Wait `ms` on the Net's timer; an aborted `signal` ends the wait with the aborted error. */
  sleep(ms: number, signal?: AbortSignal, source = "catalog"): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortedError(signal, source));
        return;
      }
      const onAbort = (): void => {
        this.timer.clearTimeout(handle);
        reject(abortedError(signal as AbortSignal, source));
      };
      const handle = this.timer.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** A fresh budget on this Net's timer. */
  budget(ms = BUDGET_MS): Budget {
    return new Budget(ms, this.timer);
  }

  /** Send once and read the whole body, both under the per-request timeout; throws CatalogUnavailable for anything that stops an answer arriving. */
  async #send(url: string, request: JsonRequest, source: string): Promise<Answer> {
    const timeout = new AbortController();
    const handle = this.timer.setTimeout(() => timeout.abort(new CatalogUnavailable(`${source} did not answer within ${seconds(this.timeoutMs)}s`)), this.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout.signal]) : timeout.signal;
    const headers: Record<string, string> = { accept: "application/json", ...lowerKeys(request.headers ?? {}) };
    const init: RequestInit = { method: request.method ?? "GET", headers, signal };
    if (request.body !== undefined) {
      if (typeof request.body === "string") {
        init.body = request.body;
      } else {
        headers["content-type"] ??= "application/json";
        init.body = JSON.stringify(request.body);
      }
    }
    try {
      const response = await this.#fetch(url, init);
      const text = await response.text();
      return { status: response.status, statusText: response.statusText, headers: response.headers, text };
    } catch (error) {
      if (request.signal?.aborted) throw abortedError(request.signal, source);
      if (timeout.signal.aborted) throw timeout.signal.reason as CatalogUnavailable;
      const detail = error instanceof Error ? error.message : String(error);
      throw new CatalogUnavailable(clip(`Could not reach ${source}: ${scrub(detail, secretsOf(request))}`));
    } finally {
      this.timer.clearTimeout(handle);
    }
  }
}

// ---------------------------------------------------------------- helpers

/** Milliseconds to wait for a Retry-After header: seconds, or an HTTP date relative to `nowMs`; the default when unreadable; never above `capMs`. */
export function retryAfterMs(header: string | null, nowMs: number, capMs = RETRY_AFTER_CAP_MS): number {
  let ms = RETRY_AFTER_DEFAULT_MS;
  const value = header?.trim() ?? "";
  if (/^\d+(\.\d+)?$/.test(value)) {
    ms = Math.round(Number(value) * 1000);
  } else if (value) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) ms = Math.max(0, at - nowMs);
  }
  return Math.min(ms, capMs);
}

/** The message a source put in its error body, whatever its shape: TMDB's `status_message`, Open Library's `error`, IGDB's `[{ title, cause }]`, a plain `message`, or the text itself. */
export function bodyMessage(body: unknown, text: string): string {
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === "object") {
    const record = first as Record<string, unknown>;
    for (const key of ["status_message", "message", "error", "error_description", "title"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        const cause = key === "title" && typeof record.cause === "string" && record.cause.trim() ? `: ${record.cause.trim()}` : "";
        return `${value.trim()}${cause}`;
      }
      if (value && typeof value === "object" && typeof (value as Record<string, unknown>).message === "string") {
        return ((value as Record<string, unknown>).message as string).trim();
      }
    }
    return "";
  }
  if (typeof first === "string") return first.trim();
  return text.trim().replace(/\s+/g, " ");
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

/** The header values that must never be echoed: any authorization token, the Client-ID, anything the caller named. */
function secretsOf(request: JsonRequest): string[] {
  const secrets = [...(request.secrets ?? [])];
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    const name = key.toLowerCase();
    if (name === "authorization") secrets.push(value.replace(/^\s*\w+\s+/, ""), value);
    else if (name === "client-id" || name.includes("secret") || name.includes("key")) secrets.push(value);
  }
  return secrets.filter((secret) => secret.length >= 4);
}

/** `message` with every secret replaced. */
export function scrub(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

/** `message` cut to a line's worth. */
export function clip(message: string): string {
  return message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT - 1)}…` : message;
}

function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the catalog";
  }
}
