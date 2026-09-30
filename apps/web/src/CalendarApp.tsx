import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type {
  EventInput,
  DatesSetArg,
  EventContentArg,
} from "@fullcalendar/core";
import { DateTime } from "luxon";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  X,
  MapPin,
  ListTodo,
  Repeat2,
} from "lucide-react";
import { Shell } from "./Shell";
import { Button, IconButton } from "./ui";
import { api, timezone } from "./data";
import { EventEditor } from "./EventEditor";
import {
  calendarTime,
  taskCalendarTime,
  dateIn,
  draftFor,
  draftFromSelection,
  entryId,
  entryTitle,
  filterDays,
  monthDates,
  shiftDate,
  timeLabel,
  type Calendar,
  type CalendarView,
  type Day,
  type EventDraft,
  type Occurrence,
  type ScheduleEntry,
} from "./calendar-model";
import "./calendar.css";
const plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin];
const views: [CalendarView, string][] = [
  ["timeGridDay", "Day"],
  ["timeGridWeek", "Week"],
  ["dayGridMonth", "Month"],
  ["agenda", "Agenda"],
];
const zoneChoices = Array.from(
  new Set([
    timezone,
    "America/Los_Angeles",
    "America/New_York",
    "Europe/London",
    "Asia/Kolkata",
    "UTC",
  ]),
);
const formatDate = (date: string, format: string) =>
  DateTime.fromISO(date).toFormat(format);
function calendarColor(calendar: Calendar | undefined): CSSProperties {
  return {
    "--calendar-color": calendar?.color || "var(--accent)",
  } as CSSProperties;
}
export default function CalendarApp() {
  const [zone, setZone] = useState(timezone);
  const [selected, setSelected] = useState(() => dateIn(timezone));
  const [view, setView] = useState<CalendarView>(() =>
    window.innerWidth <= 680 ? "timeGridDay" : "timeGridWeek",
  );
  const [range, setRange] = useState(() => ({
    from: shiftDate(dateIn(timezone), -7),
    days: 21,
  }));
  const [heading, setHeading] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [showTasks, setShowTasks] = useState(true);
  const [search, setSearch] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [editor, setEditor] = useState<{
    draft: EventDraft;
    occurrence?: Occurrence;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [syncing, setSyncing] = useState(false);
  const activeView = useRef(view);
  const calendarRef = useRef<FullCalendar>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (window.innerWidth > 680 || view === "agenda") return;
    const frame = requestAnimationFrame(() => {
      const grid = gridRef.current;
      const day = grid?.querySelector<HTMLElement>(`[data-date="${selected}"]`);
      if (grid && day) {
        grid.scrollLeft +=
          day.getBoundingClientRect().left -
          grid.getBoundingClientRect().left -
          (grid.clientWidth - day.offsetWidth) / 2;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, selected, heading]);
  // Calendar metadata is read after schedule refresh, which can discover or remove calendars.
  const query = useQuery({
    queryKey: ["calendar-workspace", range, zone],
    queryFn: async () => {
      const client = (await import("@life-os/tools/client")).createClient({
        url: `${window.location.origin}/api`,
        token: "",
        timezone: zone,
        timeoutMs: 35_000,
      });
      const schedule = await client.views.week({
        ...range,
        includeHidden: true,
      });
      const [calendars, accounts] = await Promise.all([
        client.calendar.list({ includeHidden: true }),
        client.account.list(),
      ]);
      return { schedule, calendars, accounts };
    },
    refetchInterval: 60_000,
  });
  const calendars = query.data?.calendars ?? [];
  const calendarById = new Map(calendars.map((c) => [c.id, c]));
  const defaultCalendar =
    calendars.find((c) => c.writable && c.primaryOfAccount) ??
    calendars.find((c) => c.writable);
  const days = filterDays(
    query.data?.schedule.days ?? [],
    calendars,
    visibility,
    showTasks,
    search,
  );
  const selectedDay = days.find((day) => day.date === selected);
  const today = dateIn(zone);
  const unique = new Map(
    days
      .flatMap((day) => [...day.allDay, ...day.timed])
      .map((entry) => [entryId(entry), entry]),
  );
  const events: EventInput[] = Array.from(unique.values()).map((entry) => {
    if (entry.kind === "task") {
      const task = entry.task;
      return {
        id: task.id,
        title: task.title,
        ...taskCalendarTime(task, zone),
        editable: false,
        classNames: ["schedule-task"],
        extendedProps: { entry },
      };
    }
    const event = entry.occurrence;
    const calendar = calendarById.get(event.calendarId);
    return {
      id: event.occurrenceId,
      title: event.title,
      start: calendarTime(event.start, zone),
      end: calendarTime(event.end, zone),
      allDay: "date" in event.start,
      editable: calendar?.writable && event.status !== "cancelled",
      classNames: [
        event.status === "cancelled" ? "event-cancelled" : "",
        !event.busy ? "event-free" : "",
      ],
      extendedProps: { entry, calendarName: calendar?.name },
      borderColor: calendar?.color ?? undefined,
    };
  });
  useEffect(() => {
    document.title = "Calendar · Life-OS";
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(timeout);
  }, [toast]);
  function navigate(date: string) {
    setSelected(date);
    setMobileOpen(false);
    if (view === "agenda") {
      setRange({ from: date, days: 30 });
      setHeading(formatDate(date, "LLLL yyyy"));
    } else calendarRef.current?.getApi().gotoDate(date);
  }
  function changeView(next: CalendarView) {
    activeView.current = next;
    setView(next);
    if (next === "agenda") {
      setRange({ from: selected, days: 30 });
      setHeading(formatDate(selected, "LLLL yyyy"));
    } else calendarRef.current?.getApi().changeView(next, selected);
  }
  function step(direction: number) {
    const date = DateTime.fromISO(selected)
      .plus(
        view === "dayGridMonth"
          ? { months: direction }
          : {
              days:
                direction *
                (view === "timeGridDay" ? 1 : view === "agenda" ? 30 : 7),
            },
      )
      .toISODate()!;
    navigate(date);
  }
  function addEvent() {
    if (!defaultCalendar) return;
    setEditor({
      draft: {
        ...draftFor(selected, zone, defaultCalendar.id),
        allDay: false,
        start: `${selected}T09:00`,
        end: `${selected}T10:00`,
      },
    });
    setMobileOpen(false);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        editor ||
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof HTMLElement &&
          (event.target.closest("input,textarea,select") ||
            event.target.isContentEditable))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setToolsOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        addEvent();
      }
      if (event.key.toLowerCase() === "t") navigate(today);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  async function openEntry(
    entry: ScheduleEntry,
    selection?: { start: string; end: string; allDay: boolean },
  ) {
    if (entry.kind === "task") {
      window.location.assign(`/todo?task=${encodeURIComponent(entry.task.id)}`);
      return;
    }
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      const latest = await api.event.get(entry.occurrence.occurrenceId);
      if (!latest || latest.deletedAt)
        throw new Error(
          "This event is no longer available. Refresh the calendar.",
        );
      const occurrence = { ...entry.occurrence, ...latest } as Occurrence;
      const draft = draftFor(selected, zone, occurrence.calendarId, occurrence);
      // Dragging opens a reviewable form. The calendar itself is reverted until the API confirms a save.
      if (selection) {
        const picked = draftFromSelection(
          selection.start,
          selection.end,
          selection.allDay,
          zone,
          occurrence.calendarId,
        );
        Object.assign(draft, {
          start: picked.start,
          end: picked.end,
          allDay: picked.allDay,
          timezone: zone,
          floating: false,
        });
      }
      setEditor({ occurrence, draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open this event.");
    } finally {
      setOpening(false);
    }
  }
  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    try {
      const results = await Promise.allSettled(
        calendars.map((calendar) => api.calendar.sync(calendar.id)),
      );
      const failures = results.flatMap((result) =>
        result.status === "rejected"
          ? [String(result.reason)]
          : result.value.calendars
              .filter((c) => c.outcome === "failed")
              .map((c) => c.error || "A calendar could not sync."),
      );
      await queryClient.invalidateQueries({ queryKey: ["calendar-workspace"] });
      if (failures.length) setError(failures.join(" · "));
      else setToast("Calendar refreshed");
    } finally {
      setSyncing(false);
    }
  }
  function datesSet(info: DatesSetArg) {
    if (activeView.current === "agenda") return;
    const from = info.startStr.slice(0, 10);
    const count = Math.round(
      DateTime.fromISO(info.endStr.slice(0, 10)).diff(
        DateTime.fromISO(from),
        "days",
      ).days,
    );
    setRange((old) =>
      old.from === from && old.days === count ? old : { from, days: count },
    );
    setHeading(info.view.title);
  }
  const warnings = query.data?.schedule.warnings ?? [];
  const syncErrors =
    query.data?.schedule.freshness.filter((f) => f.error) ?? [];
  const sidebar = (
    <>
      <Button
        className="calendar-add"
        onClick={addEvent}
        disabled={!defaultCalendar}
      >
        <Plus size={18} />
        New event <kbd>N</kbd>
      </Button>
      <MiniMonth selected={selected} today={today} select={navigate} />
      <section className="calendar-list" aria-label="Calendars">
        <h2>My calendars</h2>
        {query.data?.accounts.map((account) => (
          <div key={account.id}>
            <p className="calendar-account">
              {account.label || account.identity}
            </p>
            {account.status !== "connected" && (
              <p className="calendar-alert">
                Reconnect this account with the Life CLI.
              </p>
            )}
            {calendars
              .filter((c) => c.accountId === account.id)
              .map((calendar) => (
                <label
                  className="calendar-toggle"
                  key={calendar.id}
                  style={calendarColor(calendar)}
                >
                  <input
                    type="checkbox"
                    checked={visibility[calendar.id] ?? !calendar.hidden}
                    onChange={(e) =>
                      setVisibility((v) => ({
                        ...v,
                        [calendar.id]: e.target.checked,
                      }))
                    }
                  />
                  <span className="calendar-dot" />
                  <span>
                    {calendar.name}
                    {!calendar.writable && <small>Read-only</small>}
                  </span>
                </label>
              ))}
          </div>
        ))}
        <label className="calendar-toggle">
          <input
            type="checkbox"
            checked={showTasks}
            onChange={(e) => setShowTasks(e.target.checked)}
          />
          <ListTodo size={15} />
          <span>Scheduled tasks</span>
        </label>
      </section>
      <section className="sidebar-agenda">
        <h2>{formatDate(selected, "ccc, LLL d")}</h2>
        {query.isPending ? (
          <p role="status">Loading schedule…</p>
        ) : (
          <Agenda
            days={selectedDay ? [selectedDay] : []}
            zone={zone}
            calendars={calendarById}
            open={openEntry}
            compact
            empty={
              query.isError ? "Schedule unavailable" : "No items on this day"
            }
          />
        )}
      </section>
    </>
  );
  return (
    <Shell
      title="Calendar"
      description="Make room for what matters"
      sidebar={sidebar}
      mobileOpen={mobileOpen}
      setMobileOpen={setMobileOpen}
    >
      <main id="main" className="calendar-page">
        <div className="calendar-heading">
          <div>
            <h1>{heading || formatDate(selected, "LLLL yyyy")}</h1>
          </div>
          <Button onClick={addEvent} disabled={!defaultCalendar}>
            <Plus size={18} />
            <span>New event</span>
          </Button>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-navigation">
            <Button variant="secondary" onClick={() => navigate(today)}>
              Today
            </Button>
            <IconButton aria-label="Previous period" onClick={() => step(-1)}>
              <ChevronLeft size={19} />
            </IconButton>
            <IconButton aria-label="Next period" onClick={() => step(1)}>
              <ChevronRight size={19} />
            </IconButton>
          </div>
          <div
            className="calendar-views"
            role="group"
            aria-label="Calendar view"
          >
            {views.map(([key, name]) => (
              <button
                key={key}
                aria-pressed={view === key}
                onClick={() => changeView(key)}
              >
                {name}
              </button>
            ))}
          </div>
          <IconButton
            aria-label="Refresh calendars"
            disabled={syncing || query.isPending}
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} className={syncing ? "spinning" : ""} />
          </IconButton>
        </div>
        <button
          className="calendar-tools-toggle text-button"
          aria-expanded={toolsOpen}
          aria-controls="calendar-tools"
          onClick={() => setToolsOpen(!toolsOpen)}
        >
          <Search size={16} /> Search & timezone
          {search ? " · Filter active" : ""}
        </button>
        <div
          id="calendar-tools"
          className={`calendar-tools ${toolsOpen ? "is-open" : ""}`}
        >
          <label className="calendar-search">
            <Search size={16} />
            <span className="sr-only">Search this date range</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search this date range"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="calendar-timezone">
            <span className="sr-only">Display timezone</span>
            <select
              aria-label="Display timezone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
            >
              {zoneChoices.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(error || query.isError) && (
          <div className="calendar-alert" role="alert">
            {error || query.error?.message}
            <Button
              variant="secondary"
              onClick={() => {
                setError("");
                void query.refetch();
              }}
            >
              Reload schedule
            </Button>
          </div>
        )}
        {(warnings.length > 0 || syncErrors.length > 0) && (
          <details className="calendar-alert">
            <summary>
              Some calendars could not refresh. Showing the last available copy.
            </summary>
            {Array.from(
              new Set([
                ...warnings,
                ...syncErrors.map((f) => `${f.name}: ${f.error}`),
              ]),
            ).map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
        )}
        {query.data && calendars.length === 0 && (
          <div className="calendar-empty">
            <CalendarDays size={28} />
            <div>
              <h2>Bring your calendar into view</h2>
              <p>
                Connect Google Calendar with{" "}
                <code>life account add google</code>, then refresh. Your
                scheduled tasks can still appear here.
              </p>
            </div>
          </div>
        )}
        <div className="calendar-status" role="status">
          {opening
            ? "Opening event…"
            : query.isError
              ? "Schedule unavailable"
              : query.isFetching
                ? "Updating schedule…"
                : search
                  ? `${unique.size} matching items in this date range`
                  : `${unique.size} items in view`}
        </div>
        {query.isPending && (
          <div className="calendar-loading" role="status">
            Loading your calendar…
          </div>
        )}
        {(view === "timeGridWeek" || view === "dayGridMonth") && (
          <p className="calendar-scroll-hint">
            Swipe sideways to see the rest of the week.
          </p>
        )}
        <div ref={gridRef} className="calendar-grid" hidden={view === "agenda"}>
          <FullCalendar
            ref={calendarRef}
            plugins={plugins}
            initialView={view === "agenda" ? "timeGridWeek" : view}
            initialDate={selected}
            timeZone={zone}
            headerToolbar={false}
            datesSet={datesSet}
            events={events}
            height="min(72rem, max(36rem, calc(100dvh - 19rem)))"
            firstDay={0}
            nowIndicator
            dayMaxEvents={3}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            scrollTime="08:00:00"
            allDaySlot
            stickyHeaderDates
            editable
            selectable={Boolean(defaultCalendar)}
            selectMirror
            eventMinHeight={24}
            eventShortHeight={48}
            slotEventOverlap={false}
            handleWindowResize
            eventTimeFormat={{
              hour: "numeric",
              minute: "2-digit",
              meridiem: "short",
            }}
            select={(info) => {
              calendarRef.current?.getApi().unselect();
              if (defaultCalendar)
                setEditor({
                  draft: draftFromSelection(
                    info.startStr,
                    info.endStr,
                    info.allDay,
                    zone,
                    defaultCalendar.id,
                  ),
                });
            }}
            eventClick={(info) => {
              void openEntry(info.event.extendedProps.entry);
            }}
            eventDrop={(info) => {
              const entry = info.event.extendedProps.entry as ScheduleEntry;
              const selection = {
                start: info.event.startStr,
                end: info.event.endStr,
                allDay: info.event.allDay,
              };
              info.revert();
              if (selection.end) void openEntry(entry, selection);
            }}
            eventResize={(info) => {
              const entry = info.event.extendedProps.entry as ScheduleEntry;
              const selection = {
                start: info.event.startStr,
                end: info.event.endStr,
                allDay: info.event.allDay,
              };
              info.revert();
              void openEntry(entry, selection);
            }}
            eventContent={renderEvent}
            moreLinkDidMount={({ el }) => {
              el.setAttribute("role", "button");
              if (!el.getAttribute("aria-controls"))
                el.removeAttribute("aria-controls");
            }}
            dayHeaderDidMount={({ el }) => {
              const label = el.querySelector("a[aria-label]");
              if (label && !label.hasAttribute("href")) {
                el.setAttribute(
                  "aria-label",
                  label.getAttribute("aria-label")!,
                );
                label.removeAttribute("aria-label");
              }
            }}
            eventDidMount={({ el }) => {
              el.setAttribute("role", "button");
            }}
            eventClassNames={(info) =>
              info.event.extendedProps.entry?.kind === "event" &&
              info.event.extendedProps.entry.occurrence.myResponse ===
                "needsAction"
                ? ["event-invitation"]
                : []
            }
            dayCellClassNames={(info) =>
              DateTime.fromJSDate(info.date, { zone }).toISODate() === selected
                ? ["selected-calendar-day"]
                : []
            }
          />
        </div>
        {view === "agenda" && (
          <div className="calendar-agenda">
            <Agenda
              days={days}
              zone={zone}
              calendars={calendarById}
              open={openEntry}
              empty={
                query.isPending
                  ? "Loading schedule…"
                  : query.isError
                    ? "Schedule unavailable"
                    : search
                      ? "No matches in this date range"
                      : "No items in this date range"
              }
            />
          </div>
        )}
        <p className="calendar-footer">
          {zone.replaceAll("_", " ")}
          <span>
            Times shown in your display timezone · <kbd>T</kbd> Today ·{" "}
            <kbd>N</kbd> New event
          </span>
        </p>
      </main>
      {editor && (
        <EventEditor
          key={editor.occurrence?.occurrenceId ?? "new"}
          {...editor}
          calendars={calendars}
          close={() => setEditor(null)}
          saved={(message) => {
            setEditor(null);
            setToast(message);
            void queryClient.invalidateQueries({
              queryKey: ["calendar-workspace"],
            });
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <IconButton
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
    </Shell>
  );
}
function MiniMonth({
  selected,
  today,
  select,
}: {
  selected: string;
  today: string;
  select: (date: string) => void;
}) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [focused, setFocused] = useState(selected);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    setMonth(selected.slice(0, 7));
    setFocused(selected);
  }, [selected]);
  useEffect(() => {
    if (moveFocus.current) {
      pickerRef.current
        ?.querySelector<HTMLElement>(`[data-date="${focused}"]`)
        ?.focus();
      moveFocus.current = false;
    }
  }, [focused, month]);
  const dates = monthDates(`${month}-01`);
  const tabDate = dates.includes(focused) ? focused : `${month}-01`;
  return (
    <section className="mini-month" aria-label="Date picker">
      <header>
        <strong>{formatDate(`${month}-01`, "LLLL yyyy")}</strong>
        <IconButton
          aria-label="Previous month in date picker"
          onClick={() =>
            setMonth(
              DateTime.fromISO(`${month}-01`)
                .minus({ months: 1 })
                .toFormat("yyyy-MM"),
            )
          }
        >
          <ChevronLeft size={15} />
        </IconButton>
        <IconButton
          aria-label="Next month in date picker"
          onClick={() =>
            setMonth(
              DateTime.fromISO(`${month}-01`)
                .plus({ months: 1 })
                .toFormat("yyyy-MM"),
            )
          }
        >
          <ChevronRight size={15} />
        </IconButton>
      </header>
      <label className="mobile-date-picker">
        Go to date
        <input
          type="date"
          value={selected}
          onChange={(event) => {
            if (event.target.value) select(event.target.value);
          }}
        />
      </label>
      <div className="mini-month-grid" ref={pickerRef}>
        {["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
          <span key={i} aria-hidden="true">
            {day}
          </span>
        ))}
        {dates.map((date) => (
          <button
            key={date}
            data-date={date}
            tabIndex={date === tabDate ? 0 : -1}
            aria-describedby="date-picker-help"
            aria-label={formatDate(date, "cccc, LLLL d, yyyy")}
            aria-pressed={date === selected}
            aria-current={date === today ? "date" : undefined}
            className={date.slice(0, 7) !== month ? "outside-month" : ""}
            onClick={() => select(date)}
            onKeyDown={(event) => {
              const day = DateTime.fromISO(date).weekday % 7;
              const offsets: Record<string, number> = {
                ArrowLeft: -1,
                ArrowRight: 1,
                ArrowUp: -7,
                ArrowDown: 7,
                Home: -day,
                End: 6 - day,
              };
              if (!(event.key in offsets)) return;
              event.preventDefault();
              const next = shiftDate(date, offsets[event.key]!);
              moveFocus.current = true;
              setFocused(next);
              if (!dates.includes(next)) setMonth(next.slice(0, 7));
            }}
          >
            {Number(date.slice(8))}
          </button>
        ))}
      </div>
      <p id="date-picker-help" className="sr-only">
        Use arrow keys to move by day or week, Home and End to move within a
        week, and Enter to select.
      </p>
    </section>
  );
}
function renderEvent(info: EventContentArg) {
  const entry = info.event.extendedProps.entry as ScheduleEntry;
  return (
    <div
      className="calendar-event-content"
      title={`${info.event.title}${info.timeText ? ` · ${info.timeText}` : ""}`}
    >
      <span className="sr-only">
        {info.event.extendedProps.calendarName
          ? `${info.event.extendedProps.calendarName}: `
          : ""}
      </span>
      <strong>
        {entry.kind === "task" && <ListTodo size={12} />}
        {info.event.title}
      </strong>
      {info.timeText && (
        <span className="calendar-event-time">{info.timeText}</span>
      )}
      {entry.kind === "event" && (
        <>
          {entry.occurrence.status === "cancelled" && <span>Cancelled</span>}
          {entry.occurrence.myResponse === "needsAction" && (
            <span>Invitation</span>
          )}
          {!entry.occurrence.busy && <span>Free</span>}
          {entry.occurrence.location && (
            <span className="calendar-event-location">
              {entry.occurrence.location}
            </span>
          )}
        </>
      )}
    </div>
  );
}
function Agenda({
  days,
  zone,
  calendars,
  open,
  compact = false,
  empty,
}: {
  days: Day[];
  zone: string;
  calendars: Map<string, Calendar>;
  open: (entry: ScheduleEntry) => void;
  compact?: boolean;
  empty: string;
}) {
  const nonempty = days.filter((day) => day.allDay.length || day.timed.length);
  if (!nonempty.length) return <p className="agenda-empty">{empty}</p>;
  return (
    <div className={compact ? "agenda compact" : "agenda"}>
      {nonempty.map((day) => (
        <section key={day.date}>
          {!compact && (
            <h2>
              <span>{formatDate(day.date, "dd")}</span>
              <div>
                {formatDate(day.date, "cccc")}
                <small>{formatDate(day.date, "LLLL yyyy")}</small>
              </div>
            </h2>
          )}
          <div>
            {[...day.allDay, ...day.timed].map((entry) => {
              const event = entry.kind === "event" ? entry.occurrence : null;
              const calendar = event
                ? calendars.get(event.calendarId)
                : undefined;
              return (
                <button
                  key={entryId(entry)}
                  className="agenda-item"
                  style={calendarColor(calendar)}
                  onClick={() => open(entry)}
                >
                  <span className="agenda-time">
                    {event
                      ? timeLabel(event.start, zone)
                      : entry.kind === "task" && entry.task.due?.time
                        ? DateTime.fromISO(
                            `${entry.task.due.date}T${entry.task.due.time}`,
                            { zone: entry.task.due.timezone ?? zone },
                          )
                            .setZone(zone)
                            .toLocaleString(DateTime.TIME_SIMPLE)
                        : "Any time"}
                    {!compact && event && "at" in event.end && (
                      <small>{timeLabel(event.end, zone)}</small>
                    )}
                  </span>
                  <span className="agenda-body">
                    <strong
                      className={event?.status === "cancelled" ? "struck" : ""}
                    >
                      {entryTitle(entry)}
                    </strong>
                    <small>
                      {event ? calendar?.name : "Task"}
                      {entry.kind === "task" && entry.task.duration !== undefined
                        ? ` · ${entry.task.duration} min`
                        : ""}
                      {event?.repeat || event?.masterId ? (
                        <Repeat2 size={12} />
                      ) : null}
                      {event?.status === "cancelled"
                        ? " · Cancelled"
                        : event?.myResponse === "needsAction"
                          ? " · Invitation"
                          : ""}
                    </small>
                    {!compact && event?.location && (
                      <small>
                        <MapPin size={12} />
                        {event.location}
                      </small>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
