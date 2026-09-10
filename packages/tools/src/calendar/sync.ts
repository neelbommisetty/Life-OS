// The sync engine: reconciles an account's calendar list with the provider,
// then pulls each calendar's events page by page, full or incremental, and
// stores them as the provider's version. Every write goes through applyIn
// under actor import:<provider>, so a change made on the phone shows up in
// the log like any other mutation. refreshIfStale is what the views call
// first: it syncs whatever copy is older than the threshold and hands back
// what it refreshed and what failed, swallowing nothing.

import { eventId, isTimedWhen, type Account, type Calendar, type Ctx, type Event, type LogEntry } from "../contract.ts";
import { applyIn, bump, diff, fail, mutate, newId, nowIso, okMutation, type Clock } from "../core.ts";
import type { Store, Tx } from "../store.ts";
import { isValidTimezone, toInstant } from "../time.ts";
import { CursorExpired, type CalendarAdapter, type ProviderCalendar, type ProviderEvent, type SyncPage } from "./adapter.ts";
import { NeedsReauth } from "./google/oauth.ts";

export type SyncOutcome = "synced" | "unchanged" | "resynced" | "failed";
export type CalendarSyncReport = {
  calendarId: string;
  outcome: SyncOutcome;
  created: number;
  updated: number;
  deleted: number;
  error?: string;
};
export type SyncReport = { accountId: string; calendars: CalendarSyncReport[] };

/** The adapters a Tools instance was opened with, by provider. */
export type Adapters = Partial<Record<Account["provider"], CalendarAdapter>>;

export type SyncOptions = {
  /** Only these calendars' events; the calendar list is always reconciled. */
  calendarIds?: string[];
  /** Discard the stored cursors and list everything from `since` again. */
  full?: boolean;
  /** How far back a full sync reaches; defaults to LIFE_CAL_HISTORY_MONTHS, then 12. */
  historyMonths?: number;
};

export type RefreshResult = { refreshed: string[]; failed: { calendarId: string; error: string }[] };

export const DEFAULT_HISTORY_MONTHS = 12;

/** LIFE_CAL_HISTORY_MONTHS as a positive integer, or the default. */
export function historyMonthsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LIFE_CAL_HISTORY_MONTHS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_HISTORY_MONTHS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_HISTORY_MONTHS;
}

/** The instant `months` months before `now`: the lower bound of a full sync. */
export function historyStart(now: string, months: number): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return toInstant(date);
}

/** The ctx every sync write carries: the provider as the actor, nothing else. */
export function syncCtx(provider: Account["provider"]): Ctx {
  return { actor: `import:${provider}` };
}

const ERROR_MAX = 4000;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.length > ERROR_MAX ? message.slice(0, ERROR_MAX) : message;
}

function originOf(ctx: Ctx, now: string): Event["origin"] {
  return {
    actor: ctx.actor,
    at: now,
    ...(ctx.reason !== undefined ? { reason: ctx.reason } : {}),
    evidence: ctx.evidence ?? [],
  };
}

/** The fields a provider item carries into a row: everything but the sync-only markers. */
function providerFields(item: ProviderEvent): Omit<ProviderEvent, "providerMasterId" | "deleted" | "lifeId"> {
  const { providerMasterId: _master, deleted: _deleted, lifeId: _lifeId, ...fields } = item;
  return fields;
}

/** True when the row's start is after `since`: the instant for a timed row, the date for an all-day one. */
function startsAfter(event: Event, since: string): boolean {
  if (isTimedWhen(event.start)) return Date.parse(event.start.at) > Date.parse(since);
  return event.start.date > since.slice(0, 10);
}

/** Calendars ordered the way `calendar.list` shows them: by order, then id. */
function byOrder(a: Calendar, b: Calendar): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ------------------------------------------------------------------ the calendar list

/**
 * Fields Neel (or an agent on his behalf) set on a calendar: every key patched
 * by a log entry that is not a sync write. Sync never overwrites those.
 */
function fieldsSetByUs(history: LogEntry[]): Set<string> {
  const fields = new Set<string>();
  for (const entry of history) {
    if (entry.op.endsWith(".sync") || entry.actor.startsWith("import:")) continue;
    for (const field of Object.keys(entry.patch)) fields.add(field);
  }
  return fields;
}

/** The row for a provider calendar id: a live one first, else a deleted one to restore. */
function pickByExternal(calendars: Calendar[], externalId: string): Calendar | null {
  const matches = calendars.filter((calendar) => calendar.external.id === externalId);
  return matches.find((calendar) => calendar.deletedAt === null) ?? matches[0] ?? null;
}

/**
 * Reconcile the account's calendars with what the provider lists: add new
 * ones, update renamed or re-permissioned ones, soft-delete the ones no longer
 * listed along with their events. Returns a report entry per removed calendar.
 */
async function reconcileCalendars(store: Store, clock: Clock, ctx: Ctx, account: Account, listed: ProviderCalendar[]): Promise<CalendarSyncReport[]> {
  return store.transaction(async (tx) => {
    const all = (await tx.all("calendar", { includeDeleted: true })).filter((calendar) => calendar.accountId === account.id);
    let maxOrder = all.reduce((max, calendar) => Math.max(max, calendar.order), -1);
    const seen = new Set<string>();
    for (const provider of listed) {
      const existing = pickByExternal(all, provider.id);
      if (existing) seen.add(existing.id);
      await applyIn(tx, clock, "calendar", "calendar.sync", ctx, async (t, c, now) => {
        const name = provider.name.trim() || provider.id;
        const timezone = isValidTimezone(provider.timezone) ? provider.timezone : (existing?.timezone ?? clock.timezone);
        if (!existing) {
          const created: Calendar = {
            id: newId("calendar"),
            accountId: account.id,
            name,
            color: provider.color,
            timezone,
            labels: [],
            writable: provider.writable,
            hidden: provider.hidden,
            primaryOfAccount: provider.primary,
            order: ++maxOrder,
            external: { id: provider.id, syncToken: null },
            syncedAt: null,
            syncError: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          };
          return okMutation("created", null, created);
        }
        const ours = fieldsSetByUs(await t.history("calendar", existing.id));
        const after: Calendar = {
          ...existing,
          name,
          timezone,
          writable: provider.writable,
          primaryOfAccount: provider.primary,
          color: ours.has("color") ? existing.color : provider.color,
          hidden: ours.has("hidden") ? existing.hidden : provider.hidden,
          // A calendar that comes back after being unlisted starts over: its events were deleted with it.
          external: existing.deletedAt ? { ...existing.external, syncToken: null } : existing.external,
          deletedAt: null,
        };
        if (Object.keys(diff(existing, after)).length === 0) return okMutation("unchanged", existing, existing);
        return okMutation("updated", existing, bump(after, now));
      });
    }

    const removed: CalendarSyncReport[] = [];
    const gone = all.filter((calendar) => calendar.deletedAt === null && !seen.has(calendar.id));
    if (gone.length === 0) return removed;
    const events = await tx.all("event");
    for (const calendar of gone) {
      await applyIn(tx, clock, "calendar", "calendar.sync", ctx, async (_t, _c, now) =>
        okMutation("updated", calendar, bump({ ...calendar, deletedAt: now }, now)),
      );
      let deleted = 0;
      for (const event of events) {
        if (event.calendarId !== calendar.id) continue;
        const receipt = await applyIn(tx, clock, "event", "event.sync", ctx, async (_t, _c, now) =>
          okMutation("updated", event, bump({ ...event, deletedAt: now }, now)),
        );
        if (receipt.ok) deleted += 1;
      }
      removed.push({ calendarId: calendar.id, outcome: "synced", created: 0, updated: 0, deleted });
    }
    return removed;
  });
}

// ------------------------------------------------------------------ one calendar

/** The rows one page's transaction can match against, kept current as items are applied. */
class EventIndex {
  readonly calendarId: string;
  readonly #byExternal = new Map<string, Event>();
  readonly #inCalendar = new Map<string, Event>();
  readonly #children = new Map<string, Map<string, Event>>();

  constructor(calendarId: string, events: Event[]) {
    this.calendarId = calendarId;
    for (const event of events) this.put(event);
  }

  put(event: Event): void {
    if (event.masterId) {
      let siblings = this.#children.get(event.masterId);
      if (!siblings) this.#children.set(event.masterId, (siblings = new Map()));
      siblings.set(event.id, event);
    }
    if (event.calendarId !== this.calendarId) {
      this.#inCalendar.delete(event.id);
      return;
    }
    this.#inCalendar.set(event.id, event);
    const current = this.#byExternal.get(event.external.id);
    // A live row wins over a deleted one that shares the provider id.
    if (!current || current.id === event.id || current.deletedAt !== null || event.deletedAt === null) {
      this.#byExternal.set(event.external.id, event);
    }
  }

  byExternal(externalId: string): Event | null {
    return this.#byExternal.get(externalId) ?? null;
  }

  exceptionsOf(masterId: string): Event[] {
    return [...(this.#children.get(masterId)?.values() ?? [])];
  }

  live(): Event[] {
    return [...this.#inCalendar.values()].filter((event) => event.deletedAt === null);
  }
}

type ItemOutcome = "created" | "updated" | "deleted" | "unchanged" | "deferred" | "rejected";
type Tally = { created: number; updated: number; deleted: number; rejections: string[] };

/** A provider item's row: by our id when the provider carries it, else by provider id within the calendar. */
async function findRow(tx: Tx, index: EventIndex, item: ProviderEvent): Promise<Event | null> {
  if (item.lifeId && eventId.safeParse(item.lifeId).success) {
    const byLife = await tx.get("event", item.lifeId);
    if (byLife) return byLife;
  }
  return index.byExternal(item.external.id);
}

async function softDelete(tx: Tx, clock: Clock, ctx: Ctx, event: Event): Promise<Event | null> {
  const receipt = await applyIn(tx, clock, "event", "event.sync", ctx, async (_t, _c, now) =>
    okMutation("updated", event, bump({ ...event, deletedAt: now }, now)),
  );
  return receipt.ok ? receipt.record : null;
}

/**
 * Apply one provider item. `standalone` lets an exception row whose master
 * never arrived land as a plain event rather than be dropped.
 */
async function applyItem(
  tx: Tx,
  clock: Clock,
  ctx: Ctx,
  calendar: Calendar,
  item: ProviderEvent,
  index: EventIndex,
  mentioned: Set<string>,
  tally: Tally,
  standalone: boolean,
): Promise<ItemOutcome> {
  const row = await findRow(tx, index, item);

  if (item.deleted) {
    if (!row) return "unchanged"; // Never had it: nothing to delete, and a tombstone for a stranger helps nobody.
    mentioned.add(row.id);
    if (row.deletedAt !== null) return "unchanged";
    const deleted = await softDelete(tx, clock, ctx, row);
    if (!deleted) return "rejected";
    index.put(deleted);
    tally.deleted += 1;
    // A deleted master takes its exception rows with it; the link is masterId, so no rule check is needed.
    for (const exception of index.exceptionsOf(row.id)) {
      if (exception.deletedAt !== null) continue;
      const gone = await softDelete(tx, clock, ctx, exception);
      if (!gone) continue;
      index.put(gone);
      tally.deleted += 1;
    }
    return "deleted";
  }

  let masterId: string | null = null;
  if (item.providerMasterId) {
    const master = index.byExternal(item.providerMasterId);
    if (master) masterId = master.id;
    else if (!standalone) return "deferred";
  }

  const id = row?.id ?? (item.lifeId && eventId.safeParse(item.lifeId).success ? item.lifeId : newId("event"));
  mentioned.add(id);
  if (row && row.deletedAt === null && row.external.etag === item.external.etag) return "unchanged";

  const receipt = await applyIn(tx, clock, "event", "event.sync", ctx, async (_t, c, now) => {
    const fields = providerFields(item);
    const shape = { ...fields, masterId, originalStart: masterId ? fields.originalStart : null, calendarId: calendar.id, accountId: calendar.accountId, deletedAt: null };
    if (row) return okMutation("updated", row, bump({ ...row, ...shape }, now));
    const created: Event = { id, ...shape, origin: originOf(c, now), version: 1, createdAt: now, updatedAt: now };
    return okMutation("created", null, created);
  });
  if (!receipt.ok) {
    tally.rejections.push(`${item.external.id}: ${receipt.issues.join("; ")}`);
    return "rejected";
  }
  index.put(receipt.record);
  if (receipt.outcome === "created") tally.created += 1;
  else if (receipt.outcome === "updated") tally.updated += 1;
  return receipt.outcome;
}

type PageState = {
  since: string;
  /** This run started a full listing, so at the end anything unmentioned after `since` is gone. */
  prune: boolean;
  mentioned: Set<string>;
  /** Exception rows whose master has not arrived yet; retried with the last page. */
  orphans: ProviderEvent[];
  tally: Tally;
};

/** One page inside one transaction: the items, the orphans and pruning on the last page, then the cursor on the calendar. */
async function applyPage(tx: Tx, clock: Clock, ctx: Ctx, calendar: Calendar, page: SyncPage, state: PageState): Promise<void> {
  const index = new EventIndex(calendar.id, await tx.all("event", { includeDeleted: true }));
  // Masters and single events first, so an exception in the same page finds its master.
  const ordered = [...page.items.filter((item) => !item.providerMasterId), ...page.items.filter((item) => item.providerMasterId)];
  for (const item of ordered) {
    const outcome = await applyItem(tx, clock, ctx, calendar, item, index, state.mentioned, state.tally, false);
    if (outcome === "deferred") state.orphans.push(item);
  }
  if (page.done) {
    const orphans = state.orphans.splice(0);
    for (const item of orphans) await applyItem(tx, clock, ctx, calendar, item, index, state.mentioned, state.tally, true);
    if (state.prune) {
      for (const event of index.live()) {
        if (state.mentioned.has(event.id) || !startsAfter(event, state.since)) continue;
        const gone = await softDelete(tx, clock, ctx, event);
        if (!gone) continue;
        index.put(gone);
        state.tally.deleted += 1;
      }
    }
  }
  await applyIn(tx, clock, "calendar", "calendar.sync", ctx, async (t, _c, now) => {
    const current = await t.get("calendar", calendar.id);
    if (!current) return fail([`calendar: ${calendar.id} disappeared during sync`]);
    const after: Calendar = {
      ...current,
      external: { ...current.external, syncToken: page.nextCursor },
      ...(page.done ? { syncedAt: now, syncError: null } : {}),
    };
    if (Object.keys(diff(current, after)).length === 0) return okMutation("unchanged", current, current);
    return okMutation("updated", current, bump(after, now));
  });
}

/** Record a calendar's failure on its row, so the views can report it until a sync succeeds. */
async function recordFailure(store: Store, clock: Clock, ctx: Ctx, calendarId: string, message: string): Promise<void> {
  await mutate(store, clock, "calendar", "calendar.sync", ctx, async (tx, _c, now) => {
    const current = await tx.get("calendar", calendarId);
    if (!current) return fail([`calendar: ${calendarId} not found`]);
    if (current.syncError === message) return okMutation("unchanged", current, current);
    return okMutation("updated", current, bump({ ...current, syncError: message }, now));
  });
}

function failed(calendarId: string, error: string): CalendarSyncReport {
  return { calendarId, outcome: "failed", created: 0, updated: 0, deleted: 0, error };
}

/**
 * The provider no longer accepts the account's credential (a 401 after one
 * refresh attempt, or no credential on file): mark the account so the views
 * say so and refreshIfStale stops trying, until `life account add` reconnects it.
 */
async function markNeedsReauth(store: Store, clock: Clock, ctx: Ctx, accountId: string): Promise<void> {
  await mutate(store, clock, "account", "account.sync", ctx, async (tx, _c, now) => {
    const current = await tx.get("account", accountId);
    if (!current) return fail([`account: ${accountId} not found`]);
    if (current.status === "needs_reauth") return okMutation("unchanged", current, current);
    return okMutation("updated", current, bump({ ...current, status: "needs_reauth" }, now));
  });
}

/**
 * Pull one calendar: pages from the stored cursor (or from `since` when there
 * is none or `full` was asked), each page in its own transaction. An expired
 * cursor starts a full listing over, after which rows the listing did not
 * mention and that start after `since` are soft-deleted. Any failure lands on
 * the calendar's `syncError` and in the report; nothing is thrown.
 */
async function syncCalendar(store: Store, clock: Clock, adapter: CalendarAdapter, ctx: Ctx, calendar: Calendar, opts: { full: boolean; since: string }): Promise<CalendarSyncReport> {
  let cursor = opts.full ? null : calendar.external.syncToken;
  const state: PageState = { since: opts.since, prune: cursor === null, mentioned: new Set(), orphans: [], tally: { created: 0, updated: 0, deleted: 0, rejections: [] } };
  let resynced = false;
  try {
    for (;;) {
      let page: SyncPage;
      try {
        page = await adapter.syncPage(calendar.accountId, calendar.external.id, cursor, opts.since);
      } catch (error) {
        if (error instanceof CursorExpired && cursor !== null) {
          cursor = null;
          resynced = true;
          state.prune = true;
          state.mentioned.clear();
          state.orphans.length = 0;
          continue;
        }
        throw error;
      }
      await store.transaction((tx) => applyPage(tx, clock, ctx, calendar, page, state));
      if (page.done) break;
      if (page.nextCursor === null) throw new Error("The provider returned a page that is not done and no cursor to continue from");
      cursor = page.nextCursor;
    }
  } catch (error) {
    const message = errorMessage(error);
    await recordFailure(store, clock, ctx, calendar.id, message);
    if (error instanceof NeedsReauth) await markNeedsReauth(store, clock, ctx, calendar.accountId);
    return { calendarId: calendar.id, outcome: "failed", created: state.tally.created, updated: state.tally.updated, deleted: state.tally.deleted, error: message };
  }
  const { created, updated, deleted, rejections } = state.tally;
  const outcome: SyncOutcome = resynced ? "resynced" : created + updated + deleted > 0 ? "synced" : "unchanged";
  const report: CalendarSyncReport = { calendarId: calendar.id, outcome, created, updated, deleted };
  if (rejections.length > 0) report.error = `${rejections.length} item${rejections.length === 1 ? "" : "s"} could not be stored: ${rejections.join(" | ")}`.slice(0, ERROR_MAX);
  return report;
}

/** The account's live calendars to pull, all of them or the ones named, in list order. */
async function targetCalendars(store: Store, accountId: string, calendarIds?: string[]): Promise<Calendar[]> {
  const wanted = calendarIds ? new Set(calendarIds) : null;
  const calendars = await store.read((tx) => tx.all("calendar"));
  return calendars.filter((calendar) => calendar.accountId === accountId && (wanted === null || wanted.has(calendar.id))).sort(byOrder);
}

// ------------------------------------------------------------------ the entry points

/**
 * Sync one account: the calendar list first, then every live calendar (or the
 * ones named). Failures are per calendar and never thrown; a missing account
 * is the one thing that throws, since there is nothing to report against.
 */
export async function syncAccount(store: Store, clock: Clock, adapter: CalendarAdapter, accountId: string, opts: SyncOptions = {}): Promise<SyncReport> {
  const account = await store.read((tx) => tx.get("account", accountId));
  if (!account || account.deletedAt !== null) throw new Error(`syncAccount: no account ${accountId}`);
  const ctx = syncCtx(adapter.provider);
  const since = historyStart(nowIso(clock), opts.historyMonths ?? historyMonthsFromEnv());

  let listed: ProviderCalendar[];
  try {
    listed = await adapter.listCalendars(accountId);
  } catch (error) {
    // Without the list nothing can be reconciled or pulled: every targeted calendar failed the same way.
    const message = errorMessage(error);
    const calendars: CalendarSyncReport[] = [];
    for (const calendar of await targetCalendars(store, accountId, opts.calendarIds)) {
      await recordFailure(store, clock, ctx, calendar.id, message);
      calendars.push(failed(calendar.id, message));
    }
    if (error instanceof NeedsReauth) await markNeedsReauth(store, clock, ctx, accountId);
    return { accountId, calendars };
  }

  const calendars = await reconcileCalendars(store, clock, ctx, account, listed);
  const targets = await targetCalendars(store, accountId, opts.calendarIds);
  for (const calendar of targets) {
    calendars.push(await syncCalendar(store, clock, adapter, ctx, calendar, { full: Boolean(opts.full), since }));
  }

  if (targets.length === 0 || calendars.some((report) => report.outcome !== "failed")) {
    await mutate(store, clock, "account", "account.sync", ctx, async (tx, _c, now) => {
      const current = await tx.get("account", accountId);
      if (!current) return fail([`account: ${accountId} not found`]);
      if (current.syncedAt === now) return okMutation("unchanged", current, current);
      return okMutation("updated", current, bump({ ...current, syncedAt: now }, now));
    });
  }
  return { accountId, calendars };
}

/** True when the copy is older than `maxAgeSeconds`, or was never synced. */
export function isStale(syncedAt: string | null, now: Date, maxAgeSeconds: number): boolean {
  if (syncedAt === null) return true;
  return (now.getTime() - Date.parse(syncedAt)) / 1000 > maxAgeSeconds;
}

/**
 * Sync every live calendar (or the ones named) of every connected account
 * whose copy is stale. Nothing is swallowed: each calendar that could not be
 * refreshed comes back in `failed` with its error, and so does an account
 * whose provider has no adapter.
 */
export async function refreshIfStale(store: Store, clock: Clock, adapters: Adapters, opts: { maxAgeSeconds: number; calendarIds?: string[] }): Promise<RefreshResult> {
  const wanted = opts.calendarIds ? new Set(opts.calendarIds) : null;
  const now = clock.now();
  const { accounts, calendars } = await store.read(async (tx) => ({ accounts: await tx.all("account"), calendars: await tx.all("calendar") }));
  const result: RefreshResult = { refreshed: [], failed: [] };
  for (const account of accounts) {
    if (account.status !== "connected") continue;
    const stale = calendars
      .filter((calendar) => calendar.accountId === account.id && (wanted === null || wanted.has(calendar.id)) && isStale(calendar.syncedAt, now, opts.maxAgeSeconds))
      .sort(byOrder);
    if (stale.length === 0) continue;
    const adapter = adapters[account.provider];
    if (!adapter) {
      for (const calendar of stale) result.failed.push({ calendarId: calendar.id, error: `No ${account.provider} adapter is configured` });
      continue;
    }
    const staleIds = stale.map((calendar) => calendar.id);
    try {
      const report = await syncAccount(store, clock, adapter, account.id, { calendarIds: staleIds });
      for (const entry of report.calendars) {
        if (!staleIds.includes(entry.calendarId)) continue;
        if (entry.outcome === "failed") result.failed.push({ calendarId: entry.calendarId, error: entry.error ?? "Sync failed" });
        else result.refreshed.push(entry.calendarId);
      }
    } catch (error) {
      const message = errorMessage(error);
      for (const id of staleIds) result.failed.push({ calendarId: id, error: message });
    }
  }
  return result;
}
