// Event operations: every write goes to the provider first and the readback
// is what gets stored (HANDS D59). Adding, updating, rescheduling, moving,
// answering, cancelling, deleting, restoring, and duplicating events, with the
// this / following / all scopes on a repeating series (D60), plus get and list
// over expanded occurrences. Every write runs inside core.mutate, so the
// provider call happens under the writer lock and a rejection stores nothing.
// The provider's copy of a row lives in the readback; sync (sync.ts) is what
// reconciles anything the provider does differently afterwards.

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  calendarId as calendarIdSchema,
  calendarRef as calendarRefSchema,
  endsAfterStart,
  eventAddSchema,
  eventId as eventIdSchema,
  eventUpdateSchema,
  isTimedWhen,
  issuesOf,
  sameWhenKind,
  when as whenSchema,
  whenKey,
  type Account,
  type Calendar,
  type Ctx,
  type Event,
  type EventAdd,
  type EventPatch,
  type EventUpdate,
  type EventWrite,
  type LogEntry,
  type Receipt,
  type When,
} from "../contract.ts";
import { applyIn, bump, checkVersion, diff, fail, mutate, newId, okMutation, rejected, type Clock, type Mutation } from "../core.ts";
import type { Store, Tx } from "../store.ts";
import { addDays, daysBetween, dayWindow, isInstant, isValidDate, toInstant, zonedToInstant } from "../time.ts";
import { ProviderRejected, ProviderUnavailable, type CalendarAdapter, type ProviderEvent } from "./adapter.ts";
import { expandEvent, expandEvents, occurrenceRef, parseOccurrenceRef, type Occurrence } from "./expand.ts";
import { NeedsReauth } from "./google/oauth.ts";
import { markNeedsReauth, type Adapters } from "./sync.ts";

// ------------------------------------------------------------------ types

export const SCOPES = ["this", "following", "all"] as const;
export type Scope = (typeof SCOPES)[number];
export type ScopeOptions = { scope?: Scope };
export type EventResponse = "accepted" | "declined" | "tentative";
export type EventReschedule = { start: When; end?: When };
export type EventDuplicateOptions = { calendar?: string };
export type EventListOptions = {
  /** An instant, or a date (the start of that day in the display zone). */
  from: string;
  /** An instant (exclusive), or a date (that whole day, inclusive). */
  to: string;
  /** Calendar refs; default every non-deleted calendar. A hidden calendar named here is included. */
  calendars?: string[];
  includeHidden?: boolean;
  includeDeleted?: boolean;
};

/**
 * A receipt plus what a provider write can add: `warnings` (a `following`
 * split names the truncated original) and `partial` (the first of two
 * provider calls succeeded and the second failed; nothing was stored, the
 * next sync shows what the provider now holds).
 */
export type EventReceipt = Receipt<Event> & { warnings?: string[]; partial?: boolean };

/** The issue prefixes a provider failure carries: `provider_unavailable: <message>`, `provider_rejected: <message>`, and `needs_reauth: <message>` (the account was marked, reconnect it). */
export const PROVIDER_UNAVAILABLE = "provider_unavailable";
export const PROVIDER_REJECTED = "provider_rejected";
export const NEEDS_REAUTH = "needs_reauth";

export interface EventOps {
  add(input: EventAdd, ctx: Ctx): Promise<EventReceipt>;
  /** An event by id (deleted included; callers check `deletedAt`), or one occurrence by `<id>@<originalStart>`. */
  get(ref: string): Promise<Event | Occurrence | null>;
  /** Expanded occurrences in the window, sorted by start. Throws when the window or a calendar ref is invalid; an empty result is `[]`. Does not refresh. */
  list(opts: EventListOptions): Promise<Occurrence[]>;
  update(ref: string, input: EventUpdate, ctx: Ctx, opts?: ScopeOptions): Promise<EventReceipt>;
  reschedule(ref: string, input: EventReschedule, ctx: Ctx, opts?: ScopeOptions): Promise<EventReceipt>;
  move(ref: string, calendarRef: string, ctx: Ctx): Promise<EventReceipt>;
  respond(ref: string, response: EventResponse, ctx: Ctx, opts?: ScopeOptions): Promise<EventReceipt>;
  cancel(ref: string, ctx: Ctx, opts?: ScopeOptions): Promise<EventReceipt>;
  delete(ref: string, ctx: Ctx, opts?: ScopeOptions): Promise<EventReceipt>;
  restore(id: string, ctx: Ctx): Promise<EventReceipt>;
  duplicate(ref: string, ctx: Ctx, opts?: EventDuplicateOptions): Promise<EventReceipt>;
  history(id: string): Promise<LogEntry[]>;
}

// ------------------------------------------------------------------ input schemas local to events

const scopeOptionsSchema = z.strictObject({ scope: z.enum(SCOPES).optional() });
const responseSchema = z.enum(["accepted", "declined", "tentative"]);
const rescheduleSchema = z
  .strictObject({ start: whenSchema, end: whenSchema.optional() })
  .superRefine((value, ctx) => {
    if (value.end === undefined) return;
    if (!sameWhenKind(value.start, value.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "Start and end must both be timed or both be dates" });
    else if (!endsAfterStart(value.start, value.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "End must be after start" });
  });
const duplicateOptionsSchema = z.strictObject({ calendar: calendarRefSchema.optional() });
const listOptionsSchema = z.strictObject({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  calendars: z.array(calendarRefSchema).max(100).optional(),
  includeHidden: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
});

// ------------------------------------------------------------------ small helpers

const DAY_MS = 86400000;
const DEFAULT_MINUTES = 60;
const DEFAULT_DAYS = 1;
/** The etag a row carries until sync reads the provider's: a cancelled instance is written with `adapter.delete`, which returns nothing. */
const PENDING_ETAG = "pending-sync";

type Lookup<T> = { ok: true; record: T } | { ok: false; issues: string[]; id?: string };
const failed = (lookup: { issues: string[]; id?: string }): Mutation<Event> => fail<Event>(lookup.issues, lookup.id !== undefined ? { id: lookup.id } : {});
const isEventId = (value: string): boolean => eventIdSchema.safeParse(value).success;
const isCalendarId = (value: string): boolean => calendarIdSchema.safeParse(value).success;

/** The event id an idempotency key derives: `e_` plus the first ten base36 digits of sha256(key), so a retry meets its own row. */
export function keyedEventId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `e_${BigInt(`0x${hex}`).toString(36).padStart(10, "0").slice(0, 10)}`;
}

function originOf(ctx: Ctx, now: string): Event["origin"] {
  return {
    actor: ctx.actor,
    at: now,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
    evidence: ctx.evidence ?? [],
  };
}

/** A ctx for the rows a write drags along (exception rows, the truncated original): no key, no version guard. */
function cascadeCtx(ctx: Ctx): Ctx {
  const { key: _key, ifVersion: _ifVersion, ...rest } = ctx;
  return rest;
}

/** A cascaded write was rejected: abort the transaction and surface the issues as the primary receipt. */
class CascadeRejected extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
  }
}

function must(receipt: Receipt<Event>, what: string): Event {
  if (!receipt.ok) throw new CascadeRejected(receipt.issues.map((issue) => `${what}: ${issue}`));
  return receipt.record;
}

/** An originalStart key in one spelling: dates as they are, instants without fractional seconds. */
function normalizeKey(key: string): string {
  if (isValidDate(key)) return key;
  const parsed = Date.parse(key);
  return Number.isNaN(parsed) ? key : toInstant(new Date(parsed));
}

/** The instant a key stands for: the instant itself, or the date's midnight in `tz`. */
function keyInstant(key: string, tz: string): number | null {
  if (isValidDate(key)) return zonedToInstant(`${key}T00:00`, tz)?.getTime() ?? Date.parse(`${key}T00:00:00Z`);
  const parsed = Date.parse(key);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The signed span from `a` to `b`: milliseconds for timed moments, days for dates. Same kind only. */
function spanOf(a: When, b: When): number {
  if (isTimedWhen(a) && isTimedWhen(b)) return Date.parse(b.at) - Date.parse(a.at);
  if (!isTimedWhen(a) && !isTimedWhen(b)) return daysBetween(a.date, b.date);
  return 0;
}

/** `when` moved by `span` (milliseconds or days, per its kind), keeping its zone unless `timezone` overrides it. */
function shifted(when: When, span: number, timezone?: string | null): When {
  if (isTimedWhen(when)) return { at: toInstant(new Date(Date.parse(when.at) + span)), timezone: timezone === undefined ? when.timezone : timezone };
  return { date: addDays(when.date, span) };
}

/** The end `duration` after `start`: minutes for a timed start, days for an all-day one. */
function endAfter(start: When, duration: number): When {
  return isTimedWhen(start) ? shifted(start, duration * 60000) : shifted(start, duration);
}

/** What a provider readback contributes to a row: everything but the sync-only markers. */
function providerFields(item: ProviderEvent): Omit<ProviderEvent, "providerMasterId" | "deleted" | "lifeId"> {
  const { providerMasterId: _master, deleted: _deleted, lifeId: _lifeId, ...fields } = item;
  return fields;
}

type RowBase = Pick<Event, "id" | "calendarId" | "accountId" | "masterId" | "originalStart" | "origin" | "version" | "createdAt" | "updatedAt" | "deletedAt">;

/** A row from a provider readback: the provider's fields under our identity and bookkeeping. An exception row never carries a rule. */
function fromReadback(readback: ProviderEvent, base: RowBase): Event {
  const fields = providerFields(readback);
  return { ...fields, ...base, repeat: base.masterId ? null : fields.repeat };
}

function baseOf(row: Event): RowBase {
  return {
    id: row.id,
    calendarId: row.calendarId,
    accountId: row.accountId,
    masterId: row.masterId,
    originalStart: row.originalStart,
    origin: row.origin,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** The whole-event write shape of a row or an occurrence, as a provider takes it. */
function writeOf(source: Pick<Event, "title" | "notes" | "location" | "start" | "end" | "repeat" | "busy" | "status">): EventWrite {
  return {
    title: source.title,
    notes: source.notes,
    location: source.location,
    start: source.start,
    end: source.end,
    repeat: source.repeat,
    busy: source.busy,
    status: source.status,
  };
}

/** The patch that re-applies an exception row onto a freshly created series. */
function instancePatch(row: Event): EventPatch {
  return { title: row.title, notes: row.notes, location: row.location, start: row.start, end: row.end, busy: row.busy, status: row.status };
}

/** The fields an occurrence shares with a row, for a no-op check before a provider call. */
type Patchable = Pick<Event, "title" | "notes" | "location" | "start" | "end" | "repeat" | "busy" | "status">;
function patchable(source: Patchable): Patchable {
  return { title: source.title, notes: source.notes, location: source.location, start: source.start, end: source.end, repeat: source.repeat, busy: source.busy, status: source.status };
}

function changes(before: Patchable, patch: EventPatch): boolean {
  return Object.keys(diff(patchable(before), { ...patchable(before), ...patch })).length > 0;
}

// ------------------------------------------------------------------ provider calls

type Called<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/** What a write carries out of the mutation besides the receipt: warnings, the partial flag, and the account a dead credential was found on. */
type Meta = { warnings: string[]; partial: boolean; reauth: string | null };

/**
 * Runs one provider call: an unreachable provider, a refusal, and a credential
 * the provider no longer accepts become issues (nothing was stored); anything
 * else is a bug and throws. A dead credential is also noted on `meta` so the
 * write marks the account `needs_reauth` once the mutation has unwound.
 */
async function call<T>(meta: Meta, work: () => Promise<T>): Promise<Called<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof ProviderUnavailable) return { ok: false, issues: [`${PROVIDER_UNAVAILABLE}: ${error.message}`] };
    if (error instanceof ProviderRejected) return { ok: false, issues: [`${PROVIDER_REJECTED}: ${error.message}`] };
    if (error instanceof NeedsReauth) {
      meta.reauth = error.accountId;
      return { ok: false, issues: [`${NEEDS_REAUTH}: ${error.message}`] };
    }
    throw error;
  }
}

/** A delete: the provider answering that the event is already gone (410, as Google does for a cancelled or deleted event) is the outcome asked for, not a refusal. */
async function callDelete(meta: Meta, work: () => Promise<void>): Promise<Called<void>> {
  try {
    await work();
    return { ok: true, value: undefined };
  } catch (error) {
    if (error instanceof ProviderRejected && error.status === 410) return { ok: true, value: undefined };
    return call(meta, () => Promise.reject(error));
  }
}

// ------------------------------------------------------------------ times and rules

type Times = { start: When; end: When };
type TimeInput = { start?: When; end?: When; duration?: number };

/**
 * The start and end an update asks for, against `base` (the row or the
 * occurrence it addresses): an omitted end keeps the duration, `duration`
 * counts from the (new) start, and a change between timed and all-day needs
 * both sides. `null` when the input names no time at all.
 */
function resolveTimes(base: Times, input: TimeInput): { ok: true; times: Times | null } | { ok: false; issues: string[] } {
  if (input.start === undefined && input.end === undefined && input.duration === undefined) return { ok: true, times: null };
  const start = input.start ?? base.start;
  let end: When;
  if (input.end !== undefined) end = input.end;
  else if (input.duration !== undefined) end = endAfter(start, input.duration);
  else if (input.start !== undefined) {
    if (!sameWhenKind(input.start, base.start)) return { ok: false, issues: ["end: give end or duration when changing between timed and all-day"] };
    end = shifted(start, spanOf(base.start, base.end));
  } else end = base.end;
  if (!sameWhenKind(start, end)) return { ok: false, issues: ["end: Start and end must both be timed or both be dates"] };
  if (!endsAfterStart(start, end)) {
    return { ok: false, issues: [isTimedWhen(start) ? "end: End must be after start" : "end: End date must be after the start date (it is exclusive)"] };
  }
  return { ok: true, times: { start, end } };
}

/** The provider patch for an update, with `times` already resolved. */
function buildPatch(row: Pick<Event, "repeat">, input: EventUpdate, times: Times | null): EventPatch {
  const patch: EventPatch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.location !== undefined) patch.location = input.location;
  if (times) {
    patch.start = times.start;
    patch.end = times.end;
  }
  if (input.repeat !== undefined) patch.repeat = input.repeat === null ? null : { rrule: input.repeat, exdates: row.repeat?.exdates ?? [] };
  if (input.busy !== undefined) patch.busy = input.busy;
  if (input.status !== undefined) patch.status = input.status;
  return patch;
}

/** Rewrites the RRULE line of a rule text (other lines a provider folded in stay), with `edit` over its `;`-separated parts. */
function rewriteRule(rrule: string, edit: (parts: string[]) => string[]): string {
  const lines = rrule.split(/\r?\n/);
  const index = lines.findIndex((line) => /^RRULE:/i.test(line.trim())) >= 0
    ? lines.findIndex((line) => /^RRULE:/i.test(line.trim()))
    : lines.findIndex((line) => line.trim().length > 0 && !/^(DTSTART|EXDATE|RDATE|EXRULE)/i.test(line.trim()));
  if (index < 0) return rrule;
  const line = lines[index]!.trim();
  const prefix = /^RRULE:/i.test(line) ? "RRULE:" : "";
  const parts = line.replace(/^RRULE:/i, "").split(";").filter((part) => part.length > 0);
  lines[index] = prefix + edit(parts).join(";");
  return lines.join("\n");
}

function countOf(rrule: string): number | null {
  const match = /(?:^|[;:])COUNT=(\d+)(?=;|$)/im.exec(rrule);
  return match ? Number(match[1]) : null;
}

/** The rule ending just before `split`: UNTIL one second (one day, all-day) before it, any COUNT dropped. */
function headRule(rrule: string, split: When): string {
  const until = isTimedWhen(split)
    ? toInstant(new Date(Date.parse(split.at) - 1000)).replace(/[-:]/g, "")
    : addDays(split.date, -1).replace(/-/g, "");
  return rewriteRule(rrule, (parts) => [...parts.filter((part) => !/^(UNTIL|COUNT)=/i.test(part)), `UNTIL=${until}`]);
}

/** The rule the new series continues with: the same rule, its COUNT reduced by the slots already behind the split. */
function tailRule(rrule: string, slotsBehind: number): { ok: true; rrule: string } | { ok: false; issues: string[] } {
  const count = countOf(rrule);
  if (count === null) return { ok: true, rrule };
  const remaining = count - slotsBehind;
  if (remaining <= 0) return { ok: false, issues: ["scope: no occurrences follow this one; the series already ends here"] };
  return { ok: true, rrule: rewriteRule(rrule, (parts) => parts.map((part) => (/^COUNT=/i.test(part) ? `COUNT=${remaining}` : part))) };
}

// ------------------------------------------------------------------ the factory

type Work = (tx: Tx, ctx: Ctx, now: string, meta: Meta) => Promise<Mutation<Event>>;

/** What every write needs to know about where an event lives. */
type Context = { calendar: Calendar; account: Account; adapter: CalendarAdapter };

/** What a ref names: the row, the series it belongs to, and the occurrence when the ref addresses one. */
type Target = {
  /** The row the ref names: a master, a single event, or an exception row. */
  row: Event;
  /** The series' own row: `row` unless it is an exception row whose master is live. */
  master: Event;
  /** The occurrence addressed, when the ref is an occurrence ref or an exception row id. */
  occurrence: Occurrence | null;
  /** The exception row standing in for that occurrence, if one exists. */
  exception: Event | null;
} & Context;

type Plan =
  | { kind: "single"; row: Event }
  | { kind: "this"; occurrence: Occurrence; exception: Event | null }
  | { kind: "all"; occurrence: Occurrence | null }
  | { kind: "following"; occurrence: Occurrence; exception: Event | null };

/** The event operations over `store` with `clock`, writing through the `adapters` by provider. */
export function createEvents(store: Store, clock: Clock, adapters: Adapters): EventOps {
  const tz = (): string => clock.timezone;

  async function write(op: string, ctx: Ctx, work: Work): Promise<EventReceipt> {
    const meta: Meta = { warnings: [], partial: false, reauth: null };
    let receipt: Receipt<Event>;
    try {
      receipt = await mutate(store, clock, "event", op, ctx, (tx, c, now) => work(tx, c, now, meta));
    } catch (error) {
      if (!(error instanceof CascadeRejected)) throw error;
      receipt = rejected<Event>(error.issues);
    }
    // The provider no longer accepts the credential: mark the account the way sync.ts does, after the event
    // mutation has unwound, so a rejected write still stores nothing for the event but `contextOf` refuses the next one.
    if (meta.reauth !== null) await markNeedsReauth(store, clock, meta.reauth);
    return { ...receipt, ...(meta.warnings.length ? { warnings: meta.warnings } : {}), ...(meta.partial ? { partial: true } : {}) };
  }

  // ---------------------------------------------------------------- lookups

  async function exceptionsOf(tx: Tx, masterId: string, opts: { includeDeleted?: boolean } = {}): Promise<Event[]> {
    return (await tx.all("event", opts)).filter((event) => event.masterId === masterId);
  }

  /** Calendars whose name matches: exact matches first, else case-insensitive. */
  function byName(calendars: Calendar[], name: string): Calendar[] {
    const exact = calendars.filter((calendar) => calendar.name === name);
    if (exact.length) return exact;
    const lowered = name.toLowerCase();
    return calendars.filter((calendar) => calendar.name.toLowerCase() === lowered);
  }

  /** A non-deleted calendar by id, `<identity>/<name>`, or a name unique among non-deleted calendars. */
  async function findCalendar(tx: Tx, ref: string, field = "calendar"): Promise<Lookup<Calendar>> {
    const value = ref.trim();
    if (!value) return { ok: false, issues: [`${field}: a calendar ref is required`] };
    if (isCalendarId(value)) {
      const calendar = await tx.get("calendar", value);
      if (!calendar) return { ok: false, issues: [`${field}: no calendar "${value}"; run life calendar list --hidden`] };
      if (calendar.deletedAt) return { ok: false, issues: [`${field}: calendar "${value}" is deleted; the account no longer lists it`], id: calendar.id };
      return { ok: true, record: calendar };
    }
    const calendars = await tx.all("calendar");
    const whole = byName(calendars, value);
    if (whole.length === 1) return { ok: true, record: whole[0]! };
    const slash = value.indexOf("/");
    if (whole.length === 0 && slash > 0) {
      const identity = value.slice(0, slash).trim().toLowerCase();
      const name = value.slice(slash + 1).trim();
      const accounts = (await tx.all("account")).filter((account) => account.identity.toLowerCase() === identity || (account.label ?? "").toLowerCase() === identity);
      if (!accounts.length) return { ok: false, issues: [`${field}: no account "${identity}"; run life account list`] };
      const owned = calendars.filter((calendar) => accounts.some((account) => account.id === calendar.accountId));
      const matches = byName(owned, name);
      if (matches.length === 1) return { ok: true, record: matches[0]! };
      if (matches.length === 0) return { ok: false, issues: [`${field}: no calendar "${name}" in account "${identity}"; run life calendar list --hidden`] };
      return { ok: false, issues: [`${field}: "${value}" names ${matches.length} calendars (${matches.map((c) => c.id).join(", ")}); use the id`] };
    }
    if (whole.length === 0) return { ok: false, issues: [`${field}: no calendar "${value}"; run life calendar list --hidden`] };
    return { ok: false, issues: [`${field}: "${value}" names ${whole.length} calendars (${whole.map((c) => c.id).join(", ")}); use <identity>/<name> or the id`] };
  }

  /** The primary account's main calendar: where `event.add` goes without a `calendar`. */
  async function defaultCalendar(tx: Tx): Promise<Lookup<Calendar>> {
    const primary = (await tx.all("account")).find((account) => account.primary) ?? null;
    if (!primary) return { ok: false, issues: ["calendar: no account is connected; run life account add google, or pass calendar"] };
    const main = (await tx.all("calendar")).find((calendar) => calendar.accountId === primary.id && calendar.primaryOfAccount) ?? null;
    if (!main) return { ok: false, issues: [`calendar: account "${primary.identity}" has no main calendar yet; run life account sync, or pass calendar`] };
    return { ok: true, record: main };
  }

  /** The account and adapter behind a calendar, checked for writing (`writable: false` skips the calendar's own access check, for responding). */
  async function contextOf(tx: Tx, calendar: Calendar, opts: { writable: boolean }): Promise<Lookup<Context>> {
    if (calendar.deletedAt) return { ok: false, issues: [`calendar: calendar "${calendar.name}" is deleted; the account no longer lists it`] };
    if (opts.writable && !calendar.writable) return { ok: false, issues: [`calendar: "${calendar.name}" is read-only; pick a writable calendar`] };
    const account = await tx.get("account", calendar.accountId);
    if (!account || account.deletedAt) return { ok: false, issues: [`account: the account behind calendar "${calendar.name}" is gone`] };
    if (account.status !== "connected") return { ok: false, issues: [`account: "${account.identity}" is ${account.status}; run life account add google to reconnect it`] };
    const adapter = adapters[account.provider];
    if (!adapter) return { ok: false, issues: [`provider: no ${account.provider} adapter is configured`] };
    return { ok: true, record: { calendar, account, adapter } };
  }

  /** The occurrence of `master` at `key`: an exception row standing in for it (cancelled included), or the slot the rule lays out there. */
  async function occurrenceOf(tx: Tx, master: Event, key: string): Promise<{ occurrence: Occurrence; exception: Event | null } | null> {
    const exceptions = master.repeat && master.masterId === null ? await exceptionsOf(tx, master.id) : [];
    const exception = exceptions.find((row) => row.originalStart !== null && normalizeKey(whenKey(row.originalStart)) === key) ?? null;
    if (exception) {
      return { occurrence: { ...exception, occurrenceId: occurrenceRef(master.id, exception.originalStart!), originalStart: exception.originalStart!, master: false }, exception };
    }
    const anchor = keyInstant(key, tz());
    if (anchor === null) return null;
    const window = { from: toInstant(new Date(anchor - DAY_MS)), to: toInstant(new Date(anchor + 2 * DAY_MS)), timezone: tz() };
    const found = expandEvent(master, exceptions, window).find((occurrence) => occurrence.master && normalizeKey(whenKey(occurrence.originalStart)) === key);
    return found ? { occurrence: found, exception: null } : null;
  }

  /** What `ref` names, checked for writing unless `opts.writable` is false. */
  async function resolveTarget(tx: Tx, ref: string, opts: { writable: boolean }): Promise<Lookup<Target>> {
    const parsed = parseOccurrenceRef(ref.trim());
    const id = parsed ? parsed.eventId : ref.trim();
    if (!isEventId(id)) return { ok: false, issues: [`event: no event "${ref}"`] };
    const row = await tx.get("event", id);
    if (!row) return { ok: false, issues: [`event: no event "${ref}"`] };
    if (row.deletedAt) return { ok: false, issues: [`event: event "${id}" is deleted; restore it first`], id: row.id };

    let master = row;
    let key = parsed ? normalizeKey(parsed.originalStart) : null;
    if (row.masterId !== null) {
      const own = await tx.get("event", row.masterId);
      if (own && !own.deletedAt) {
        master = own;
        const ownKey = normalizeKey(whenKey(row.originalStart!));
        if (key !== null && key !== ownKey) return { ok: false, issues: [`occurrence: "${id}" is the occurrence at ${ownKey}, not ${key}`], id: row.id };
        key = ownKey;
      }
    }

    let occurrence: Occurrence | null = null;
    let exception: Event | null = null;
    if (key !== null) {
      const found = await occurrenceOf(tx, master, key);
      if (!found) return { ok: false, issues: [`occurrence: no occurrence of "${master.id}" at ${key}`], id: master.id };
      occurrence = found.occurrence;
      exception = found.exception;
    }

    const calendar = await tx.get("calendar", master.calendarId);
    if (!calendar) return { ok: false, issues: [`calendar: no calendar "${master.calendarId}" for event "${id}"`], id: row.id };
    const context = await contextOf(tx, calendar, opts);
    if (!context.ok) return { ok: false, issues: context.issues, id: row.id };
    return { ok: true, record: { row, master, occurrence, exception, ...context.record } };
  }

  /** How a scope applies to a target: a needs rejection when a repeating event was given none. */
  function plan(target: Target, scope: Scope | undefined, options: readonly Scope[]): { ok: true; plan: Plan } | { ok: false; mutation: Mutation<Event> } {
    const { master, occurrence, exception } = target;
    if (!master.repeat || master.masterId !== null) return { ok: true, plan: { kind: "single", row: exception ?? master } };
    if (scope === undefined) {
      const message = `Event "${master.title}" repeats; pass scope ${options.map((option) => `"${option}"`).join(", ")}: this occurrence only, this and every later one, or the whole series`;
      return { ok: false, mutation: fail([message], { id: master.id, record: master, needs: { field: "scope", options: [...options], message } }) };
    }
    if (!options.includes(scope)) return { ok: false, mutation: fail([`scope: ${options.map((o) => `"${o}"`).join(" or ")} here, not "${scope}"`], { id: master.id, record: master }) };
    if (scope === "all") return { ok: true, plan: { kind: "all", occurrence } };
    if (!occurrence) {
      return { ok: false, mutation: fail([`scope: "${scope}" needs an occurrence ref (${master.id}@<originalStart>); use scope "all" for the whole series`], { id: master.id, record: master }) };
    }
    if (scope === "following" && normalizeKey(whenKey(occurrence.originalStart)) === normalizeKey(whenKey(master.start))) {
      return { ok: true, plan: { kind: "all", occurrence } }; // Following from the first occurrence is the whole series.
    }
    return { ok: true, plan: scope === "this" ? { kind: "this", occurrence, exception } : { kind: "following", occurrence, exception } };
  }

  // ---------------------------------------------------------------- cascades

  /** Soft-delete the master's live exception rows (all of them, or those at or after `fromKey`). */
  async function dropExceptions(tx: Tx, ctx: Ctx, op: string, masterId: string, fromKey: string | null): Promise<void> {
    const cascade = cascadeCtx(ctx);
    for (const row of await exceptionsOf(tx, masterId)) {
      if (fromKey !== null && normalizeKey(whenKey(row.originalStart!)) < fromKey) continue;
      must(await applyIn(tx, clock, "event", op, cascade, async (_t, _c, at) => okMutation("updated", row, bump({ ...row, deletedAt: at }, at))), `event ${row.id}`);
    }
  }

  /**
   * Bring the master's exception rows in line with what the provider now holds
   * for them (D59: the readback, never a local guess). `expectedId` names the
   * provider id a live local row should now be found under, for a provider
   * that re-keys its instances when the series moves in time. A provider row
   * no local row matches becomes a row; a live local row the provider no
   * longer lists goes to the trash, and the receipt warns.
   */
  async function reconcileExceptions(tx: Tx, ctx: Ctx, op: string, now: string, meta: Meta, master: Event, items: ProviderEvent[], expectedId: (row: Event) => string | null): Promise<void> {
    const cascade = cascadeCtx(ctx);
    const rows = await exceptionsOf(tx, master.id, { includeDeleted: true });
    const byId = new Map(rows.map((row) => [row.external.id, row]));
    const byExpected = new Map<string, Event>();
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      const expected = expectedId(row);
      if (expected !== null && !byId.has(expected) && !byExpected.has(expected)) byExpected.set(expected, row);
    }
    const handled = new Set<string>();
    for (const item of items) {
      if (item.providerMasterId !== master.external.id || item.originalStart === null) continue;
      const row = byId.get(item.external.id) ?? byExpected.get(item.external.id);
      if (row) {
        if (handled.has(row.id)) continue;
        handled.add(row.id);
        const deletedAt = item.deleted ? (row.deletedAt ?? now) : null;
        const next = fromReadback(item, { ...baseOf(row), calendarId: master.calendarId, accountId: master.accountId, originalStart: item.originalStart, deletedAt });
        if (Object.keys(diff(row, next)).length === 0) continue;
        must(await applyIn(tx, clock, "event", op, cascade, async (_t, _c, at) => okMutation("updated", row, bump(next, at))), `event ${row.id}`);
      } else if (!item.deleted) {
        const created = fromReadback(item, {
          id: newId("event"),
          calendarId: master.calendarId,
          accountId: master.accountId,
          masterId: master.id,
          originalStart: item.originalStart,
          origin: originOf(ctx, now),
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        must(await applyIn(tx, clock, "event", op, cascade, async () => okMutation("created", null, created)), `event ${created.id}`);
      }
    }
    for (const row of rows) {
      if (row.deletedAt !== null || handled.has(row.id)) continue;
      meta.warnings.push(`The provider no longer lists the changed occurrence of ${master.id} at ${whenKey(row.originalStart!)}; its row ${row.id} is in the trash`);
      must(await applyIn(tx, clock, "event", op, cascade, async (_t, _c, at) => okMutation("updated", row, bump({ ...row, deletedAt: at }, at))), `event ${row.id}`);
    }
  }

  /** The provider's exception rows for `master` after a change to it, or a `partial` rejection: the change stands at the provider, the readback did not. */
  async function readExceptions(meta: Meta, context: Context, row: Event, master: Event, what: string): Promise<Called<ProviderEvent[]>> {
    const { adapter, account, calendar } = context;
    const read = await call(meta, () => adapter.instances(account.id, calendar.external.id, master.external.id));
    if (read.ok) return read;
    meta.partial = true;
    return { ok: false, issues: [...read.issues, `partial: ${what}, but its occurrences could not be read back; run life sync`] };
  }

  /** Re-point the master's exception rows at a new calendar and provider series, from what the provider handed back for each. */
  async function relinkExceptions(tx: Tx, ctx: Ctx, op: string, calendar: Calendar, applied: { row: Event; readback: ProviderEvent }[]): Promise<void> {
    const cascade = cascadeCtx(ctx);
    for (const { row, readback } of applied) {
      const next = fromReadback(readback, { ...baseOf(row), calendarId: calendar.id, accountId: calendar.accountId, deletedAt: null });
      must(await applyIn(tx, clock, "event", op, cascade, async (_t, _c, at) => okMutation("updated", row, bump(next, at))), `event ${row.id}`);
    }
  }

  /**
   * Create a series again at the provider under the same Life-OS id, then
   * re-apply its exception rows onto the new series one instance at a time.
   * `partial` marks a failure after the series itself was created.
   */
  async function recreate(
    meta: Meta,
    context: Context,
    master: Event,
    exceptions: Event[],
  ): Promise<{ ok: true; master: ProviderEvent; exceptions: { row: Event; readback: ProviderEvent }[] } | { ok: false; issues: string[]; partial: boolean }> {
    const { adapter, account, calendar } = context;
    const created = await call(meta, () => adapter.create(account.id, calendar.external.id, writeOf(master), master.id));
    if (!created.ok) return { ok: false, issues: created.issues, partial: false };
    const applied: { row: Event; readback: ProviderEvent }[] = [];
    for (const row of exceptions) {
      const providerId = adapter.instanceId(created.value.external.id, row.originalStart!);
      const readback = await call(meta, () => adapter.update(account.id, calendar.external.id, providerId, instancePatch(row), ""));
      if (!readback.ok) {
        const key = whenKey(row.originalStart!);
        return { ok: false, issues: [...readback.issues, `partial: the series was recreated at the provider as ${created.value.external.id}, but its occurrence at ${key} was not re-applied; run life sync`], partial: true };
      }
      applied.push({ row, readback: readback.value });
    }
    return { ok: true, master: created.value, exceptions: applied };
  }

  // ---------------------------------------------------------------- scoped writes

  /**
   * Patch one row at the provider (a single event, a master, or an exception
   * row) and store the readback. A master whose time or rule changed has its
   * exception rows read back too: the provider decides what happens to them
   * (Google re-keys them from the new start, drops them with the rule), and
   * the rows hold its answer.
   */
  async function patchRow(tx: Tx, ctx: Ctx, now: string, meta: Meta, context: Context, row: Event, input: EventUpdate, op: string): Promise<Mutation<Event>> {
    if (input.repeat !== undefined && row.masterId !== null) return fail(["repeat: an occurrence cannot carry a rule; change the series with scope all"], { id: row.id, record: row });
    const resolved = resolveTimes(row, input);
    if (!resolved.ok) return fail(resolved.issues, { id: row.id, record: row });
    const patch = buildPatch(row, input, resolved.times);
    if (!changes(row, patch)) return okMutation("unchanged", row, row);
    const { adapter, account, calendar } = context;
    const readback = await call(meta, () => adapter.update(account.id, calendar.external.id, row.external.id, patch, row.external.etag));
    if (!readback.ok) return fail(readback.issues, { id: row.id, record: row });
    const after = bump(fromReadback(readback.value, baseOf(row)), now);
    if (row.repeat && row.masterId === null && (resolved.times !== null || input.repeat !== undefined)) {
      const read = await readExceptions(meta, context, row, after, `the series ${row.id} was changed at the provider`);
      if (!read.ok) return fail(read.issues, { id: row.id, record: row });
      const span = sameWhenKind(row.start, after.start) ? spanOf(row.start, after.start) : null;
      const timezone = isTimedWhen(after.start) ? after.start.timezone : undefined;
      await reconcileExceptions(tx, ctx, op, now, meta, after, read.value, (exception) =>
        span === null ? null : adapter.instanceId(after.external.id, shifted(exception.originalStart!, span, timezone)),
      );
    }
    return okMutation("updated", row, after);
  }

  /** Patch one occurrence: the exception row when one exists, else the provider instance, which yields a new exception row. */
  async function patchInstance(tx: Tx, ctx: Ctx, now: string, meta: Meta, target: Target, occurrence: Occurrence, exception: Event | null, input: EventUpdate, op: string): Promise<Mutation<Event>> {
    if (input.repeat !== undefined) return fail(["repeat: change the rule with scope all"], { id: target.master.id, record: target.master });
    if (exception) return patchRow(tx, ctx, now, meta, target, exception, input, op);
    const { master, adapter, account, calendar } = target;
    const resolved = resolveTimes(occurrence, input);
    if (!resolved.ok) return fail(resolved.issues, { id: master.id, record: master });
    const patch = buildPatch({ repeat: null }, input, resolved.times);
    if (!changes(occurrence, patch)) return okMutation("unchanged", master, master);
    const providerId = adapter.instanceId(master.external.id, occurrence.originalStart);
    const readback = await call(meta, () => adapter.update(account.id, calendar.external.id, providerId, patch, ""));
    if (!readback.ok) return fail(readback.issues, { id: master.id, record: master });
    const created = fromReadback(readback.value, {
      id: newId("event"),
      calendarId: master.calendarId,
      accountId: master.accountId,
      masterId: master.id,
      originalStart: occurrence.originalStart,
      origin: originOf(ctx, now),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return okMutation("created", null, created);
  }

  /** Patch the whole series: a time given against an occurrence shifts the master, and so every occurrence, by the same delta. */
  async function patchSeries(tx: Tx, ctx: Ctx, now: string, meta: Meta, target: Target, occurrence: Occurrence | null, input: EventUpdate, op: string): Promise<Mutation<Event>> {
    const { master } = target;
    if (!occurrence) return patchRow(tx, ctx, now, meta, target, master, input, op);
    const resolved = resolveTimes(occurrence, input);
    if (!resolved.ok) return fail(resolved.issues, { id: master.id, record: master });
    if (!resolved.times) return patchRow(tx, ctx, now, meta, target, master, input, op);
    const { start, end } = resolved.times;
    if (!sameWhenKind(start, master.start)) {
      return fail(["start: to change the series between timed and all-day, address the series itself (its id) with scope all"], { id: master.id, record: master });
    }
    const timezone = isTimedWhen(start) ? start.timezone : undefined;
    const masterStart = shifted(master.start, spanOf(occurrence.start, start), timezone);
    const masterEnd = shifted(masterStart, spanOf(start, end), timezone);
    const { duration: _duration, ...rest } = input;
    return patchRow(tx, ctx, now, meta, target, master, { ...rest, start: masterStart, end: masterEnd }, op);
  }

  /** How many slots the rule lays out before `split`, exdates and exceptions counted: what COUNT has already spent. */
  function slotsBefore(master: Event, split: When): number {
    const anchor = keyInstant(whenKey(master.start), tz());
    const end = keyInstant(whenKey(split), tz());
    if (anchor === null || end === null) return 0;
    const bare: Event = { ...master, repeat: { rrule: master.repeat!.rrule, exdates: [] } };
    const splitKey = normalizeKey(whenKey(split));
    return expandEvent(bare, [], { from: toInstant(new Date(anchor - DAY_MS)), to: toInstant(new Date(end)), timezone: tz() }).filter(
      (occurrence) => normalizeKey(whenKey(occurrence.originalStart)) < splitKey,
    ).length;
  }

  /**
   * This and following: truncate the master's rule just before the occurrence,
   * then create a new master from it with the rest of the rule and the change
   * applied. Two provider calls; a failure on the second is `partial`.
   */
  async function splitSeries(tx: Tx, ctx: Ctx, now: string, meta: Meta, target: Target, occurrence: Occurrence, input: EventUpdate, op: string): Promise<Mutation<Event>> {
    const { master, adapter, account, calendar } = target;
    const split = occurrence.originalStart;
    const splitKey = normalizeKey(whenKey(split));
    const resolved = resolveTimes(occurrence, input);
    if (!resolved.ok) return fail(resolved.issues, { id: master.id, record: master });
    const times = resolved.times ?? { start: occurrence.start, end: occurrence.end };
    const tail = input.repeat === undefined ? tailRule(master.repeat!.rrule, slotsBefore(master, split)) : { ok: true as const, rrule: input.repeat };
    if (!tail.ok) return fail(tail.issues, { id: master.id, record: master });
    const head: EventPatch = { repeat: { rrule: headRule(master.repeat!.rrule, split), exdates: master.repeat!.exdates.filter((key) => normalizeKey(key) < splitKey) } };
    const write: EventWrite = {
      title: input.title ?? master.title,
      notes: input.notes === undefined ? master.notes : input.notes,
      location: input.location === undefined ? master.location : input.location,
      start: times.start,
      end: times.end,
      repeat: tail.rrule === null ? null : { rrule: tail.rrule, exdates: resolved.times ? [] : master.repeat!.exdates.filter((key) => normalizeKey(key) >= splitKey) },
      busy: input.busy ?? master.busy,
      status: input.status ?? master.status,
    };

    const truncated = await call(meta, () => adapter.update(account.id, calendar.external.id, master.external.id, head, master.external.etag));
    if (!truncated.ok) return fail(truncated.issues, { id: master.id, record: master });
    const id = newId("event");
    const created = await call(meta, () => adapter.create(account.id, calendar.external.id, write, id));
    if (!created.ok) {
      meta.partial = true;
      return fail([...created.issues, `partial: the original series ${master.id} was already truncated at the provider to end before ${splitKey}; run life sync, then retry from ${occurrence.occurrenceId}`], { id: master.id, record: master });
    }

    const cascade = cascadeCtx(ctx);
    must(
      await applyIn(tx, clock, "event", op, cascade, async (_t, _c, at) => okMutation("updated", master, bump(fromReadback(truncated.value, baseOf(master)), at))),
      `event ${master.id}`,
    );
    await dropExceptions(tx, ctx, op, master.id, splitKey);
    meta.warnings.push(`Truncated the original series ${master.id} to end before ${splitKey}; ${id} continues from there`);
    const record = fromReadback(created.value, {
      id,
      calendarId: master.calendarId,
      accountId: master.accountId,
      masterId: null,
      originalStart: null,
      origin: originOf(ctx, now),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return okMutation("created", null, record);
  }

  /** An update under a scope: the four plans above. */
  async function applyScoped(tx: Tx, ctx: Ctx, now: string, meta: Meta, target: Target, scope: Scope | undefined, input: EventUpdate, op: string): Promise<Mutation<Event>> {
    const planned = plan(target, scope, SCOPES);
    if (!planned.ok) return planned.mutation;
    const p = planned.plan;
    switch (p.kind) {
      case "single":
        return patchRow(tx, ctx, now, meta, target, p.row, input, op);
      case "this":
        return patchInstance(tx, ctx, now, meta, target, p.occurrence, p.exception, input, op);
      case "all":
        return patchSeries(tx, ctx, now, meta, target, p.occurrence, input, op);
      case "following":
        return splitSeries(tx, ctx, now, meta, target, p.occurrence, input, op);
    }
  }

  // ---------------------------------------------------------------- add and duplicate

  /** Create at the provider and store the readback; a row already under `id` (a retry meeting its own row) is `unchanged`. */
  async function createEvent(tx: Tx, ctx: Ctx, now: string, meta: Meta, context: Context, id: string, write: EventWrite): Promise<Mutation<Event>> {
    const existing = await tx.get("event", id);
    if (existing) return okMutation("unchanged", existing, existing);
    const { adapter, account, calendar } = context;
    const readback = await call(meta, () => adapter.create(account.id, calendar.external.id, write, id));
    if (!readback.ok) return fail(readback.issues);
    const record = fromReadback(readback.value, {
      id,
      calendarId: calendar.id,
      accountId: calendar.accountId,
      masterId: null,
      originalStart: null,
      origin: originOf(ctx, now),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return okMutation("created", null, record);
  }

  async function addEvent(tx: Tx, input: EventAdd, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Event>> {
    const found = input.calendar === undefined ? await defaultCalendar(tx) : await findCalendar(tx, input.calendar);
    if (!found.ok) return failed(found);
    const context = await contextOf(tx, found.record, { writable: true });
    if (!context.ok) return failed(context);
    const end = input.end ?? endAfter(input.start, input.duration ?? (isTimedWhen(input.start) ? DEFAULT_MINUTES : DEFAULT_DAYS));
    const write: EventWrite = {
      title: input.title,
      notes: input.notes ?? null,
      location: input.location ?? null,
      start: input.start,
      end,
      repeat: input.repeat === undefined ? null : { rrule: input.repeat, exdates: [] },
      busy: input.busy ?? isTimedWhen(input.start),
      status: "confirmed",
    };
    return createEvent(tx, ctx, now, meta, context.record, ctx.key === undefined ? newId("event") : keyedEventId(ctx.key), write);
  }

  async function duplicateEvent(tx: Tx, ref: string, ctx: Ctx, now: string, meta: Meta, opts: EventDuplicateOptions): Promise<Mutation<Event>> {
    const found = await resolveTarget(tx, ref, { writable: false });
    if (!found.ok) return failed(found);
    const target = found.record;
    const mismatch = checkVersion(target.row, ctx);
    if (mismatch) return mismatch;
    const calendar = opts.calendar === undefined ? { ok: true as const, record: target.calendar } : await findCalendar(tx, opts.calendar);
    if (!calendar.ok) return failed(calendar);
    const context = await contextOf(tx, calendar.record, { writable: true });
    if (!context.ok) return failed(context);
    // An occurrence copies as a single event at its own time; a series copies with its rule.
    const source = target.occurrence ? { ...target.occurrence, repeat: null } : target.master;
    return createEvent(tx, ctx, now, meta, context.record, ctx.key === undefined ? newId("event") : keyedEventId(ctx.key), writeOf(source));
  }

  // ---------------------------------------------------------------- the scoped operations

  async function updateEvent(tx: Tx, ref: string, input: EventUpdate, ctx: Ctx, now: string, meta: Meta, opts: ScopeOptions, op = "event.update"): Promise<Mutation<Event>> {
    const found = await resolveTarget(tx, ref, { writable: true });
    if (!found.ok) return failed(found);
    const mismatch = checkVersion(found.record.row, ctx);
    if (mismatch) return mismatch;
    return applyScoped(tx, ctx, now, meta, found.record, opts.scope, input, op);
  }

  async function cancelEvent(tx: Tx, ref: string, ctx: Ctx, now: string, meta: Meta, opts: ScopeOptions): Promise<Mutation<Event>> {
    if (ctx.reason === undefined) return fail(["reason: cancel needs a reason"]);
    const found = await resolveTarget(tx, ref, { writable: true });
    if (!found.ok) return failed(found);
    const target = found.record;
    const mismatch = checkVersion(target.row, ctx);
    if (mismatch) return mismatch;
    const subject = target.occurrence ?? target.master;
    if (!subject.organizer?.self) {
      return fail([`organizer: only the organizer can cancel "${subject.title}"; decline it with event respond declined, or delete it`], { id: target.row.id, record: target.row });
    }
    return applyScoped(tx, ctx, now, meta, target, opts.scope, { status: "cancelled" }, "event.cancel");
  }

  async function respondEvent(tx: Tx, ref: string, response: EventResponse, ctx: Ctx, now: string, meta: Meta, opts: ScopeOptions): Promise<Mutation<Event>> {
    const found = await resolveTarget(tx, ref, { writable: false });
    if (!found.ok) return failed(found);
    const target = found.record;
    const mismatch = checkVersion(target.row, ctx);
    if (mismatch) return mismatch;
    const subject = target.occurrence ?? target.master;
    if (subject.myResponse === null) return fail([`attendees: you are not an attendee of "${subject.title}"; there is nothing to respond to`], { id: target.row.id, record: target.row });
    const planned = plan(target, opts.scope, ["this", "all"]);
    if (!planned.ok) return planned.mutation;
    const { master, adapter, account, calendar } = target;
    const p = planned.plan;
    if (p.kind === "single" || p.kind === "all") {
      const row = p.kind === "single" ? p.row : master;
      if (row.myResponse === response) return okMutation("unchanged", row, row);
      const readback = await call(meta, () => adapter.respond(account.id, calendar.external.id, row.external.id, response));
      if (!readback.ok) return fail(readback.issues, { id: row.id, record: row });
      return okMutation("updated", row, bump(fromReadback(readback.value, baseOf(row)), now));
    }
    if (p.kind !== "this") return fail(['scope: respond takes scope "this" or "all"'], { id: master.id, record: master });
    if (p.occurrence.myResponse === response) return okMutation("unchanged", master, master);
    const providerId = p.exception ? p.exception.external.id : adapter.instanceId(master.external.id, p.occurrence.originalStart);
    const readback = await call(meta, () => adapter.respond(account.id, calendar.external.id, providerId, response));
    if (!readback.ok) return fail(readback.issues, { id: master.id, record: master });
    if (p.exception) return okMutation("updated", p.exception, bump(fromReadback(readback.value, baseOf(p.exception)), now));
    const created = fromReadback(readback.value, {
      id: newId("event"),
      calendarId: master.calendarId,
      accountId: master.accountId,
      masterId: master.id,
      originalStart: p.occurrence.originalStart,
      origin: originOf(ctx, now),
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    return okMutation("created", null, created);
  }

  async function deleteEvent(tx: Tx, ref: string, ctx: Ctx, now: string, meta: Meta, opts: ScopeOptions): Promise<Mutation<Event>> {
    const bare = parseOccurrenceRef(ref.trim())?.eventId ?? ref.trim();
    const already = isEventId(bare) ? await tx.get("event", bare) : null;
    if (already?.deletedAt) return okMutation("unchanged", already, already);
    const found = await resolveTarget(tx, ref, { writable: true });
    if (!found.ok) return failed(found);
    const target = found.record;
    const mismatch = checkVersion(target.row, ctx);
    if (mismatch) return mismatch;
    const planned = plan(target, opts.scope, SCOPES);
    if (!planned.ok) return planned.mutation;
    const { master, adapter, account, calendar } = target;
    const op = "event.delete";
    const p = planned.plan;

    if (p.kind === "single" || p.kind === "all") {
      const row = p.kind === "single" ? p.row : master;
      const gone = await callDelete(meta, () => adapter.delete(account.id, calendar.external.id, row.external.id));
      if (!gone.ok) return fail(gone.issues, { id: row.id, record: row });
      if (row.masterId === null) await dropExceptions(tx, ctx, op, row.id, null);
      return okMutation("updated", row, bump({ ...row, deletedAt: now }, now));
    }

    if (p.kind === "following") {
      const splitKey = normalizeKey(whenKey(p.occurrence.originalStart));
      const head: EventPatch = { repeat: { rrule: headRule(master.repeat!.rrule, p.occurrence.originalStart), exdates: master.repeat!.exdates.filter((key) => normalizeKey(key) < splitKey) } };
      const readback = await call(meta, () => adapter.update(account.id, calendar.external.id, master.external.id, head, master.external.etag));
      if (!readback.ok) return fail(readback.issues, { id: master.id, record: master });
      await dropExceptions(tx, ctx, op, master.id, splitKey);
      return okMutation("updated", master, bump(fromReadback(readback.value, baseOf(master)), now));
    }

    // One occurrence: the provider cancels the instance; our copy is an exception row with status cancelled.
    if (p.exception?.status === "cancelled") return okMutation("unchanged", p.exception, p.exception);
    const providerId = p.exception ? p.exception.external.id : adapter.instanceId(master.external.id, p.occurrence.originalStart);
    const gone = await callDelete(meta, () => adapter.delete(account.id, calendar.external.id, providerId));
    if (!gone.ok) return fail(gone.issues, { id: master.id, record: master });
    if (p.exception) return okMutation("updated", p.exception, bump({ ...p.exception, status: "cancelled" }, now));
    const { occurrenceId: _ref, master: _isMaster, ...fields } = p.occurrence;
    const created: Event = {
      ...fields,
      id: newId("event"),
      masterId: master.id,
      originalStart: p.occurrence.originalStart,
      repeat: null,
      status: "cancelled",
      origin: originOf(ctx, now),
      external: { ...master.external, id: providerId, etag: PENDING_ETAG, updatedAt: now },
      version: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    return okMutation("created", null, created);
  }

  async function restoreEvent(tx: Tx, id: string, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Event>> {
    const row = isEventId(id) ? await tx.get("event", id) : null;
    if (!row) return fail([`event: no event "${id}"`]);
    const mismatch = checkVersion(row, ctx);
    if (mismatch) return mismatch;
    if (row.masterId !== null) return fail([`event: "${id}" is one occurrence; restore its series ${row.masterId}`], { id: row.id, record: row });
    if (!row.deletedAt) return okMutation("unchanged", row, row);
    const calendar = await tx.get("calendar", row.calendarId);
    if (!calendar) return fail([`calendar: no calendar "${row.calendarId}" for event "${id}"`], { id: row.id, record: row });
    const context = await contextOf(tx, calendar, { writable: true });
    if (!context.ok) return failed({ ...context, id: row.id });
    const exceptions = row.repeat ? (await exceptionsOf(tx, row.id, { includeDeleted: true })).filter((e) => e.deletedAt !== null) : [];
    const result = await recreate(meta, context.record, row, exceptions);
    if (!result.ok) {
      meta.partial = result.partial;
      return fail(result.issues, { id: row.id, record: row });
    }
    await relinkExceptions(tx, ctx, "event.restore", calendar, result.exceptions);
    return okMutation("updated", row, bump(fromReadback(result.master, { ...baseOf(row), deletedAt: null }), now));
  }

  async function moveEvent(tx: Tx, ref: string, calendarRef: string, ctx: Ctx, now: string, meta: Meta): Promise<Mutation<Event>> {
    const found = await resolveTarget(tx, ref, { writable: true });
    if (!found.ok) return failed(found);
    const target = found.record;
    const { row, master, adapter, account, calendar } = target;
    const mismatch = checkVersion(row, ctx);
    if (mismatch) return mismatch;
    if (target.occurrence || row.masterId !== null) return fail([`event: move takes a series or a single event, not one occurrence; move ${master.id}`], { id: row.id, record: row });
    const destination = await findCalendar(tx, calendarRef);
    if (!destination.ok) return failed(destination);
    if (destination.record.id === calendar.id) return okMutation("unchanged", row, row);
    if (destination.record.accountId !== account.id) {
      return fail(
        [`calendar: "${destination.record.name}" belongs to another account; the provider cannot move an event between accounts: run event duplicate ${row.id} --calendar ${calendarRef}, then event delete ${row.id}`],
        { id: row.id, record: row },
      );
    }
    const context = await contextOf(tx, destination.record, { writable: true });
    if (!context.ok) return failed({ ...context, id: row.id });
    const to = context.record.calendar;
    const op = "event.move";

    // A provider move: the id, the guests, the conferencing, and the exception rows all stay with the event.
    const readback = await call(meta, () => adapter.move(account.id, calendar.external.id, to.external.id, row.external.id));
    if (!readback.ok) return fail(readback.issues, { id: row.id, record: row });
    const after = bump(fromReadback(readback.value, { ...baseOf(row), calendarId: to.id, accountId: to.accountId }), now);
    if (row.repeat) {
      const read = await readExceptions(meta, context.record, row, after, `${row.id} was moved to "${to.name}" at the provider`);
      if (!read.ok) return fail(read.issues, { id: row.id, record: row });
      await reconcileExceptions(tx, ctx, op, now, meta, after, read.value, (exception) => exception.external.id);
    }
    return okMutation("updated", row, after);
  }

  // ---------------------------------------------------------------- reads

  async function getEvent(ref: string): Promise<Event | Occurrence | null> {
    const parsed = parseOccurrenceRef(ref.trim());
    if (!parsed) return isEventId(ref.trim()) ? store.read((tx) => tx.get("event", ref.trim())) : null;
    if (!isEventId(parsed.eventId)) return null;
    return store.read(async (tx) => {
      const row = await tx.get("event", parsed.eventId);
      if (!row) return null;
      const key = normalizeKey(parsed.originalStart);
      let master = row;
      if (row.masterId !== null) {
        const own = await tx.get("event", row.masterId);
        if (own && !own.deletedAt) master = own;
      }
      return (await occurrenceOf(tx, master, key))?.occurrence ?? null;
    });
  }

  /** An instant, or a date resolved in the display zone: the day's start for `from`, the day's end for `to`. */
  function windowEdge(value: string, edge: "from" | "to"): string | null {
    if (isValidDate(value)) return edge === "from" ? dayWindow(value, tz()).start : dayWindow(value, tz()).end;
    if (isInstant(value)) return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : toInstant(new Date(parsed));
  }

  async function listEvents(input: EventListOptions): Promise<Occurrence[]> {
    const parsed = listOptionsSchema.safeParse(input);
    if (!parsed.success) throw new Error(issuesOf(parsed.error).join("; "));
    const opts = parsed.data;
    const from = windowEdge(opts.from, "from");
    const to = windowEdge(opts.to, "to");
    if (!from) throw new Error(`from: not a date or instant: "${opts.from}"`);
    if (!to) throw new Error(`to: not a date or instant: "${opts.to}"`);
    if (Date.parse(to) <= Date.parse(from)) throw new Error(`to: must be after from (${from} to ${to})`);
    return store.read(async (tx) => {
      let calendars: Calendar[];
      if (opts.calendars) {
        calendars = [];
        for (const ref of opts.calendars) {
          const found = await findCalendar(tx, ref, "calendars");
          if (!found.ok) throw new Error(found.issues.join("; "));
          if (!calendars.some((c) => c.id === found.record.id)) calendars.push(found.record);
        }
      } else {
        calendars = (await tx.all("calendar")).filter((calendar) => opts.includeHidden || !calendar.hidden);
      }
      const ids = calendars.map((calendar) => calendar.id);
      const rows = opts.includeDeleted
        ? (await tx.all("event", { includeDeleted: true })).filter((event) => ids.includes(event.calendarId))
        : await tx.eventsInRange(ids, from, to);
      return expandEvents(rows, { from, to, timezone: tz() });
    });
  }

  // ---------------------------------------------------------------- the ops object

  const invalid = (issues: string[]): Promise<EventReceipt> => Promise.resolve(rejected<Event>(issues));
  const scopeOf = (opts: unknown): { ok: true; opts: ScopeOptions } | { ok: false; issues: string[] } => {
    const parsed = scopeOptionsSchema.safeParse(opts ?? {});
    return parsed.success ? { ok: true, opts: parsed.data } : { ok: false, issues: issuesOf(parsed.error) };
  };

  return {
    async add(input, ctx) {
      const parsed = eventAddSchema.safeParse(input);
      if (!parsed.success) return invalid(issuesOf(parsed.error));
      return write("event.add", ctx, (tx, c, now, meta) => addEvent(tx, parsed.data, c, now, meta));
    },
    get: getEvent,
    list: listEvents,
    update(ref, input, ctx, opts) {
      const parsed = eventUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(issuesOf(parsed.error));
      const scope = scopeOf(opts);
      if (!scope.ok) return invalid(scope.issues);
      return write("event.update", ctx, (tx, c, now, meta) => updateEvent(tx, ref, parsed.data, c, now, meta, scope.opts));
    },
    reschedule(ref, input, ctx, opts) {
      const parsed = rescheduleSchema.safeParse(input);
      if (!parsed.success) return invalid(issuesOf(parsed.error));
      const scope = scopeOf(opts);
      if (!scope.ok) return invalid(scope.issues);
      const change: EventUpdate = { start: parsed.data.start, ...(parsed.data.end !== undefined ? { end: parsed.data.end } : {}) };
      return write("event.reschedule", ctx, (tx, c, now, meta) => updateEvent(tx, ref, change, c, now, meta, scope.opts, "event.reschedule"));
    },
    move(ref, calendarRef, ctx) {
      const parsed = calendarRefSchema.safeParse(calendarRef);
      if (!parsed.success) return invalid(issuesOf(parsed.error).map((issue) => issue.replace(/^input:/, "calendar:")));
      return write("event.move", ctx, (tx, c, now, meta) => moveEvent(tx, ref, parsed.data, c, now, meta));
    },
    respond(ref, response, ctx, opts) {
      const parsed = responseSchema.safeParse(response);
      if (!parsed.success) return invalid(issuesOf(parsed.error).map((issue) => issue.replace(/^input:/, "response:")));
      const scope = scopeOf(opts);
      if (!scope.ok) return invalid(scope.issues);
      return write("event.respond", ctx, (tx, c, now, meta) => respondEvent(tx, ref, parsed.data, c, now, meta, scope.opts));
    },
    cancel(ref, ctx, opts) {
      const scope = scopeOf(opts);
      if (!scope.ok) return invalid(scope.issues);
      return write("event.cancel", ctx, (tx, c, now, meta) => cancelEvent(tx, ref, c, now, meta, scope.opts));
    },
    delete(ref, ctx, opts) {
      const scope = scopeOf(opts);
      if (!scope.ok) return invalid(scope.issues);
      return write("event.delete", ctx, (tx, c, now, meta) => deleteEvent(tx, ref, c, now, meta, scope.opts));
    },
    restore: (id, ctx) => write("event.restore", ctx, (tx, c, now, meta) => restoreEvent(tx, id, c, now, meta)),
    duplicate(ref, ctx, opts) {
      const parsed = duplicateOptionsSchema.safeParse(opts ?? {});
      if (!parsed.success) return invalid(issuesOf(parsed.error));
      return write("event.duplicate", ctx, (tx, c, now, meta) => duplicateEvent(tx, ref, c, now, meta, parsed.data));
    },
    history: (id) => store.read((tx) => tx.history("event", id)),
  };
}
