// The provider adapter: what a calendar provider must offer so the sync engine
// and the event operations can stay provider-neutral, the provider-side record
// shapes, the errors a provider can raise, and FakeAdapter, an in-memory
// provider for tests. Only src/calendar/google/* talks to a real provider.

import {
  isTimedWhen,
  type Event,
  type EventPatch,
  type EventWrite,
  type When,
} from "../contract.ts";
import type { Clock } from "../core.ts";
import { addDays, daysBetween, toInstant } from "../time.ts";

export type ProviderCalendar = {
  id: string;
  name: string;
  color: string | null;
  timezone: string;
  writable: boolean;
  primary: boolean;
  hidden: boolean;
};

export type ProviderEvent = Omit<
  Event,
  "id" | "calendarId" | "accountId" | "masterId" | "origin" | "version" | "createdAt" | "updatedAt" | "deletedAt"
> & {
  providerMasterId: string | null; // for an exception row
  deleted: boolean; // provider says it is gone
  lifeId: string | null; // our id, if we stamped it on create (extendedProperties.private.lifeId)
};

export type SyncPage = { items: ProviderEvent[]; nextCursor: string | null; done: boolean };

/** The provider says the cursor is no longer good: start a full sync. */
export class CursorExpired extends Error {
  constructor(message = "The sync cursor has expired; run a full sync") {
    super(message);
    this.name = "CursorExpired";
  }
}

/** The provider could not be reached or asked us to back off; nothing was done. */
export class ProviderUnavailable extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProviderUnavailable";
    this.status = status;
  }
}

/** The provider refused the request; its message says why. */
export class ProviderRejected extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderRejected";
    this.status = status;
  }
}

export interface CalendarAdapter {
  readonly provider: "google";
  /** Runs the OAuth flow. `open` receives the URL to show; the promise resolves when the loopback receives the code. */
  connect(opts: { open: (url: string) => void; timeoutMs?: number }): Promise<{ identity: string; scopes: string[]; credentialId: string }>;
  listCalendars(accountId: string): Promise<ProviderCalendar[]>;
  /** One page. Pass `cursor: null` for a full sync from `since`; afterwards pass the cursor from the last page. Throws CursorExpired when the provider says start over. */
  syncPage(accountId: string, calendarExternalId: string, cursor: string | null, since: string): Promise<SyncPage>;
  create(accountId: string, calendarExternalId: string, event: EventWrite, lifeId: string): Promise<ProviderEvent>;
  update(accountId: string, calendarExternalId: string, providerId: string, patch: EventPatch, etag: string): Promise<ProviderEvent>;
  delete(accountId: string, calendarExternalId: string, providerId: string): Promise<void>;
  respond(accountId: string, calendarExternalId: string, providerId: string, response: "accepted" | "declined" | "tentative"): Promise<ProviderEvent>;
  /** Move a master or single event to another calendar of the same account. The provider keeps the id and everything on the event (attendees, conferencing, exception rows). */
  move(accountId: string, fromCalendarExternalId: string, toCalendarExternalId: string, providerId: string): Promise<ProviderEvent>;
  /** The exception rows of a repeating event as the provider holds them now, cancelled and deleted ones included: the readback after a change that touches every occurrence. */
  instances(accountId: string, calendarExternalId: string, providerMasterId: string): Promise<ProviderEvent[]>;
  /**
   * Revoke the grant behind a credential file at the provider, leaving the
   * file for the caller to delete: what `account.add` does with a sign-in no
   * account adopted and `account.remove` with the account's own. Optional
   * because not every provider has a revoke endpoint; false when there is no
   * such file.
   */
  revokeCredential?(credentialId: string): Promise<boolean>;
  instanceId(providerMasterId: string, originalStart: When): string; // the provider's id for one occurrence
}

// ------------------------------------------------------------------ FakeAdapter

/** One recorded adapter call: the method and its positional arguments. */
export type FakeCall = { method: Exclude<keyof CalendarAdapter, "provider" | "instanceId">; args: unknown[] };

/** What `seed` needs for one provider event; everything else takes a plain default. `id` becomes `external.id`. */
export type SeedEvent = Partial<Omit<ProviderEvent, "external">> & {
  id?: string;
  title: string;
  start: When;
  end: When;
  etag?: string;
};

type FakeEvent = { event: ProviderEvent; calendarExternalId: string; seq: number; revision: number };
type FakeAccount = {
  identity: string;
  /** The account id this identity's data was linked to, once an operation named one. */
  linkedId: string | null;
  calendars: Map<string, ProviderCalendar>;
  /** Cursor epochs per calendar: bumping one expires every cursor issued before it. */
  epochs: Map<string, number>;
  events: Map<string, FakeEvent>;
  /** What a calendar an event was moved out of still lists: the event as deleted, the way Google's source calendar reports a move. */
  tombstones: FakeEvent[];
};

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];
const DEFAULT_IDENTITY = "neel@example.com";
const DEFAULT_CLOCK: Clock = { now: () => new Date("2026-09-09T12:00:00Z"), timezone: "UTC" };

/** The provider's stamp for an occurrence: `20260910T160000Z` for a timed one, `20260910` for an all-day one. */
function occurrenceStamp(originalStart: When): string {
  if (isTimedWhen(originalStart)) return toInstant(new Date(originalStart.at)).replace(/[-:]/g, "");
  return originalStart.date.replace(/-/g, "");
}

/** The inverse of `occurrenceStamp`, with the master's zone for a timed one. */
function stampToWhen(stamp: string, master: When): When | null {
  const timed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (timed) {
    const [, y, mo, d, h, mi, s] = timed;
    const at = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    if (Number.isNaN(Date.parse(at))) return null;
    return { at, timezone: isTimedWhen(master) ? master.timezone : null };
  }
  const dated = /^(\d{4})(\d{2})(\d{2})$/.exec(stamp);
  if (dated) return { date: `${dated[1]}-${dated[2]}-${dated[3]}` };
  return null;
}

/** The signed span from `a` to `b`: milliseconds for timed moments, days for dates; zero across kinds. */
function spanBetween(a: When, b: When): number {
  if (isTimedWhen(a) && isTimedWhen(b)) return Date.parse(b.at) - Date.parse(a.at);
  if (!isTimedWhen(a) && !isTimedWhen(b)) return daysBetween(a.date, b.date);
  return 0;
}

/** `when` moved by `span` (milliseconds or days, per its kind), in `timezone` when one is given. */
function shiftWhen(when: When, span: number, timezone?: string | null): When {
  if (isTimedWhen(when)) return { at: toInstant(new Date(Date.parse(when.at) + span)), timezone: timezone === undefined ? when.timezone : timezone };
  return { date: addDays(when.date, span) };
}

/** The end that keeps `master`'s duration when an occurrence starts at `start`. */
function endFor(start: When, master: { start: When; end: When }): When {
  if (isTimedWhen(start) && isTimedWhen(master.start) && isTimedWhen(master.end)) {
    const length = Date.parse(master.end.at) - Date.parse(master.start.at);
    return { at: toInstant(new Date(Date.parse(start.at) + length)), timezone: start.timezone };
  }
  if (!isTimedWhen(start) && !isTimedWhen(master.start) && !isTimedWhen(master.end)) {
    return { date: addDays(start.date, Math.max(1, daysBetween(master.start.date, master.end.date))) };
  }
  return start;
}

/**
 * An in-memory provider. Calendars and events live per account, keyed by the
 * account id an operation names or by the identity `connect` returned (the
 * first operation naming an unknown account id after a `connect` links the two,
 * so an `account.add` flow finds what a test seeded under the identity).
 * Every provider call is recorded in `calls`; `failNext` makes the next one
 * throw. Cursors encode a change sequence number: a full sync returns what the
 * calendar holds, an incremental sync returns what changed after the cursor.
 *
 * It models what Google does around a repeating master and a move, so the
 * operations are tested against the provider's behaviour rather than a local
 * guess: a cancelled non-instance is a deleted one; a time change on a master
 * re-keys its exception rows (new instance ids and original starts, their own
 * times moved by the same delta); dropping the rule or changing between timed
 * and all-day deletes them; a move keeps the provider id and leaves a
 * tombstone in the source calendar's listing.
 */
export class FakeAdapter implements CalendarAdapter {
  readonly provider = "google" as const;
  readonly calls: FakeCall[] = [];
  readonly pageSize: number;
  #clock: Clock;
  #accounts = new Map<string, FakeAccount>();
  #seq = 0;
  #ids = 0;
  #credentials = 0;
  #nextError: Error | null = null;
  #nextConnect: { identity: string; scopes: string[] } | null = null;
  #lastConnected: string | null = null;

  constructor(opts: { clock?: Clock; pageSize?: number } = {}) {
    this.#clock = opts.clock ?? DEFAULT_CLOCK;
    this.pageSize = opts.pageSize ?? 250;
  }

  // ---------------------------------------------------------------- the interface

  async connect(opts: { open: (url: string) => void; timeoutMs?: number }): Promise<{ identity: string; scopes: string[]; credentialId: string }> {
    this.#call("connect", [opts]);
    const next = this.#nextConnect ?? { identity: DEFAULT_IDENTITY, scopes: DEFAULT_SCOPES };
    this.#nextConnect = null;
    opts.open(`https://accounts.google.com/o/oauth2/v2/auth?fake=1&login_hint=${encodeURIComponent(next.identity)}`);
    this.#byIdentity(next.identity);
    this.#lastConnected = next.identity;
    return { identity: next.identity, scopes: [...next.scopes], credentialId: `fake-credential-${++this.#credentials}` };
  }

  async listCalendars(accountId: string): Promise<ProviderCalendar[]> {
    this.#call("listCalendars", [accountId]);
    return [...this.#account(accountId).calendars.values()].map((calendar) => ({ ...calendar }));
  }

  async syncPage(accountId: string, calendarExternalId: string, cursor: string | null, since: string): Promise<SyncPage> {
    this.#call("syncPage", [accountId, calendarExternalId, cursor, since]);
    const account = this.#account(accountId);
    if (!account.calendars.has(calendarExternalId)) throw new ProviderRejected(`Calendar not found: ${calendarExternalId}`, 404);
    const epoch = account.epochs.get(calendarExternalId) ?? 0;
    const parsed = parseCursor(cursor, calendarExternalId, epoch);
    if (!parsed) throw new CursorExpired();
    const bound = parsed.bound ?? this.#seq;
    const inCalendar = [...account.events.values(), ...account.tombstones].filter((fake) => fake.calendarExternalId === calendarExternalId && fake.seq <= bound);
    const candidates = parsed.mode === "full" ? inCalendar.filter((fake) => mentionedByFullSync(fake.event, since)) : inCalendar.filter((fake) => fake.seq > parsed.after);
    candidates.sort((a, b) => a.seq - b.seq);
    const page = candidates.slice(parsed.offset, parsed.offset + this.pageSize);
    const more = parsed.offset + this.pageSize < candidates.length;
    const items = page.map((fake) => structuredClone(fake.event));
    if (more) {
      const after = parsed.mode === "full" ? "" : String(parsed.after);
      return { items, nextCursor: `page:${parsed.mode}:${calendarExternalId}:${epoch}:${bound}:${parsed.offset + this.pageSize}:${after}`, done: false };
    }
    return { items, nextCursor: `sync:${calendarExternalId}:${epoch}:${bound}`, done: true };
  }

  async create(accountId: string, calendarExternalId: string, event: EventWrite, lifeId: string): Promise<ProviderEvent> {
    this.#call("create", [accountId, calendarExternalId, event, lifeId]);
    const account = this.#account(accountId);
    const calendar = this.#writable(account, calendarExternalId);
    const id = this.#newProviderId();
    const created: ProviderEvent = {
      title: event.title,
      notes: event.notes,
      location: event.location,
      start: event.start,
      end: event.end,
      repeat: event.repeat,
      originalStart: null,
      status: event.status,
      busy: event.busy,
      organizer: { email: account.identity, name: null, self: true },
      attendees: [],
      myResponse: null,
      conferencing: null,
      reminders: null,
      external: { provider: "google", id, etag: "", iCalUID: `${id}@google.com`, updatedAt: this.#now() },
      providerMasterId: null,
      deleted: false,
      lifeId,
    };
    const fake: FakeEvent = { event: created, calendarExternalId: calendar.id, seq: 0, revision: 0 };
    this.#touch(fake);
    account.events.set(id, fake);
    return structuredClone(fake.event);
  }

  async update(accountId: string, calendarExternalId: string, providerId: string, patch: EventPatch, etag: string): Promise<ProviderEvent> {
    this.#call("update", [accountId, calendarExternalId, providerId, patch, etag]);
    const account = this.#account(accountId);
    this.#writable(account, calendarExternalId);
    const fake = this.#find(account, calendarExternalId, providerId);
    if (etag && etag !== fake.event.external.etag) {
      throw new ProviderRejected(`Etag mismatch on ${providerId}: the event changed since it was read`, 412);
    }
    const target = fake.event;
    const before = { start: target.start, repeat: target.repeat };
    if (patch.title !== undefined) target.title = patch.title;
    if (patch.notes !== undefined) target.notes = patch.notes;
    if (patch.location !== undefined) target.location = patch.location;
    if (patch.start !== undefined) target.start = patch.start;
    if (patch.end !== undefined) target.end = patch.end;
    if (patch.repeat !== undefined) target.repeat = patch.repeat;
    if (patch.busy !== undefined) target.busy = patch.busy;
    if (patch.status !== undefined) target.status = patch.status;
    // To Google a cancelled event that is not an instance is a deleted one; map.ts reads it back that way.
    if (patch.status === "cancelled" && target.providerMasterId === null) target.deleted = true;
    this.#touch(fake);
    if (target.providerMasterId === null && before.repeat) this.#rekeyExceptions(account, fake, before.start);
    return structuredClone(fake.event);
  }

  async delete(accountId: string, calendarExternalId: string, providerId: string): Promise<void> {
    this.#call("delete", [accountId, calendarExternalId, providerId]);
    const account = this.#account(accountId);
    this.#writable(account, calendarExternalId);
    const fake = this.#find(account, calendarExternalId, providerId);
    if (fake.event.deleted) throw new ProviderRejected(`Already deleted: ${providerId}`, 410);
    if (fake.event.providerMasterId) {
      // Deleting one occurrence cancels it: the provider keeps the instance as a cancelled exception.
      fake.event.status = "cancelled";
      this.#touch(fake);
      return;
    }
    fake.event.deleted = true;
    this.#touch(fake);
    for (const other of account.events.values()) {
      if (other.event.providerMasterId === providerId && !other.event.deleted) {
        other.event.deleted = true;
        this.#touch(other);
      }
    }
  }

  async respond(accountId: string, calendarExternalId: string, providerId: string, response: "accepted" | "declined" | "tentative"): Promise<ProviderEvent> {
    this.#call("respond", [accountId, calendarExternalId, providerId, response]);
    const account = this.#account(accountId);
    const fake = this.#find(account, calendarExternalId, providerId);
    const self = fake.event.attendees.find((attendee) => attendee.self);
    if (!self) throw new ProviderRejected(`Not an attendee of ${providerId}; nothing to respond to`, 400);
    self.response = response;
    fake.event.myResponse = response;
    this.#touch(fake);
    return structuredClone(fake.event);
  }

  async move(accountId: string, fromCalendarExternalId: string, toCalendarExternalId: string, providerId: string): Promise<ProviderEvent> {
    this.#call("move", [accountId, fromCalendarExternalId, toCalendarExternalId, providerId]);
    const account = this.#account(accountId);
    this.#writable(account, fromCalendarExternalId);
    const destination = this.#writable(account, toCalendarExternalId);
    const fake = account.events.get(providerId);
    if (!fake || fake.calendarExternalId !== fromCalendarExternalId) throw new ProviderRejected(`Event not found: ${providerId}`, 404);
    if (fake.event.deleted) throw new ProviderRejected(`Already deleted: ${providerId}`, 410);
    if (fake.event.providerMasterId !== null) throw new ProviderRejected(`Cannot move one instance of a recurring event: ${providerId}`, 400);
    if (destination.id === fromCalendarExternalId) return structuredClone(fake.event);
    const exceptions = [...account.events.values()].filter((other) => other.event.providerMasterId === providerId);
    for (const moving of [fake, ...exceptions]) {
      // The source calendar goes on listing the item, as deleted, the way Google reports a move to a sync of the source.
      account.tombstones.push({ event: { ...structuredClone(moving.event), deleted: true }, calendarExternalId: fromCalendarExternalId, seq: ++this.#seq, revision: moving.revision });
      moving.calendarExternalId = destination.id;
      this.#touch(moving);
    }
    return structuredClone(fake.event);
  }

  async instances(accountId: string, calendarExternalId: string, providerMasterId: string): Promise<ProviderEvent[]> {
    this.#call("instances", [accountId, calendarExternalId, providerMasterId]);
    const account = this.#account(accountId);
    if (!account.calendars.has(calendarExternalId)) throw new ProviderRejected(`Calendar not found: ${calendarExternalId}`, 404);
    const master = account.events.get(providerMasterId);
    if (!master || master.calendarExternalId !== calendarExternalId) throw new ProviderRejected(`Event not found: ${providerMasterId}`, 404);
    return [...account.events.values()]
      .filter((fake) => fake.event.providerMasterId === providerMasterId && fake.calendarExternalId === calendarExternalId)
      .sort((a, b) => a.seq - b.seq)
      .map((fake) => structuredClone(fake.event));
  }

  instanceId(providerMasterId: string, originalStart: When): string {
    return `${providerMasterId}_${occurrenceStamp(originalStart)}`;
  }

  // ---------------------------------------------------------------- test helpers

  /** The next call throws `error` (a CursorExpired, ProviderUnavailable, or ProviderRejected, typically) after being recorded. One shot. */
  failNext(error: Error): void {
    this.#nextError = error;
  }

  /** What the next `connect` returns. */
  connectAs(identity: string, scopes: string[] = DEFAULT_SCOPES): void {
    this.#nextConnect = { identity, scopes: [...scopes] };
  }

  /** Bind an account id to an identity's data explicitly, for tests that do not go through `connect`. */
  link(accountId: string, identity: string): void {
    const account = this.#byIdentity(identity);
    account.linkedId = accountId;
    this.#accounts.set(accountId, account);
  }

  /** Put a calendar (upsert by id) and events into an account; returns the events as the provider now holds them. */
  seed(accountId: string, calendar: ProviderCalendar, events: SeedEvent[] = []): ProviderEvent[] {
    const account = this.#account(accountId);
    account.calendars.set(calendar.id, { ...calendar });
    return events.map((seed) => {
      const { id, etag, ...rest } = seed;
      const providerId = id ?? this.#newProviderId();
      const event: ProviderEvent = {
        notes: null,
        location: null,
        repeat: null,
        originalStart: null,
        status: "confirmed",
        busy: !("date" in seed.start),
        organizer: null,
        attendees: [],
        myResponse: null,
        conferencing: null,
        reminders: null,
        providerMasterId: null,
        deleted: false,
        lifeId: null,
        ...rest,
        external: { provider: "google", id: providerId, etag: "", iCalUID: `${providerId}@google.com`, updatedAt: this.#now() },
      };
      const fake: FakeEvent = { event, calendarExternalId: calendar.id, seq: 0, revision: 0 };
      this.#touch(fake);
      if (etag !== undefined) fake.event.external.etag = etag;
      account.events.set(providerId, fake);
      return structuredClone(fake.event);
    });
  }

  /** Change an event provider-side (someone edited it on the phone): merges `patch`, bumps the etag and the change sequence. */
  change(accountId: string, providerId: string, patch: Partial<Omit<ProviderEvent, "external">> & { external?: Partial<ProviderEvent["external"]> }): ProviderEvent {
    const account = this.#account(accountId);
    const fake = account.events.get(providerId);
    if (!fake) throw new Error(`FakeAdapter.change: no event ${providerId} in ${accountId}`);
    const { external, ...rest } = patch;
    Object.assign(fake.event, rest);
    if (external) Object.assign(fake.event.external, external);
    this.#touch(fake);
    return structuredClone(fake.event);
  }

  /** Forget an event entirely, so a full sync no longer mentions it (unlike `change(..., { deleted: true })`, which it does). */
  remove(accountId: string, providerId: string): void {
    const account = this.#account(accountId);
    account.events.delete(providerId);
    account.tombstones = account.tombstones.filter((fake) => fake.event.external.id !== providerId);
  }

  /** Rename or re-permission a calendar provider-side. */
  changeCalendar(accountId: string, calendarExternalId: string, patch: Partial<Omit<ProviderCalendar, "id">>): ProviderCalendar {
    const account = this.#account(accountId);
    const calendar = account.calendars.get(calendarExternalId);
    if (!calendar) throw new Error(`FakeAdapter.changeCalendar: no calendar ${calendarExternalId} in ${accountId}`);
    Object.assign(calendar, patch);
    return { ...calendar };
  }

  /** The provider no longer lists the calendar; its events go with it. */
  removeCalendar(accountId: string, calendarExternalId: string): void {
    const account = this.#account(accountId);
    account.calendars.delete(calendarExternalId);
    for (const [id, fake] of account.events) if (fake.calendarExternalId === calendarExternalId) account.events.delete(id);
    account.tombstones = account.tombstones.filter((fake) => fake.calendarExternalId !== calendarExternalId);
  }

  /** Every cursor issued so far for the calendar now throws CursorExpired. */
  expireCursors(accountId: string, calendarExternalId: string): void {
    const account = this.#account(accountId);
    account.epochs.set(calendarExternalId, (account.epochs.get(calendarExternalId) ?? 0) + 1);
  }

  /** One event as the provider holds it, or null. */
  event(accountId: string, providerId: string): ProviderEvent | null {
    const fake = this.#account(accountId).events.get(providerId);
    return fake ? structuredClone(fake.event) : null;
  }

  /** The provider's events for an account (or one of its calendars), oldest change first. Tombstones left by a move are not events and are not listed here. */
  events(accountId: string, calendarExternalId?: string): ProviderEvent[] {
    return [...this.#account(accountId).events.values()]
      .filter((fake) => calendarExternalId === undefined || fake.calendarExternalId === calendarExternalId)
      .sort((a, b) => a.seq - b.seq)
      .map((fake) => structuredClone(fake.event));
  }

  /** The recorded calls to one method. */
  callsTo(method: FakeCall["method"]): FakeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  // ---------------------------------------------------------------- internals

  #call(method: FakeCall["method"], args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.#nextError) {
      const error = this.#nextError;
      this.#nextError = null;
      throw error;
    }
  }

  #now(): string {
    return toInstant(this.#clock.now());
  }

  #newProviderId(): string {
    return `fake${String(++this.#ids).padStart(4, "0")}`;
  }

  /** A change happened: new sequence number, new etag, new provider updatedAt. */
  #touch(fake: FakeEvent): void {
    fake.seq = ++this.#seq;
    fake.revision += 1;
    fake.event.external.etag = `etag-${fake.event.external.id}-${fake.revision}`;
    fake.event.external.updatedAt = this.#now();
  }

  #byIdentity(identity: string): FakeAccount {
    let account = this.#accounts.get(identity);
    if (!account) {
      account = { identity, linkedId: null, calendars: new Map(), epochs: new Map(), events: new Map(), tombstones: [] };
      this.#accounts.set(identity, account);
    }
    return account;
  }

  /** The data for an account id, linking it to the identity `connect` last returned if that identity is not yet bound. */
  #account(accountId: string): FakeAccount {
    const known = this.#accounts.get(accountId);
    if (known) return known;
    if (this.#lastConnected) {
      const connected = this.#byIdentity(this.#lastConnected);
      if (connected.linkedId === null) {
        connected.linkedId = accountId;
        this.#accounts.set(accountId, connected);
        this.#lastConnected = null;
        return connected;
      }
    }
    // A key with an @ is an identity seeded before any connect; anything else is an account id nobody connected.
    if (accountId.includes("@")) return this.#byIdentity(accountId);
    const fresh: FakeAccount = { identity: `${accountId}@fake.local`, linkedId: accountId, calendars: new Map(), epochs: new Map(), events: new Map(), tombstones: [] };
    this.#accounts.set(accountId, fresh);
    return fresh;
  }

  #writable(account: FakeAccount, calendarExternalId: string): ProviderCalendar {
    const calendar = account.calendars.get(calendarExternalId);
    if (!calendar) throw new ProviderRejected(`Calendar not found: ${calendarExternalId}`, 404);
    if (!calendar.writable) throw new ProviderRejected(`Calendar is read-only: ${calendar.name}`, 403);
    return calendar;
  }

  /**
   * What Google does to a master's exception rows when the master changed:
   * gone with the rule or with a change between timed and all-day; otherwise
   * re-keyed from the new start (a new instance id and original start, their
   * own times moved by the same delta, the new zone taken on). Every row that
   * changed gets a new etag and shows up in the next incremental sync.
   */
  #rekeyExceptions(account: FakeAccount, master: FakeEvent, startBefore: When): void {
    const masterId = master.event.external.id;
    const exceptions = [...account.events.entries()].filter(([, other]) => other.event.providerMasterId === masterId && !other.event.deleted);
    if (!exceptions.length) return;
    const start = master.event.start;
    if (!master.event.repeat || isTimedWhen(start) !== isTimedWhen(startBefore)) {
      for (const [, other] of exceptions) {
        other.event.deleted = true;
        this.#touch(other);
      }
      return;
    }
    const span = spanBetween(startBefore, start);
    const timezone = isTimedWhen(start) ? start.timezone : undefined;
    const zoneChanged = isTimedWhen(start) && isTimedWhen(startBefore) && start.timezone !== startBefore.timezone;
    if (span === 0 && !zoneChanged) return;
    for (const [id, other] of exceptions) {
      const originalStart = shiftWhen(other.event.originalStart ?? other.event.start, span, timezone);
      other.event.originalStart = originalStart;
      other.event.start = shiftWhen(other.event.start, span, timezone);
      other.event.end = shiftWhen(other.event.end, span, timezone);
      other.event.external.id = `${masterId}_${occurrenceStamp(originalStart)}`;
      account.events.delete(id);
      account.events.set(other.event.external.id, other);
      this.#touch(other);
    }
  }

  /**
   * The event with `providerId`, or the exception row the provider materializes
   * when the id names one occurrence of a repeating master (`<masterId>_<stamp>`).
   */
  #find(account: FakeAccount, calendarExternalId: string, providerId: string): FakeEvent {
    const direct = account.events.get(providerId);
    if (direct) {
      if (direct.calendarExternalId !== calendarExternalId) throw new ProviderRejected(`Event ${providerId} is not in calendar ${calendarExternalId}`, 404);
      return direct;
    }
    const split = providerId.lastIndexOf("_");
    const master = split > 0 ? account.events.get(providerId.slice(0, split)) : undefined;
    const originalStart = master ? stampToWhen(providerId.slice(split + 1), master.event.start) : null;
    if (!master || !master.event.repeat || master.event.deleted || !originalStart || master.calendarExternalId !== calendarExternalId) {
      throw new ProviderRejected(`Event not found: ${providerId}`, 404);
    }
    const instance: ProviderEvent = {
      ...structuredClone(master.event),
      start: originalStart,
      end: endFor(originalStart, master.event),
      repeat: null,
      originalStart,
      providerMasterId: master.event.external.id,
      external: { ...master.event.external, id: providerId, etag: "" },
      lifeId: null,
    };
    const fake: FakeEvent = { event: instance, calendarExternalId, seq: 0, revision: 0 };
    this.#touch(fake);
    account.events.set(providerId, fake);
    return fake;
  }
}

type ParsedCursor =
  | { mode: "full"; bound: number | null; offset: number }
  | { mode: "incremental"; bound: number | null; offset: number; after: number };

/**
 * `null` starts a full sync; `sync:<calendar>:<epoch>:<seq>` continues after
 * `seq`; `page:<mode>:<calendar>:<epoch>:<bound>:<offset>:<after>` is the next
 * page of a sync already under way. Anything else, another calendar's cursor,
 * or an older epoch is expired.
 */
function parseCursor(cursor: string | null, calendarExternalId: string, epoch: number): ParsedCursor | null {
  if (cursor === null) return { mode: "full", bound: null, offset: 0 };
  const parts = cursor.split(":");
  if (parts[0] === "sync" && parts.length === 4) {
    const [, calendar, cursorEpoch, seq] = parts;
    if (calendar !== calendarExternalId || Number(cursorEpoch) !== epoch) return null;
    const after = Number(seq);
    return Number.isInteger(after) ? { mode: "incremental", bound: null, offset: 0, after } : null;
  }
  if (parts[0] === "page" && parts.length === 7) {
    const [, mode, calendar, cursorEpoch, bound, offset, after] = parts;
    if (calendar !== calendarExternalId || Number(cursorEpoch) !== epoch) return null;
    if (!Number.isInteger(Number(bound)) || !Number.isInteger(Number(offset))) return null;
    if (mode === "full") return { mode, bound: Number(bound), offset: Number(offset) };
    if (mode === "incremental" && Number.isInteger(Number(after))) return { mode, bound: Number(bound), offset: Number(offset), after: Number(after) };
  }
  return null;
}

/** What a full sync from `since` lists: deleted items, masters, exception rows, and anything ending at or after `since`. */
function mentionedByFullSync(event: ProviderEvent, since: string): boolean {
  if (event.deleted || event.repeat || event.providerMasterId) return true;
  if (isTimedWhen(event.end)) return Date.parse(event.end.at) >= Date.parse(since);
  return event.end.date >= since.slice(0, 10);
}
