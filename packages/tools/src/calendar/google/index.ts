// GoogleAdapter: CalendarAdapter implemented over Google Calendar, composing
// oauth.ts (sign-in and bearer tokens), client.ts (the REST calls), map.ts
// (provider JSON <-> the contract's shapes), and credentials.ts (where the
// refresh token lands). Nothing above this module reads Google's JSON or HTTP
// status codes; that is client.ts's and map.ts's job. This module only wires
// them together and remembers each calendar's timezone long enough to build a
// MapContext for calls that do not otherwise carry one.

import { isTimedWhen, type EventPatch, type EventWrite, type When } from "../../contract.ts";
import type { Clock } from "../../core.ts";
import { toInstant } from "../../time.ts";
import {
  ProviderRejected,
  type CalendarAdapter,
  type ProviderCalendar,
  type ProviderEvent,
  type SyncPage,
} from "../adapter.ts";
import type { CredentialStore } from "../credentials.ts";
import {
  GoogleClient,
  type EventsListParams,
  type GoogleAttendee,
  type GoogleClientOptions,
  type GoogleEventBody as ClientEventBody,
} from "./client.ts";
import {
  fromGoogleCalendar,
  fromGoogleEvent,
  toGoogleInsert,
  toGooglePatch,
  type GoogleEventBody as MapEventBody,
  type MapContext,
} from "./map.ts";
import { GOOGLE_ENDPOINTS, GoogleOAuth, type FetchLike, type GoogleClientConfig, type AuthorizationCallback } from "./oauth.ts";

export type GoogleAdapterOptions = {
  callback?: AuthorizationCallback;
  credentials: CredentialStore;
  /** Defaults to the system clock in the machine's timezone; pass a fixed one in tests. */
  clock?: Clock;
  /** Shared by the OAuth client and the REST client; defaults to the global fetch. */
  fetch?: FetchLike;
  /** Defaults to `googleClientConfig()` (env) on first use, the same as GoogleOAuth. */
  config?: GoogleClientConfig;
  endpoints?: Partial<typeof GOOGLE_ENDPOINTS>;
  timeoutMs?: number;
};

const DEFAULT_CLOCK: Clock = { now: () => new Date(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };

/** A cursor this adapter issued: `page:<pageToken>` mid multi-page fetch, `sync:<syncToken>` for the next incremental sync. */
type GoogleCursor = { kind: "page" | "sync"; token: string };

function parseCursor(cursor: string): GoogleCursor | null {
  const colon = cursor.indexOf(":");
  if (colon < 0) return null;
  const kind = cursor.slice(0, colon);
  const token = cursor.slice(colon + 1);
  if ((kind === "page" || kind === "sync") && token.length > 0) return { kind, token };
  return null;
}

/** The provider's id for an occurrence: the master's id, an underscore, and the basic-format original start (Google's own convention). */
function basicStamp(originalStart: When): string {
  if (isTimedWhen(originalStart)) return originalStart.at.replace(/[-:]/g, "");
  return originalStart.date.replace(/-/g, "");
}

/**
 * map.ts's request bodies use an explicit `null` on `start`/`end` fields to
 * clear the other kind on a patch (D-shape change); client.ts's insert/patch
 * bodies are typed without `null` on those fields because `GoogleDateTime`
 * doubles as a read shape. Both are the same JSON on the wire, so this only
 * bridges the two type declarations, never the values.
 */
function toClientBody(body: MapEventBody): ClientEventBody {
  return body as unknown as ClientEventBody;
}

export class GoogleAdapter implements CalendarAdapter {
  readonly provider = "google" as const;
  #credentials: CredentialStore;
  #clock: Clock;
  #oauth: GoogleOAuth;
  #client: GoogleClient;
  /** Each calendar's timezone, learned from `listCalendars` or a sync page, keyed by `accountId:calendarExternalId`. */
  #timezones = new Map<string, string>();

  constructor(opts: GoogleAdapterOptions) {
    this.#credentials = opts.credentials;
    this.#clock = opts.clock ?? DEFAULT_CLOCK;
    this.#oauth = new GoogleOAuth({
      credentials: opts.credentials,
      config: opts.config,
      fetch: opts.fetch,
      now: () => this.#clock.now(),
      callback: opts.callback,
      endpoints: opts.endpoints,
      timeoutMs: opts.timeoutMs,
    });
    const clientOptions: GoogleClientOptions = { tokens: this.#oauth, fetch: opts.fetch, timeoutMs: opts.timeoutMs };
    this.#client = new GoogleClient(clientOptions);
  }

  // ---------------------------------------------------------------- connect

  async connect(opts: { open: (url: string) => void; timeoutMs?: number }): Promise<{ identity: string; scopes: string[]; credentialId: string }> {
    const result = await this.#oauth.authorize({ open: opts.open, timeoutMs: opts.timeoutMs });
    const credentialId = provisionalCredentialId();
    await this.#credentials.write(credentialId, {
      identity: result.identity,
      refreshToken: result.refreshToken,
      scopes: result.scopes,
      obtainedAt: result.obtainedAt,
    });
    return { identity: result.identity, scopes: result.scopes, credentialId };
  }

  async revokeCredential(credentialId: string): Promise<boolean> {
    return this.#oauth.revokeCredential(credentialId);
  }

  // ---------------------------------------------------------------- calendars

  async listCalendars(accountId: string): Promise<ProviderCalendar[]> {
    const entries = await this.#client.calendarList.list(accountId);
    const calendars: ProviderCalendar[] = [];
    for (const entry of entries) {
      const calendar = fromGoogleCalendar(entry, { fallbackTimezone: this.#clock.timezone });
      if (!calendar) continue;
      this.#timezones.set(this.#key(accountId, calendar.id), calendar.timezone);
      calendars.push(calendar);
    }
    return calendars;
  }

  // ---------------------------------------------------------------- sync

  async syncPage(accountId: string, calendarExternalId: string, cursor: string | null, since: string): Promise<SyncPage> {
    const parsed = cursor === null ? null : parseCursor(cursor);
    if (cursor !== null && !parsed) throw new ProviderRejected(`Not a Google sync cursor: ${cursor}`, 400);
    const params: EventsListParams = {
      timeMin: since,
      syncToken: parsed?.kind === "sync" ? parsed.token : null,
      pageToken: parsed?.kind === "page" ? parsed.token : null,
    };
    const page = await this.#client.events.list(accountId, calendarExternalId, params);
    if (page.timeZone) this.#timezones.set(this.#key(accountId, calendarExternalId), page.timeZone);
    const ctx = this.#ctx(accountId, calendarExternalId);
    const items = page.items.map((item) => fromGoogleEvent(item, ctx));
    if (page.nextPageToken) return { items, nextCursor: `page:${page.nextPageToken}`, done: false };
    if (page.nextSyncToken) return { items, nextCursor: `sync:${page.nextSyncToken}`, done: true };
    return { items, nextCursor: null, done: true };
  }

  // ---------------------------------------------------------------- writes

  async create(accountId: string, calendarExternalId: string, event: EventWrite, lifeId: string): Promise<ProviderEvent> {
    const ctx = this.#ctx(accountId, calendarExternalId);
    const body = toGoogleInsert(event, lifeId, ctx);
    const created = await this.#client.events.insert(accountId, calendarExternalId, toClientBody(body));
    return fromGoogleEvent(created, ctx);
  }

  async update(accountId: string, calendarExternalId: string, providerId: string, patch: EventPatch, etag: string): Promise<ProviderEvent> {
    const ctx = this.#ctx(accountId, calendarExternalId);
    const body = toGooglePatch(patch, ctx);
    const updated = await this.#client.events.patch(accountId, calendarExternalId, providerId, toClientBody(body), etag);
    return fromGoogleEvent(updated, ctx);
  }

  async delete(accountId: string, calendarExternalId: string, providerId: string): Promise<void> {
    await this.#client.events.delete(accountId, calendarExternalId, providerId);
  }

  async respond(accountId: string, calendarExternalId: string, providerId: string, response: "accepted" | "declined" | "tentative"): Promise<ProviderEvent> {
    const current = await this.#client.events.get(accountId, calendarExternalId, providerId);
    const attendees: GoogleAttendee[] = (current.attendees ?? []).map((attendee) => (attendee.self ? { ...attendee, responseStatus: response } : attendee));
    if (!attendees.some((attendee) => attendee.self)) {
      throw new ProviderRejected(`Not an attendee of ${providerId}; nothing to respond to`, 400);
    }
    const patched = await this.#client.events.patch(accountId, calendarExternalId, providerId, { attendees }, current.etag);
    return fromGoogleEvent(patched, this.#ctx(accountId, calendarExternalId));
  }

  async move(accountId: string, fromCalendarExternalId: string, toCalendarExternalId: string, providerId: string): Promise<ProviderEvent> {
    const moved = await this.#client.events.move(accountId, fromCalendarExternalId, providerId, toCalendarExternalId);
    return fromGoogleEvent(moved, this.#ctx(accountId, toCalendarExternalId));
  }

  /**
   * Google keeps a master's exception rows as their own resources under the
   * master's iCalUID: read the master for its UID, list everything sharing it
   * (cancelled rows included), and keep the rows that name the master.
   * `events.instances` would lay out every occurrence of the rule instead,
   * unbounded for a series without an end.
   */
  async instances(accountId: string, calendarExternalId: string, providerMasterId: string): Promise<ProviderEvent[]> {
    const master = await this.#client.events.get(accountId, calendarExternalId, providerMasterId);
    if (!master.iCalUID) return [];
    const items = await this.#client.events.byICalUID(accountId, calendarExternalId, master.iCalUID);
    const ctx = this.#ctx(accountId, calendarExternalId);
    return items.filter((item) => item.recurringEventId === providerMasterId).map((item) => fromGoogleEvent(item, ctx));
  }

  instanceId(providerMasterId: string, originalStart: When): string {
    return `${providerMasterId}_${basicStamp(originalStart)}`;
  }

  // ---------------------------------------------------------------- internals

  #key(accountId: string, calendarExternalId: string): string {
    return `${accountId}:${calendarExternalId}`;
  }

  #ctx(accountId: string, calendarExternalId: string): MapContext {
    return {
      calendarTimezone: this.#timezones.get(this.#key(accountId, calendarExternalId)) ?? this.#clock.timezone,
      fetchedAt: toInstant(this.#clock.now()),
    };
  }
}

function provisionalCredentialId(): string {
  return `pending-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
