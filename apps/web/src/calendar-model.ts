import { DateTime, IANAZone } from "luxon";
import type {
  Calendar,
  EventAdd,
  EventUpdate,
  When,
  Task,
} from "../../../packages/tools/src/contract.ts";
import type { Occurrence } from "../../../packages/tools/src/calendar/expand.ts";
import type {
  Day,
  ScheduleEntry,
} from "../../../packages/tools/src/calendar/schedule.ts";
export type { Calendar, Occurrence, Day, ScheduleEntry };
/** Duration is elapsed minutes; date-only tasks remain all-day estimates. */
export function taskCalendarTime(task: Pick<Task, "due" | "duration">, zone: string) {
  if (!task.due) throw new Error("A calendar task needs a due date");
  if (!task.due.time) return { start: task.due.date, allDay: true };
  const start = DateTime.fromISO(`${task.due.date}T${task.due.time}`, {
    zone: task.due.timezone ?? zone,
  });
  return {
    start: start.toISO()!,
    ...(task.duration !== undefined
      ? { end: start.plus({ minutes: task.duration }).toISO()! }
      : {}),
    allDay: false,
  };
}
export type CalendarView =
  "timeGridDay" | "timeGridWeek" | "dayGridMonth" | "agenda";
export type EventDraft = {
  title: string;
  calendar: string;
  allDay: boolean;
  start: string;
  end: string;
  timezone: string;
  floating: boolean;
  notes: string;
  location: string;
  repeat: string;
  busy: boolean;
};
export const dateIn = (zone: string) =>
  DateTime.now().setZone(zone).toISODate()!;
export const shiftDate = (date: string, days: number) =>
  DateTime.fromISO(date).plus({ days }).toISODate()!;
export function monthDates(date: string): string[] {
  const first = DateTime.fromISO(date).startOf("month");
  const start = first.minus({ days: first.weekday % 7 });
  return Array.from({ length: 42 }, (_, i) =>
    start.plus({ days: i }).toISODate()!,
  );
}
export function wallTime(when: When, zone: string): string {
  if ("date" in when) return when.date;
  return DateTime.fromISO(when.at, {
    zone: when.timezone === null ? "UTC" : zone,
  }).toFormat("yyyy-MM-dd'T'HH:mm");
}
export function calendarTime(when: When, zone: string): string {
  if ("date" in when) return when.date;
  // Floating values carry wall-clock components in a UTC timestamp.
  return when.timezone === null ? wallTime(when, zone) : when.at;
}
export function timeLabel(when: When, zone: string) {
  if ("date" in when) return "All day";
  return DateTime.fromISO(when.at, {
    zone: when.timezone === null ? "UTC" : zone,
  }).toLocaleString(DateTime.TIME_SIMPLE);
}
export function draftFor(
  date: string,
  zone: string,
  calendar: string,
  occurrence?: Occurrence,
): EventDraft {
  if (!occurrence)
    return {
      title: "",
      calendar,
      allDay: true,
      start: date,
      end: date,
      timezone: zone,
      floating: false,
      notes: "",
      location: "",
      repeat: "",
      busy: true,
    };
  const allDay = "date" in occurrence.start;
  const eventZone =
    "at" in occurrence.start ? (occurrence.start.timezone ?? zone) : zone;
  return {
    title: occurrence.title,
    calendar: occurrence.calendarId,
    allDay,
    start: wallTime(occurrence.start, eventZone),
    end: allDay
      ? shiftDate(wallTime(occurrence.end, eventZone), -1)
      : wallTime(occurrence.end, eventZone),
    timezone: eventZone,
    floating: "at" in occurrence.start && occurrence.start.timezone === null,
    notes: occurrence.notes ?? "",
    location: occurrence.location ?? "",
    repeat: occurrence.repeat?.rrule ?? "",
    busy: occurrence.busy,
  };
}
export function draftFromSelection(
  start: string,
  end: string,
  allDay: boolean,
  zone: string,
  calendar: string,
): EventDraft {
  const draft = draftFor(start.slice(0, 10), zone, calendar);
  return {
    ...draft,
    allDay,
    start: start.slice(0, allDay ? 10 : 16),
    end: allDay ? shiftDate(end.slice(0, 10), -1) : end.slice(0, 16),
  };
}
function timedInput(input: string, zone: string, floating: boolean): When {
  if (!floating && !IANAZone.isValidZone(zone))
    throw new Error(
      "Enter a valid timezone, such as America/Los_Angeles or UTC.",
    );
  const parsed = DateTime.fromISO(input, { zone: floating ? "UTC" : zone });
  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== input)
    throw new Error(
      "This time does not exist in the selected timezone. Choose another time.",
    );
  if (!floating && parsed.getPossibleOffsets().length > 1)
    throw new Error(
      "This time occurs twice when daylight saving ends. Choose an unambiguous time or use UTC.",
    );
  return { at: parsed.toUTC().toISO()!, timezone: floating ? null : zone };
}
export function inputFromDraft(draft: EventDraft): EventAdd {
  if (!draft.title.trim()) throw new Error("Enter an event title.");
  if (!draft.calendar) throw new Error("Choose a writable calendar.");
  const start: When = draft.allDay
    ? { date: draft.start }
    : timedInput(draft.start, draft.timezone, draft.floating);
  const end: When = draft.allDay
    ? { date: shiftDate(draft.end, 1) }
    : timedInput(draft.end, draft.timezone, draft.floating);
  if (
    draft.allDay &&
    (!DateTime.fromISO(draft.start).isValid ||
      !DateTime.fromISO(draft.end).isValid)
  )
    throw new Error("Choose valid start and end dates.");
  if (
    ("date" in start && "date" in end && end.date <= start.date) ||
    ("at" in start && "at" in end && Date.parse(end.at) <= Date.parse(start.at))
  )
    throw new Error("The event must end after it starts.");
  return {
    title: draft.title.trim(),
    calendar: draft.calendar,
    start,
    end,
    notes: draft.notes || undefined,
    location: draft.location || undefined,
    repeat: draft.repeat || undefined,
    busy: draft.busy,
  };
}
/** Omit unchanged times and rules: editing notes must not truncate seconds or rewrite a series. */
export function updateFromDraft(
  draft: EventDraft,
  original: EventDraft,
): EventUpdate {
  if (!draft.title.trim()) throw new Error("Enter an event title.");
  const update: EventUpdate = {};
  for (const key of ["title", "busy"] as const)
    if (draft[key] !== original[key])
      Object.assign(update, {
        [key]: key === "title" ? draft.title.trim() : draft[key],
      });
  for (const key of ["notes", "location", "repeat"] as const)
    if (draft[key] !== original[key])
      Object.assign(update, { [key]: draft[key] || null });
  if (
    ["allDay", "start", "end", "timezone", "floating"].some(
      (key) =>
        draft[key as keyof EventDraft] !== original[key as keyof EventDraft],
    )
  ) {
    const input = inputFromDraft(draft);
    update.start = input.start;
    update.end = input.end;
  }
  return update;
}
export const entryId = (entry: ScheduleEntry) =>
  entry.kind === "event" ? entry.occurrence.occurrenceId : entry.task.id;
export const entryTitle = (entry: ScheduleEntry) =>
  entry.kind === "event" ? entry.occurrence.title : entry.task.title;
export function filterDays(
  days: Day[],
  calendars: Calendar[],
  visibility: Record<string, boolean>,
  showTasks: boolean,
  search: string,
): Day[] {
  const shown = new Set(
    calendars.filter((c) => visibility[c.id] ?? !c.hidden).map((c) => c.id),
  );
  const query = search.trim().toLowerCase();
  const keep = (entry: ScheduleEntry) =>
    (entry.kind === "event"
      ? shown.has(entry.occurrence.calendarId)
      : showTasks) &&
    (!query ||
      (entry.kind === "event"
        ? [
            entry.occurrence.title,
            entry.occurrence.location,
            entry.occurrence.notes,
          ]
        : [entry.task.title, entry.task.notes]
      )
        .join(" ")
        .toLowerCase()
        .includes(query));
  return days.map((day) => ({
    ...day,
    allDay: day.allDay.filter(keep),
    timed: day.timed.filter(keep),
  }));
}
export function safeLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
