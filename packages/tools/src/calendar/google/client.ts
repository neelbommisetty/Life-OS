// Thin typed calls to the Google Calendar REST API over the global fetch:
// calendarList.list, events.list with sync tokens, insert, patch, delete,
// instances. Bearer tokens come from a TokenSource; one 401 triggers one
// refresh and retry, a second one is a NeedsReauth signal. Google's failures
// are mapped to the adapter's errors here so nothing above this module reads
// an HTTP status. Access tokens never appear in an error message.

import { CursorExpired, ProviderRejected, ProviderUnavailable } from "../adapter.ts";
import { NeedsReauth, REQUEST_TIMEOUT_MS, readJson, unreachable, type FetchLike, type TokenSource } from "./oauth.ts";

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Pages are this big: the API's maximum for events.list. */
export const PAGE_SIZE = 250;

// ---------------------------------------------------------------- Google's shapes (the fields Life-OS reads or writes)

export type GoogleDateTime = { dateTime?: string; date?: string; timeZone?: string };

export type GoogleAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
  optional?: boolean;
  organizer?: boolean;
  resource?: boolean;
};

export type GooglePerson = { email?: string; displayName?: string; self?: boolean; id?: string };

export type GoogleReminders = { useDefault: boolean; overrides?: { method: string; minutes: number }[] };

export type GoogleConferenceData = {
  conferenceSolution?: { name?: string; key?: { type?: string } };
  entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
  conferenceId?: string;
};

export type GoogleEvent = {
  kind?: "calendar#event";
  id: string;
  etag: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  creator?: GooglePerson;
  organizer?: GooglePerson;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  endTimeUnspecified?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDateTime;
  transparency?: "opaque" | "transparent";
  visibility?: string;
  iCalUID?: string;
  sequence?: number;
  attendees?: GoogleAttendee[];
  attendeesOmitted?: boolean;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  hangoutLink?: string;
  conferenceData?: GoogleConferenceData;
  reminders?: GoogleReminders;
  eventType?: string;
};

/** The body of an insert or patch: what Life-OS authors. `null` clears a field on patch. */
export type GoogleEventBody = {
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurrence?: string[] | null;
  transparency?: "opaque" | "transparent";
  status?: "confirmed" | "tentative" | "cancelled";
  attendees?: GoogleAttendee[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  reminders?: GoogleReminders;
};

export type GoogleCalendarListEntry = {
  kind?: "calendar#calendarListEntry";
  id: string;
  etag?: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  timeZone?: string;
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  primary?: boolean;
  hidden?: boolean;
  selected?: boolean;
  deleted?: boolean;
};

export type GoogleEventsPage = { items: GoogleEvent[]; nextPageToken: string | null; nextSyncToken: string | null; timeZone: string | null };

/**
 * One events.list call. Pass `syncToken: null, pageToken: null` for the first
 * page of a full sync (it carries `timeMin`), the page token for the pages
 * after it, and the sync token for an incremental sync.
 */
export type EventsListParams = { timeMin: string; syncToken: string | null; pageToken: string | null };

export type InstancesParams = { originalStart?: string; timeMin?: string; timeMax?: string; pageToken?: string | null };

type RawEventsPage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string };
type RawCalendarList = { items?: GoogleCalendarListEntry[]; nextPageToken?: string };
type GoogleErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string; domain?: string }[] } };

/** 403 reasons that mean "back off", not "no". */
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError"]);

export type GoogleClientOptions = {
  tokens: TokenSource;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
};

type Query = Record<string, string | number | boolean | null | undefined>;
type Call = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; query?: Query; body?: unknown; headers?: Record<string, string>; cursorExpires?: boolean };

export class GoogleClient {
  #tokens: TokenSource;
  #fetch: FetchLike;
  #baseUrl: string;
  #timeoutMs: number;

  constructor(opts: GoogleClientOptions) {
    this.#tokens = opts.tokens;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#baseUrl = (opts.baseUrl ?? CALENDAR_API).replace(/\/+$/, "");
    this.#timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  readonly calendarList = {
    /** Every entry, hidden ones included, following page tokens to the end. */
    list: async (accountId: string): Promise<GoogleCalendarListEntry[]> => {
      const entries: GoogleCalendarListEntry[] = [];
      let pageToken: string | null = null;
      do {
        const page: RawCalendarList | null = await this.#request<RawCalendarList>(accountId, {
          method: "GET",
          path: "/users/me/calendarList",
          query: { showHidden: true, maxResults: PAGE_SIZE, pageToken },
        });
        entries.push(...(page?.items ?? []));
        pageToken = page?.nextPageToken ?? null;
      } while (pageToken);
      return entries;
    },
  };

  readonly events = {
    /**
     * One page of a sync: `singleEvents=false`, `showDeleted=true`,
     * `maxResults=250`; `timeMin` on the first page of a full sync only,
     * `syncToken` for an incremental one, `pageToken` to continue either.
     * A 410 is CursorExpired: drop the token and start over.
     */
    list: async (accountId: string, calendarId: string, params: EventsListParams): Promise<GoogleEventsPage> => {
      const first = params.syncToken === null && params.pageToken === null;
      const raw = await this.#request<RawEventsPage>(accountId, {
        method: "GET",
        path: `/calendars/${encodeURIComponent(calendarId)}/events`,
        query: {
          singleEvents: false,
          showDeleted: true,
          maxResults: PAGE_SIZE,
          timeMin: first ? params.timeMin : null,
          syncToken: params.syncToken,
          pageToken: params.pageToken,
        },
        cursorExpires: true,
      });
      return page(raw);
    },

    get: async (accountId: string, calendarId: string, eventId: string): Promise<GoogleEvent> => {
      const event = await this.#request<GoogleEvent>(accountId, { method: "GET", path: eventPath(calendarId, eventId) });
      return required(event, "events.get");
    },

    /** Create; `sendUpdates=none` because Life-OS does not author attendees (D61). */
    insert: async (accountId: string, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent> => {
      const event = await this.#request<GoogleEvent>(accountId, {
        method: "POST",
        path: `/calendars/${encodeURIComponent(calendarId)}/events`,
        query: { sendUpdates: "none" },
        body,
      });
      return required(event, "events.insert");
    },

    /** Partial update guarded by `If-Match: <etag>` so a stale copy is refused (412) rather than clobbering a newer one. An empty etag sends no guard. */
    patch: async (accountId: string, calendarId: string, eventId: string, body: GoogleEventBody, etag: string): Promise<GoogleEvent> => {
      const event = await this.#request<GoogleEvent>(accountId, {
        method: "PATCH",
        path: eventPath(calendarId, eventId),
        query: { sendUpdates: "none" },
        body,
        headers: etag ? { "if-match": etag } : {},
      });
      return required(event, "events.patch");
    },

    delete: async (accountId: string, calendarId: string, eventId: string): Promise<void> => {
      await this.#request<unknown>(accountId, { method: "DELETE", path: eventPath(calendarId, eventId), query: { sendUpdates: "none" } });
    },

    /** The instances of a recurring event, `originalStart` narrowing to one; exception rows come back with their `recurringEventId`. */
    instances: async (accountId: string, calendarId: string, eventId: string, params: InstancesParams = {}): Promise<GoogleEventsPage> => {
      const raw = await this.#request<RawEventsPage>(accountId, {
        method: "GET",
        path: `${eventPath(calendarId, eventId)}/instances`,
        query: {
          maxResults: PAGE_SIZE,
          showDeleted: true,
          originalStart: params.originalStart,
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          pageToken: params.pageToken,
        },
      });
      return page(raw);
    },
  };

  // ---------------------------------------------------------------- the one request path

  /**
   * Send with a bearer token. On 401, drop the token, take a fresh one, and
   * send once more; a second 401 is NeedsReauth. Failures map: 410 on a list
   * → CursorExpired; 403 rate-limit reasons, 429, 5xx → ProviderUnavailable;
   * other 4xx → ProviderRejected with Google's message. A 204 resolves null.
   */
  async #request<T>(accountId: string, call: Call): Promise<T | null> {
    const url = this.#url(call.path, call.query);
    let token = await this.#tokens.accessToken(accountId);
    let response = await this.#send(url, call, token);
    if (response.status === 401) {
      await response.body?.cancel();
      this.#tokens.invalidate(accountId);
      token = await this.#tokens.accessToken(accountId);
      response = await this.#send(url, call, token);
      if (response.status === 401) {
        await response.body?.cancel();
        throw new NeedsReauth(accountId);
      }
    }
    if (response.ok) {
      if (response.status === 204) {
        await response.body?.cancel();
        return null;
      }
      return readJson<T>(response);
    }
    throw await this.#mapError(response, call, token);
  }

  #url(path: string, query: Query = {}): string {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async #send(url: string, call: Call, token: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json", ...call.headers };
    const init: RequestInit = { method: call.method, headers, signal: AbortSignal.timeout(this.#timeoutMs) };
    if (call.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(call.body);
    }
    try {
      return await this.#fetch(url, init);
    } catch (error) {
      throw unreachable(url, error, this.#timeoutMs);
    }
  }

  async #mapError(response: Response, call: Call, token: string): Promise<Error> {
    const body = await readJson<GoogleErrorBody>(response);
    const reasons = (body?.error?.errors ?? []).map((item) => item.reason).filter((reason): reason is string => typeof reason === "string");
    const message = scrub(body?.error?.message?.trim() || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`, token);
    const status = response.status;
    if (status === 410 && call.cursorExpires) return new CursorExpired(`Google says the sync token has expired: ${message}`);
    if (status >= 500 || status === 429 || (status === 403 && reasons.some((reason) => RATE_LIMIT_REASONS.has(reason)))) {
      return new ProviderUnavailable(`Google Calendar is unavailable (HTTP ${status}): ${message}`, status);
    }
    return new ProviderRejected(message, status);
  }
}

// ---------------------------------------------------------------- helpers

function eventPath(calendarId: string, eventId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

function page(raw: RawEventsPage | null): GoogleEventsPage {
  return { items: raw?.items ?? [], nextPageToken: raw?.nextPageToken ?? null, nextSyncToken: raw?.nextSyncToken ?? null, timeZone: raw?.timeZone ?? null };
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new ProviderUnavailable(`Google answered ${what} with an empty body`);
  return value;
}

/** Keep Google's message but never a bearer token, and never more than a line's worth. */
function scrub(message: string, token: string): string {
  const cleaned = token ? message.split(token).join("[redacted]") : message;
  return cleaned.length > 500 ? `${cleaned.slice(0, 497)}...` : cleaned;
}
