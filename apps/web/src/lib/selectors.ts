import type {
  HomeData,
  Focus,
  EvidenceRecord,
  Block,
  Observation,
} from "./contract";

export function focusFreshness(data: HomeData, focus: Focus, now: string) {
  const records = new Map(data.records.map((record) => [record.id, record]));
  return {
    evidenceChanged: focus.evidence.some(
      (ref) => records.get(ref.recordId)?.version !== ref.version,
    ),
    reviewDue: Date.parse(now) > Date.parse(focus.reviewAfter),
  };
}
export function operationalRecords(data: HomeData, now: string) {
  return {
    tasks: data.records
      .filter(
        (record): record is Extract<EvidenceRecord, { kind: "task" }> =>
          record.kind === "task" && record.status === "open",
      )
      .sort(
        (a, b) =>
          (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
          a.title.localeCompare(b.title),
      ),
    events: data.records
      .filter(
        (record): record is Extract<EvidenceRecord, { kind: "event" }> =>
          record.kind === "event" &&
          record.status !== "cancelled" &&
          Date.parse(record.end) >= Date.parse(now),
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  };
}
export function observationsFor(
  data: HomeData,
  block: Extract<Block, { type: "metric" }>,
): Observation[] {
  return data.records
    .filter(
      (record): record is Observation =>
        record.kind === "observation" &&
        record.metricId === block.metricId &&
        record.date >= block.from &&
        record.date <= block.through,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
export const displayDate = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date.slice(0, 10) + "T12:00:00Z"));
export const displayChecked = (timestamp: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  }).format(new Date(timestamp));
export const displayEventTime = (
  event: Extract<EvidenceRecord, { kind: "event" }>,
) => {
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: event.timezone,
  }).format(new Date(event.start));
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: event.timezone,
  });
  return `${day} · ${time.format(new Date(event.start))}–${time.format(new Date(event.end))}`;
};
