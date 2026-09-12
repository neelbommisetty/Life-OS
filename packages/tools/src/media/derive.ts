// Derivation (LEISURE D91): a title's status, ownership, rating, and review
// are read off its diary, never set. This module orders entries, derives the
// five stored fields, cuts the diary into cycles, and says which entry types a
// title in a given state accepts. Pure: no store, no clock, no network.

import type { BookFormat, Entry, EntryType, Ownership, Progress, Rating, Title } from "../contract.ts";
import { compareOn, formatOn } from "./on.ts";

/**
 * Where an entry sorts among others with the same `on` and `at`: notes and
 * progress carry no transition and go first; transitions in the order a day
 * would naturally hold them; ownership entries after the progress facet.
 */
const TYPE_RANK: Record<EntryType, number> = {
  note: 0,
  progress: 0,
  want: 1,
  start: 2,
  again: 3,
  resume: 4,
  pause: 5,
  drop: 6,
  finish: 7,
  buy: 8,
  borrow: 9,
  service: 10,
  return: 11,
};

/** The progress state each transition lands in; notes and progress carry none. */
const PROGRESS_TARGET: Partial<Record<EntryType, Progress>> = {
  want: "backlog",
  start: "active",
  again: "active",
  resume: "active",
  pause: "paused",
  drop: "dropped",
  finish: "done",
};

/** The ownership state each ownership entry lands in. */
const OWNERSHIP_TARGET: Partial<Record<EntryType, Ownership>> = {
  buy: "owned",
  borrow: "borrowed",
  service: "service",
  return: "none",
};

const OPENERS: ReadonlySet<EntryType> = new Set(["start", "again"]);
const CLOSERS: ReadonlySet<EntryType> = new Set(["finish", "drop"]);

export const isProgressTransition = (type: EntryType): boolean => type in PROGRESS_TARGET;
export const isOwnershipEntry = (type: EntryType): boolean => type in OWNERSHIP_TARGET;
export const isProgressFacet = (type: EntryType): boolean => !isOwnershipEntry(type);

/** Entries in diary order: `on` (unknown first, then date, coarser first on a tie), then `at`, then type rank, then id. */
export function orderEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const byOn = compareOn(a.on, b.on);
    if (byOn !== 0) return byOn;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    const byRank = TYPE_RANK[a.type] - TYPE_RANK[b.type];
    if (byRank !== 0) return byRank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The last entry in diary order, or null. */
export function lastEntry(entries: Entry[]): Entry | null {
  const ordered = orderEntries(entries);
  return ordered.length ? ordered[ordered.length - 1]! : null;
}

/** The last entry (in diary order) that `pick` accepts. */
function lastWhere(entries: Entry[], pick: (entry: Entry) => boolean): Entry | null {
  const ordered = orderEntries(entries);
  for (let i = ordered.length - 1; i >= 0; i -= 1) if (pick(ordered[i]!)) return ordered[i]!;
  return null;
}

/** The target of the last transition-bearing entry; `curious` when there is none (D99). */
export function deriveProgress(entries: Entry[]): Progress {
  const last = lastWhere(entries, (entry) => isProgressTransition(entry.type));
  return last ? PROGRESS_TARGET[last.type]! : "curious";
}

/** The target of the last ownership entry and its where, since, and purchase price; `none` and null detail when there is none or it was a return. */
export function deriveOwnership(entries: Entry[]): { ownership: Ownership; detail: Title["ownershipDetail"] } {
  const last = lastWhere(entries, (entry) => isOwnershipEntry(entry.type));
  if (!last) return { ownership: "none", detail: null };
  const ownership = OWNERSHIP_TARGET[last.type]!;
  if (ownership === "none") return { ownership, detail: null };
  const price = last.spend && last.spend.kind === "purchase" ? { amount: last.spend.amount, currency: last.spend.currency } : null;
  return { ownership, detail: { where: last.where, since: last.on, price } };
}

/** The current take (D80): the latest closing entry's rating and, independently, the latest closing entry's text. */
export function deriveTake(entries: Entry[]): { rating: Rating | null; review: string | null } {
  const rated = lastWhere(entries, (entry) => CLOSERS.has(entry.type) && entry.rating !== null);
  const reviewed = lastWhere(entries, (entry) => CLOSERS.has(entry.type) && entry.text !== null);
  return { rating: rated?.rating ?? null, review: reviewed?.text ?? null };
}

export type Derived = Pick<Title, "status" | "ownership" | "ownershipDetail" | "rating" | "review">;

/** The five stored derived fields, from the diary alone. */
export function derive(entries: Entry[]): Derived {
  const { ownership, detail } = deriveOwnership(entries);
  const { rating, review } = deriveTake(entries);
  return { status: deriveProgress(entries), ownership, ownershipDetail: detail, rating, review };
}

/** The title with its derived fields recomputed from its entries. Every write goes through here before it is persisted. */
export function finalize(title: Title): Title {
  return { ...title, ...derive(title.entries) };
}

export type Cycle = {
  /** The `start` or `again` that opened it; null for a closer with no open cycle (a cycle of one). */
  opened: Entry | null;
  /** The `finish` or `drop` that closed it; null while open, or when the next opener cut it short. */
  closed: Entry | null;
  /** Every entry of the cycle in diary order, opener and closer included. */
  entries: Entry[];
  /** The opener's format, else the closer's (the format this read or play was in). */
  format: BookFormat | null;
};

const cycleOf = (opened: Entry | null, closed: Entry | null, entries: Entry[]): Cycle => ({
  opened,
  closed,
  entries,
  format: opened?.format ?? closed?.format ?? null,
});

/**
 * The diary cut into reads, watches, or plays: an opener (`start`, `again`)
 * opens a cycle, the next closer (`finish`, `drop`) closes it, an opener while
 * one is open closes the previous with `closed: null`, and a closer with no
 * open cycle is a cycle of one. Entries before the first opener and after a
 * close belong to no cycle.
 */
export function cycles(entries: Entry[]): Cycle[] {
  const result: Cycle[] = [];
  let opened: Entry | null = null;
  let current: Entry[] = [];
  for (const entry of orderEntries(entries)) {
    if (OPENERS.has(entry.type)) {
      if (opened) result.push(cycleOf(opened, null, current));
      opened = entry;
      current = [entry];
    } else if (CLOSERS.has(entry.type)) {
      if (opened) {
        current.push(entry);
        result.push(cycleOf(opened, entry, current));
        opened = null;
        current = [];
      } else {
        result.push(cycleOf(null, entry, [entry]));
      }
    } else if (opened) {
      current.push(entry);
    }
  }
  if (opened) result.push(cycleOf(opened, null, current));
  return result;
}

export type Allowed = { ok: true } | { ok: false; issue: string; hint: string };

/** Which progress states each transition may be appended from. `progress`, `note`, and the acquisitions are allowed from any state. */
const ALLOWED_FROM: Partial<Record<EntryType, readonly Progress[]>> = {
  want: ["curious"],
  start: ["curious", "backlog", "paused", "dropped"],
  again: ["done"],
  resume: ["paused"],
  pause: ["active"],
  finish: ["curious", "backlog", "active", "paused", "dropped"],
  drop: ["backlog", "active", "paused"],
};

/** The hint for a refused progress transition, judged against the state Neel is talking about. */
function progressHint(type: EntryType, progress: Progress): string {
  if (progress === "active") return "already active";
  if (progress === "done") {
    if (type === "want") return "already done; use update --priority to want it again";
    return type === "drop" ? "already done" : "already done; use again";
  }
  switch (type) {
    case "want":
      return progress === "paused" ? "already paused; use resume" : progress === "dropped" ? "already dropped; use start" : "already wanted; use start";
    case "again":
      return "not finished; use start";
    case "resume":
      return "not paused; use start";
    case "pause":
      return "not active";
    case "drop":
      return progress === "dropped" ? "already dropped" : "never wanted; use delete to dismiss";
    default:
      return `cannot ${type} a ${progress} title`;
  }
}

/**
 * Whether an entry of `type` may be appended to a title whose derived state is
 * `progress` and `ownership`. Applied on append only; `amend`, `unlog`, and
 * `relog` skip it and re-derive, so any corrected sequence is legal.
 */
export function allowed(type: EntryType, progress: Progress, ownership: Ownership): Allowed {
  if (type === "return") {
    return ownership === "none" ? { ok: false, issue: "return: ownership is none", hint: "nothing to return" } : { ok: true };
  }
  const from = ALLOWED_FROM[type];
  if (!from || from.includes(progress)) return { ok: true };
  return { ok: false, issue: `${type}: title is ${progress}`, hint: progressHint(type, progress) };
}

/**
 * The warning for an appended entry that is not last in diary order (a
 * backdated entry): names the derived state of its facet and the later entry
 * that decides it. Null when the entry is last, or when nothing after it
 * changes its facet's state.
 */
export function backdatedWarning(entries: Entry[], entryId: string): string | null {
  const ordered = orderEntries(entries);
  const index = ordered.findIndex((entry) => entry.id === entryId);
  if (index === -1 || index === ordered.length - 1) return null;
  const entry = ordered[index]!;
  const later = ordered.slice(index + 1);
  const decider = isOwnershipEntry(entry.type)
    ? later.filter((e) => isOwnershipEntry(e.type)).at(-1)
    : later.filter((e) => isProgressTransition(e.type)).at(-1);
  if (!decider || (!isOwnershipEntry(entry.type) && !isProgressTransition(entry.type))) return null;
  const state = isOwnershipEntry(entry.type) ? `ownership is ${deriveOwnership(entries).ownership}` : `status is ${deriveProgress(entries)}`;
  return `${entry.type} on ${formatOn(entry.on)} is not the latest entry: ${state}, decided by ${decider.type} on ${formatOn(decider.on)} (${decider.id})`;
}
