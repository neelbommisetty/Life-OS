// Dates, instants, and timezones without a library.
// A date is "YYYY-MM-DD". An instant is "YYYY-MM-DDTHH:MM:SSZ" (UTC).
// A wall-clock time is "YYYY-MM-DDTHH:MM[:SS]" and only means something with a timezone.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isInstant(value: string): boolean {
  return INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

export type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function wallParts(instant: Date, tz: string): WallParts {
  const parts = partsFormatter(tz).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function offsetMinutes(instant: Date, tz: string): number {
  const p = wallParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Interpret a wall-clock time in a timezone and return the instant. */
export function zonedToInstant(wall: string, tz: string): Date | null {
  const match = WALL.exec(wall);
  if (!match || !isValidDate(match[1]!)) return null;
  const [year, month, day] = match[1]!.split("-").map(Number) as [number, number, number];
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = offsetMinutes(new Date(guess), tz);
  let instant = guess - first * 60000;
  const second_ = offsetMinutes(new Date(instant), tz);
  if (second_ !== first) instant = guess - second_ * 60000;
  return new Date(instant);
}

export function toInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Parse user input for a point in time. Accepts an instant with offset or Z,
 * or a wall-clock time interpreted in `tz`. Returns a UTC instant string.
 */
export function parseInstant(input: string, tz: string): string | null {
  const offset = OFFSET.exec(input);
  if (offset) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : toInstant(parsed);
  }
  const zoned = zonedToInstant(input, tz);
  return zoned ? toInstant(zoned) : null;
}

export function localDate(instant: string | Date, tz: string): string {
  const p = wallParts(typeof instant === "string" ? new Date(instant) : instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localTime(instant: string | Date, tz: string): string {
  const p = wallParts(typeof instant === "string" ? new Date(instant) : instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function localWall(instant: string | Date, tz: string): string {
  return `${localDate(instant, tz)}T${localTime(instant, tz)}`;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(date + "T00:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000,
  );
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return localDate(now, tz);
}

/** today, tomorrow, yesterday, +3d, -1d, +2w, or a plain date. */
export function relativeDate(input: string, today: string): string | null {
  const word = input.trim().toLowerCase();
  if (word === "today") return today;
  if (word === "tomorrow") return addDays(today, 1);
  if (word === "yesterday") return addDays(today, -1);
  const rel = /^([+-])(\d{1,3})([dw])$/.exec(word);
  if (rel) {
    const n = Number(rel[2]) * (rel[3] === "w" ? 7 : 1);
    return addDays(today, rel[1] === "-" ? -n : n);
  }
  return isValidDate(input) ? input : null;
}

/** The UTC window for a local calendar day: [start, end). */
export function dayWindow(date: string, tz: string): { start: string; end: string } {
  const start = zonedToInstant(`${date}T00:00`, tz)!;
  const end = zonedToInstant(`${addDays(date, 1)}T00:00`, tz)!;
  return { start: toInstant(start), end: toInstant(end) };
}

export function defaultTimezone(): string {
  const fromEnv = process.env.LIFE_TZ;
  if (fromEnv && isValidTimezone(fromEnv)) return fromEnv;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
