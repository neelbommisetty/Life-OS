// Google Calendar API v3 JSON ↔ the adapter's provider shapes. Pure functions,
// no network, no clock: whatever the caller knows (the calendar's zone, when
// the page was fetched) comes in through `MapContext`.
//
// Reading: `fromGoogleEvent` turns an `events.list` / `events.get` item into a
// ProviderEvent, `fromGoogleCalendar` a `calendarList` entry into a
// ProviderCalendar. Writing: `toGoogleInsert` and `toGooglePatch` build the
// request bodies for `events.insert` and `events.patch` from the provider-
// neutral EventWrite and EventPatch.
//
// Google has no floating events, so a floating When (timezone null) is stored
// as its wall clock in the calendar's zone and stamped
// `extendedProperties.private.lifeFloating = "true"`; reading such an item
// restores the wall clock as a floating When. RDATE lines are not modelled
// (the contract carries a rule and exception dates only) and are reported in
// `recurrenceFromGoogle().ignored`.

import type { AttendeeResponse, EventPatch, EventRepeat, EventStatus, EventWrite, When } from "../../contract.ts";
import { isTimedWhen } from "../../contract.ts";
import { addDays, toInstant, wallParts, zonedToInstant } from "../../time.ts";
import type { ProviderCalendar, ProviderEvent } from "../adapter.ts";

// ------------------------------------------------------------------ Google shapes

/** A `start`, `end`, or `originalStartTime` object. */
export type GoogleWhen = { date?: string | null; dateTime?: string | null; timeZone?: string | null };

export type GoogleAttendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  optional?: boolean;
  resource?: boolean;
  organizer?: boolean;
  responseStatus?: string;
};

/** The fields of an events resource this module reads. Anything else is ignored. */
export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleWhen;
  end?: GoogleWhen;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleWhen;
  transparency?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: GoogleAttendee[];
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string; label?: string }[];
    conferenceSolution?: { name?: string; key?: { type?: string } };
  };
  hangoutLink?: string;
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  iCalUID?: string;
  updated?: string;
};

/** The fields of a calendarList entry this module reads. */
export type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  timeZone?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  hidden?: boolean;
  deleted?: boolean;
};

/** A `start`/`end` object as sent to Google; explicit nulls clear the other kind on a patch. */
export type GoogleWhenBody = { date?: string | null; dateTime?: string | null; timeZone?: string | null };

/** An `events.insert` or `events.patch` request body. */
export type GoogleEventBody = {
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleWhenBody;
  end?: GoogleWhenBody;
  recurrence?: string[];
  transparency?: "opaque" | "transparent";
  status?: EventStatus;
  extendedProperties?: { private: Record<string, string> };
};

export type MapContext = {
  /** The calendar's zone: the timezone of a `dateTime` that names none, and the zone floating events are written in. */
  calendarTimezone: string;
  /** When the item was fetched: `external.updatedAt` for a cancelled stub that carries no `updated`. */
  fetchedAt: string;
};

const FLOATING_KEY = "lifeFloating";
const LIFE_ID_KEY = "lifeId";
const UNTITLED = "(No title)";
const WRITABLE_ROLES = new Set(["owner", "writer"]);
const RESPONSES = new Set<string>(["needsAction", "accepted", "declined", "tentative"]);
const STATUSES = new Set<string>(["confirmed", "tentative", "cancelled"]);

// ------------------------------------------------------------------ moments

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall clock of `instant` in `tz`, as "YYYY-MM-DDTHH:MM:SS". */
function wallIn(instant: Date, tz: string): string {
  const p = wallParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** A floating When's wall clock is the UTC rendering of its `at`. */
function floatingWall(at: string): string {
  return wallIn(new Date(at), "UTC");
}

/**
 * A Google moment as a When. `date` is all-day; `dateTime` is an instant whose
 * zone is `timeZone` or, when Google names none, the calendar's. A floating
 * stamp turns the wall clock in that zone back into a floating When.
 */
export function whenFromGoogle(value: GoogleWhen | undefined, ctx: MapContext, floating = false): When | null {
  if (!value) return null;
  if (value.date) return { date: value.date };
  if (!value.dateTime) return null;
  const parsed = new Date(value.dateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  const timezone = value.timeZone || ctx.calendarTimezone;
  if (floating) return { at: `${wallIn(parsed, timezone)}Z`, timezone: null };
  return { at: toInstant(parsed), timezone };
}

/** A When as a Google moment. Timed moments go as the UTC instant plus the zone; floating ones as the wall clock in the calendar's zone. */
export function whenToGoogle(value: When, ctx: MapContext): GoogleWhenBody {
  if (!isTimedWhen(value)) return { date: value.date };
  if (value.timezone === null) return { dateTime: floatingWall(value.at), timeZone: ctx.calendarTimezone };
  return { dateTime: value.at, timeZone: value.timezone };
}

/** `whenToGoogle` for a patch: the other kind's fields are set to null so a change of kind does not leave them behind. */
function whenToGooglePatch(value: When, ctx: MapContext): GoogleWhenBody {
  const body = whenToGoogle(value, ctx);
  return isTimedWhen(value) ? { ...body, date: null } : { ...body, dateTime: null, timeZone: null };
}

/** An end for a stub that carries none (a cancelled occurrence, a deleted item): one hour or one day after `start`. */
function fallbackEnd(start: When): When {
  if (isTimedWhen(start)) return { at: toInstant(new Date(Date.parse(start.at) + 60 * 60 * 1000)), timezone: start.timezone };
  return { date: addDays(start.date, 1) };
}

// ------------------------------------------------------------------ recurrence

const EXDATE_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/**
 * One EXDATE value as an original-start key: a date for `YYYYMMDD`, an instant
 * for `YYYYMMDDTHHMMSS[Z]` in `tzid` (or `fallbackTz`). For a floating series
 * the key is the wall clock itself as a UTC-shaped instant, the way a floating
 * When carries it.
 */
function exdateKey(raw: string, tzid: string | null, fallbackTz: string, floating: boolean): string | null {
  const match = EXDATE_VALUE.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, utc] = match;
  const date = `${y}-${mo}-${d}`;
  if (h === undefined) return date;
  const wall = `${date}T${h}:${mi}:${s}`;
  if (utc) return floating ? `${wallIn(new Date(`${wall}Z`), tzid ?? fallbackTz)}Z` : `${wall}Z`;
  if (floating) return `${wall}Z`;
  const instant = zonedToInstant(wall, tzid ?? fallbackTz);
  return instant ? toInstant(instant) : null;
}

/**
 * Google's `recurrence` array as the contract's repeat. The RRULE line loses
 * its prefix; EXDATE values become original-start keys (dates for an all-day
 * series, instants otherwise, honouring TZID and Z); RDATE lines and anything
 * unparseable are returned in `ignored`, not modelled. No RRULE → `repeat: null`.
 */
export function recurrenceFromGoogle(
  lines: string[] | undefined,
  opts: { timezone: string; allDay: boolean; floating?: boolean },
): { repeat: EventRepeat | null; ignored: string[] } {
  let rrule: string | null = null;
  const exdates: string[] = [];
  const ignored: string[] = [];
  for (const line of lines ?? []) {
    const colon = line.indexOf(":");
    if (colon < 0) {
      ignored.push(line);
      continue;
    }
    const head = line.slice(0, colon);
    const body = line.slice(colon + 1);
    const [name, ...params] = head.split(";");
    const upper = (name ?? "").toUpperCase();
    if (upper === "RRULE") {
      if (rrule === null) rrule = body;
      else ignored.push(line);
      continue;
    }
    if (upper !== "EXDATE") {
      ignored.push(line);
      continue;
    }
    const tzid = params.map((p) => p.split("=")).find(([k]) => k?.toUpperCase() === "TZID")?.[1] ?? null;
    for (const raw of body.split(",")) {
      const key = exdateKey(raw.trim(), tzid, opts.timezone, opts.floating === true);
      if (key === null) ignored.push(line);
      else if (opts.allDay) exdates.push(key.slice(0, 10));
      else exdates.push(key);
    }
  }
  if (rrule === null) return { repeat: null, ignored };
  return { repeat: { rrule, exdates: [...new Set(exdates)].sort() }, ignored };
}

/** How a series' exdates are written: by the start when known, otherwise by the shape of the keys (a 10-character key is a date). */
export type SeriesShape = { allDay: boolean; floating: boolean };

export function seriesShape(start: When | undefined, repeat: EventRepeat): SeriesShape {
  if (start) return { allDay: !isTimedWhen(start), floating: isTimedWhen(start) && start.timezone === null };
  return { allDay: repeat.exdates[0]?.length === 10, floating: false };
}

/**
 * The contract's repeat as Google's `recurrence` array: the RRULE line and,
 * when there are exdates, one EXDATE line. Dates for an all-day series, UTC
 * instants for a zoned one, and the wall clock in the calendar's zone for a
 * floating one, matching how `whenToGoogle` writes its start.
 */
export function recurrenceToGoogle(repeat: EventRepeat, shape: SeriesShape, ctx: MapContext): string[] {
  const rule = repeat.rrule.replace(/^RRULE:/i, "");
  const lines = [`RRULE:${rule}`];
  if (repeat.exdates.length === 0) return lines;
  const compact = (key: string) => key.replace(/[-:]/g, "");
  if (shape.allDay) {
    lines.push(`EXDATE;VALUE=DATE:${repeat.exdates.map((key) => compact(key.slice(0, 10))).join(",")}`);
  } else if (shape.floating) {
    lines.push(`EXDATE;TZID=${ctx.calendarTimezone}:${repeat.exdates.map((key) => compact(floatingWall(key))).join(",")}`);
  } else {
    lines.push(`EXDATE:${repeat.exdates.map((key) => compact(toInstant(new Date(key)))).join(",")}`);
  }
  return lines;
}

// ------------------------------------------------------------------ events, reading

function response(value: string | undefined): AttendeeResponse {
  return value && RESPONSES.has(value) ? (value as AttendeeResponse) : "needsAction";
}

function textOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function conferencingFrom(item: GoogleEvent): ProviderEvent["conferencing"] {
  const data = item.conferenceData;
  const video = data?.entryPoints?.find((entry) => entry.entryPointType === "video" && entry.uri);
  if (video?.uri) {
    const keyType = data?.conferenceSolution?.key?.type;
    const kind = keyType === "hangoutsMeet" ? "meet" : (textOrNull(data?.conferenceSolution?.name) ?? "video");
    return { kind, url: video.uri };
  }
  if (item.hangoutLink) return { kind: "meet", url: item.hangoutLink };
  return null;
}

function remindersFrom(item: GoogleEvent): ProviderEvent["reminders"] {
  const reminders = item.reminders;
  if (!reminders || reminders.useDefault !== false) return null;
  return (reminders.overrides ?? [])
    .filter((o) => typeof o.minutes === "number" && Number.isInteger(o.minutes) && o.minutes >= 0)
    .map((o) => ({ method: o.method ?? "popup", minutes: o.minutes as number }));
}

/**
 * One events resource as a ProviderEvent. A cancelled item with a
 * `recurringEventId` is a cancelled occurrence (an exception row, `deleted:
 * false`); a cancelled item without one is gone (`deleted: true`). Google
 * sends cancelled items as stubs, so missing times fall back to the original
 * start (occurrences) or a one-day span at `fetchedAt` (deleted items); sync
 * applies neither, it only cancels or soft-deletes the row.
 */
export function fromGoogleEvent(item: GoogleEvent, ctx: MapContext): ProviderEvent {
  const priv = item.extendedProperties?.private ?? {};
  const floating = priv[FLOATING_KEY] === "true";
  const cancelled = item.status === "cancelled";
  const providerMasterId = item.recurringEventId ?? null;
  const originalStart = whenFromGoogle(item.originalStartTime, ctx, floating);
  const deleted = cancelled && providerMasterId === null;

  let start = whenFromGoogle(item.start, ctx, floating) ?? originalStart;
  if (!start) start = { date: ctx.fetchedAt.slice(0, 10) };
  let end = whenFromGoogle(item.end, ctx, floating);
  if (!end || isTimedWhen(end) !== isTimedWhen(start)) end = fallbackEnd(start);
  const allDay = !isTimedWhen(start);

  const { repeat } = recurrenceFromGoogle(item.recurrence, {
    timezone: (isTimedWhen(start) && start.timezone) || ctx.calendarTimezone,
    allDay,
    floating,
  });

  const attendees = (item.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => ({
      email: a.email as string,
      name: textOrNull(a.displayName),
      response: response(a.responseStatus),
      self: a.self === true,
      optional: a.optional === true,
    }));
  const mine = attendees.find((a) => a.self);

  const organizerEmail = textOrNull(item.organizer?.email);
  const busy = item.transparency ? item.transparency !== "transparent" : !allDay;
  const updated = item.updated ? new Date(item.updated) : null;

  return {
    title: textOrNull(item.summary) ?? UNTITLED,
    notes: textOrNull(item.description),
    location: textOrNull(item.location),
    start,
    end,
    repeat: providerMasterId ? null : repeat,
    originalStart: providerMasterId ? originalStart : null,
    status: cancelled ? "cancelled" : item.status && STATUSES.has(item.status) ? (item.status as EventStatus) : "confirmed",
    busy,
    organizer: organizerEmail ? { email: organizerEmail, name: textOrNull(item.organizer?.displayName), self: item.organizer?.self === true } : null,
    attendees,
    myResponse: mine ? mine.response : null,
    conferencing: conferencingFrom(item),
    reminders: remindersFrom(item),
    external: {
      provider: "google",
      id: item.id,
      etag: item.etag || `missing:${item.id}`,
      iCalUID: item.iCalUID || `${item.id}@google.com`,
      updatedAt: updated && !Number.isNaN(updated.getTime()) ? toInstant(updated) : ctx.fetchedAt,
    },
    providerMasterId,
    deleted,
    lifeId: textOrNull(priv[LIFE_ID_KEY]),
  };
}

// ------------------------------------------------------------------ calendars

/** One calendarList entry as a ProviderCalendar, or null for an entry Google marks deleted. */
export function fromGoogleCalendar(item: GoogleCalendarListEntry, opts: { fallbackTimezone: string }): ProviderCalendar | null {
  if (item.deleted) return null;
  return {
    id: item.id,
    name: textOrNull(item.summaryOverride) ?? textOrNull(item.summary) ?? item.id,
    color: textOrNull(item.backgroundColor),
    timezone: textOrNull(item.timeZone) ?? opts.fallbackTimezone,
    writable: WRITABLE_ROLES.has(item.accessRole ?? ""),
    primary: item.primary === true,
    hidden: item.hidden === true,
  };
}

// ------------------------------------------------------------------ events, writing

/** The floating stamp for a start: "true" when it has no zone, "false" otherwise (a patch must be able to clear it). */
function floatingStamp(start: When): string {
  return isTimedWhen(start) && start.timezone === null ? "true" : "false";
}

/** The `events.insert` body for a whole event; stamps `extendedProperties.private.lifeId` so the row keeps its Life-OS id. */
export function toGoogleInsert(write: EventWrite, lifeId: string, ctx: MapContext): GoogleEventBody {
  const priv: Record<string, string> = { [LIFE_ID_KEY]: lifeId };
  if (floatingStamp(write.start) === "true") priv[FLOATING_KEY] = "true";
  const body: GoogleEventBody = {
    summary: write.title,
    start: whenToGoogle(write.start, ctx),
    end: whenToGoogle(write.end, ctx),
    transparency: write.busy ? "opaque" : "transparent",
    status: write.status,
    extendedProperties: { private: priv },
  };
  if (write.notes !== null) body.description = write.notes;
  if (write.location !== null) body.location = write.location;
  if (write.repeat) body.recurrence = recurrenceToGoogle(write.repeat, seriesShape(write.start, write.repeat), ctx);
  return body;
}

/**
 * The `events.patch` body for a partial change: only the fields present.
 * `null` clears notes and location with an empty string and repeat with an
 * empty array, which is how Google's patch clears them. A start that changes
 * kind carries nulls for the other kind's fields, and a start change restamps
 * the floating flag either way.
 */
export function toGooglePatch(patch: EventPatch, ctx: MapContext): GoogleEventBody {
  const body: GoogleEventBody = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.notes !== undefined) body.description = patch.notes ?? "";
  if (patch.location !== undefined) body.location = patch.location ?? "";
  if (patch.start !== undefined) {
    body.start = whenToGooglePatch(patch.start, ctx);
    body.extendedProperties = { private: { [FLOATING_KEY]: floatingStamp(patch.start) } };
  }
  if (patch.end !== undefined) body.end = whenToGooglePatch(patch.end, ctx);
  if (patch.repeat !== undefined) {
    body.recurrence = patch.repeat ? recurrenceToGoogle(patch.repeat, seriesShape(patch.start, patch.repeat), ctx) : [];
  }
  if (patch.busy !== undefined) body.transparency = patch.busy ? "opaque" : "transparent";
  if (patch.status !== undefined) body.status = patch.status;
  return body;
}
