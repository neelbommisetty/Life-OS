import { useRef, useState } from "react";
import { ExternalLink, Repeat2, Trash2 } from "lucide-react";
import { api, context } from "./data";
import { Button, Modal } from "./ui";
import {
  draftFor,
  inputFromDraft,
  updateFromDraft,
  safeLink,
  type Calendar,
  type EventDraft,
  type Occurrence,
} from "./calendar-model";
import type {
  EventReceipt,
  Scope,
} from "../../../packages/tools/src/calendar/events.ts";
export function EventEditor({
  draft: initial,
  occurrence,
  calendars,
  close,
  saved,
}: {
  draft: EventDraft;
  occurrence?: Occurrence;
  calendars: Calendar[];
  close: () => void;
  saved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [scope, setScope] = useState<Scope | "">("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(occurrence));
  const errorRef = useRef<HTMLDivElement>(null);
  const attempt = useRef({ signature: "", key: "" });
  const inFlight = useRef(false);
  const original = occurrence
    ? draftFor("", initial.timezone, occurrence.calendarId, occurrence)
    : undefined;
  const recurring = Boolean(occurrence?.repeat || occurrence?.masterId);
  const writable =
    calendars.find((c) => c.id === draft.calendar)?.writable ?? false;
  const change = <K extends keyof EventDraft>(
    field: K,
    value: EventDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDeleting(false);
  };
  async function submit(
    action: "save" | "delete" | "accepted" | "tentative" | "declined",
  ) {
    if (inFlight.current) return;
    setError("");
    try {
      if (recurring && !scope)
        throw new Error("Choose which events this change applies to.");
      if (
        ["accepted", "tentative", "declined"].includes(action) &&
        scope === "following"
      )
        throw new Error(
          "Invitation responses apply to this event or all events. Choose one of those scopes.",
        );
      const input =
        action === "save"
          ? original
            ? updateFromDraft(draft, original)
            : inputFromDraft(draft)
          : null;
      const signature = JSON.stringify({
        action,
        input,
        scope,
        ref: occurrence?.occurrenceId,
      });
      if (signature !== attempt.current.signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      inFlight.current = true;
      setPending(true);
      const ctx = context(occurrence?.version, attempt.current.key);
      const opts = scope ? { scope } : undefined;
      const ref = occurrence?.masterId
        ? `${occurrence.id}@${occurrence.occurrenceId.split("@")[1]}`
        : occurrence?.occurrenceId;
      let receipt: EventReceipt;
      if (!occurrence)
        receipt = await api.event.add(inputFromDraft(draft), ctx);
      else if (action === "save")
        receipt = await api.event.update(ref!, input!, ctx, opts);
      else if (action === "delete")
        receipt = await api.event.delete(ref!, ctx, opts);
      else receipt = await api.event.respond(ref!, action, ctx, opts);
      if (!receipt.ok)
        throw new Error(
          (receipt.partial
            ? "Only part of the change completed. Refresh the calendar before trying again. "
            : "") + receipt.issues.join(" · "),
        );
      saved(
        [
          action === "delete"
            ? "Event deleted"
            : action === "save"
              ? "Event saved"
              : "Invitation response saved",
          ...(receipt.warnings ?? []),
        ].join(". "),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change could not be saved.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  const conference = safeLink(occurrence?.conferencing?.url);
  const recurrenceOptions = [
    ["", "Does not repeat"],
    ["FREQ=DAILY", "Every day"],
    ["FREQ=WEEKLY", "Every week"],
    ["FREQ=MONTHLY", "Every month"],
    ["FREQ=YEARLY", "Every year"],
  ];
  function toggleAllDay(allDay: boolean) {
    setDraft((current) => ({
      ...current,
      allDay,
      start: current.start.slice(0, 10) + (allDay ? "" : "T09:00"),
      end: current.end.slice(0, 10) + (allDay ? "" : "T10:00"),
    }));
  }
  return (
    <Modal
      title={
        occurrence ? (writable ? "Event details" : "View event") : "New event"
      }
      close={() => {
        if (!inFlight.current) close();
      }}
      wide
    >
      <form
        className="event-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit("save");
        }}
      >
        {error && (
          <div
            className="calendar-alert"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            {error}
          </div>
        )}
        {occurrence?.status === "cancelled" && (
          <p className="calendar-alert">This event is cancelled.</p>
        )}
        {!writable && <p className="muted">This calendar is read-only.</p>}
        {recurring && (
          <label className="scope-field">
            <span>
              <Repeat2 size={16} />
              Apply changes to
            </span>
            <select
              required
              value={scope}
              disabled={pending}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setDeleting(false);
                setDraft((d) => ({ ...d, repeat: original!.repeat }));
              }}
            >
              <option value="">Choose event scope…</option>
              <option value="this">Only this event</option>
              <option value="following">This and following events</option>
              <option value="all">All events in this series</option>
            </select>
            <small>
              Choose a scope before saving, deleting, or responding.
            </small>
          </label>
        )}
        <fieldset
          disabled={pending || !writable}
          onInvalidCapture={(event) => {
            const input = event.target as HTMLInputElement;
            if (input.closest("details")) {
              setDetailsOpen(true);
              requestAnimationFrame(() => input.focus());
            }
          }}
        >
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={500}
              value={draft.title}
              onChange={(e) => change("title", e.target.value)}
              placeholder="What’s on your calendar?"
            />
          </label>
          <label>
            Calendar
            <select
              value={draft.calendar}
              disabled={Boolean(occurrence)}
              onChange={(e) => change("calendar", e.target.value)}
            >
              {calendars
                .filter((c) => c.writable || c.id === draft.calendar)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.writable ? " (read-only)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(e) => toggleAllDay(e.target.checked)}
            />
            All day
          </label>
          <div className="event-fields">
            <label>
              Starts
              <input
                required
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.start}
                onChange={(e) => change("start", e.target.value)}
              />
            </label>
            <label>
              {draft.allDay ? "Last day" : "Ends"}
              <input
                required
                type={draft.allDay ? "date" : "datetime-local"}
                value={draft.end}
                min={draft.start}
                onChange={(e) => change("end", e.target.value)}
              />
            </label>
          </div>
          <details
            className="event-options"
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          >
            <summary>
              Event options{" "}
              <span className="muted">
                Timezone, location, repeat and notes
              </span>
            </summary>
            <div className="event-options-fields">
              {!draft.allDay && (
                <>
                  <label>
                    Timezone
                    <input
                      required
                      list="event-timezones"
                      value={draft.timezone}
                      disabled={draft.floating}
                      onChange={(e) => change("timezone", e.target.value)}
                    />
                  </label>
                  <datalist id="event-timezones">
                    {[
                      "America/Los_Angeles",
                      "America/New_York",
                      "Europe/London",
                      "Asia/Kolkata",
                      "UTC",
                    ].map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={draft.floating}
                      onChange={(e) => change("floating", e.target.checked)}
                    />
                    Keep the same local time in every timezone
                  </label>
                </>
              )}
              <label>
                Location
                <input
                  value={draft.location}
                  maxLength={500}
                  onChange={(e) => change("location", e.target.value)}
                  placeholder="Add a place"
                />
              </label>
              {occurrence?.masterId ? (
                <p className="muted">
                  Part of a recurring series. Open an unchanged occurrence to
                  edit the repeat rule.
                </p>
              ) : (
                <label>
                  Repeat
                  <select
                    value={draft.repeat}
                    disabled={
                      Boolean(occurrence?.masterId) ||
                      (recurring && scope !== "all")
                    }
                    onChange={(e) => change("repeat", e.target.value)}
                  >
                    {!recurrenceOptions.some(
                      ([rule]) => rule === draft.repeat,
                    ) && (
                      <option value={draft.repeat}>
                        Custom recurrence (preserved)
                      </option>
                    )}
                    {recurrenceOptions.map(([rule, name]) => (
                      <option key={rule} value={rule}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Notes
                <textarea
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => change("notes", e.target.value)}
                  placeholder="Anything you want to remember"
                />
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={draft.busy}
                  onChange={(e) => change("busy", e.target.checked)}
                />
                Show this time as busy
              </label>
            </div>
          </details>
        </fieldset>
        {occurrence && (
          <div className="event-provider-details">
            {occurrence.organizer && (
              <p>
                Organized by{" "}
                {occurrence.organizer.name || occurrence.organizer.email}
              </p>
            )}
            {occurrence.attendees.length > 0 && (
              <details>
                <summary>{occurrence.attendees.length} guests</summary>
                <ul>
                  {occurrence.attendees.map((a) => (
                    <li key={a.email}>
                      {a.name || a.email} ·{" "}
                      {a.response === "needsAction"
                        ? "Awaiting response"
                        : a.response}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {conference && (
              <a
                className="text-button"
                href={conference}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} /> Join {occurrence.conferencing!.kind}
              </a>
            )}
            {occurrence.myResponse !== null && (
              <div className="event-response">
                <p>
                  Your response:{" "}
                  {occurrence.myResponse === "needsAction"
                    ? "Not yet answered"
                    : occurrence.myResponse}
                </p>
                {(["accepted", "tentative", "declined"] as const).map(
                  (value, i) => (
                    <Button
                      type="button"
                      variant="secondary"
                      key={value}
                      disabled={pending}
                      onClick={() => void submit(value)}
                    >
                      {["Accept", "Maybe", "Decline"][i]}
                    </Button>
                  ),
                )}
              </div>
            )}
          </div>
        )}
        {deleting && (
          <div className="calendar-alert">
            <p>
              Delete “{occurrence?.title}”
              {scope === "all"
                ? " and its entire series"
                : scope === "following"
                  ? " and all following events"
                  : ""}{" "}
              from its calendar?
            </p>
            <Button
              type="button"
              variant="destructive"
              pending={pending}
              onClick={() => void submit("delete")}
            >
              Confirm delete
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setDeleting(false)}
            >
              Keep event
            </Button>
          </div>
        )}
        <div className="dialog-actions">
          {occurrence && writable && (
            <Button
              type="button"
              variant="secondary"
              className="event-delete"
              disabled={pending}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={close}
          >
            {writable ? "Cancel" : "Close"}
          </Button>
          {writable && (
            <Button type="submit" pending={pending}>
              {pending ? "Saving…" : occurrence ? "Save changes" : "Add event"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
