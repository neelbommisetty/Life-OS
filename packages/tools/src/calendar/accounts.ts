// Accounts and calendars: connecting a provider account (the OAuth flow, the
// credential file, the first sync), the primary flag, removing an account with
// everything under it, and the fields of a calendar that are ours (labels,
// hidden, colour, order). Every write goes through core.mutate / core.applyIn;
// the provider's view of a calendar is sync.ts's business, never overwritten
// here. Refs: an account by id, identity email, or label; a calendar by id,
// `<identity>/<name>`, or a name unique among non-deleted calendars.

import { z } from "zod";
import {
  accountId as accountIdSchema,
  accountUpdateSchema,
  calendarId as calendarIdSchema,
  calendarUpdateSchema,
  ctxSchema,
  issuesOf,
  provider as providerSchema,
  text as textSchema,
  type Account,
  type AccountUpdate,
  type Calendar,
  type CalendarUpdate,
  type Ctx,
  type Receipt,
} from "../contract.ts";
import { applyIn, bump, checkVersion, diff, fail, itemCtx, mutate, newId, okMutation, rejected, type Clock, type Mutation } from "../core.ts";
import { cascadeCtx, ensureLabels } from "../organize.ts";
import type { Kind, RecordOf, Store, Tx } from "../store.ts";
import { ProviderRejected, ProviderUnavailable, type CalendarAdapter } from "./adapter.ts";
import type { CredentialStore } from "./credentials.ts";
import { syncAccount, type Adapters, type SyncReport } from "./sync.ts";

// ------------------------------------------------------------------ types

/** What `account.add` takes: the provider, an optional label, and how to show the sign-in URL. */
export type AccountAddInput = {
  provider: Account["provider"];
  label?: string | null;
  /** Receives the consent URL; opening a browser is the caller's choice. */
  open: (url: string) => void;
  timeoutMs?: number;
};

/** `account.add`'s receipt: the account after its first sync, the sync report, and one warning per calendar that failed. */
export type AccountAddReceipt = Receipt<Account> & { sync?: SyncReport; warnings?: string[] };

export interface AccountOps {
  /** Run the provider's sign-in, create the account (primary when it is the first), adopt the credential, sync. */
  add(input: AccountAddInput, ctx: Ctx): Promise<AccountAddReceipt>;
  /** By id (deleted included; check `deletedAt`), identity email, or label. */
  get(ref: string): Promise<Account | null>;
  /** Non-deleted accounts, oldest first. */
  list(): Promise<Account[]>;
  update(ref: string, input: AccountUpdate, ctx: Ctx): Promise<Receipt<Account>>;
  /** Mark this account primary and clear the others, in one transaction: the target's receipt first, then one per account cleared. */
  primary(ref: string, ctx: Ctx): Promise<Receipt<Account>[]>;
  /** One account, or every connected one. Not a mutation in itself; its writes are the `*.sync` entries. Throws when `ref` names no account. */
  sync(ref?: string, opts?: { full?: boolean }): Promise<SyncReport[]>;
  /** Soft-delete the account, its calendars, and their events; delete the credential file. Rejected while primary with another account present. */
  remove(ref: string, ctx: Ctx): Promise<Receipt<Account>>;
}

export interface CalendarOps {
  /** By id (deleted included), `<identity>/<name>`, or a name unique among non-deleted calendars. */
  get(ref: string): Promise<Calendar | null>;
  /** Non-deleted calendars by account (oldest account first) then `order`; hidden ones only with `includeHidden`. */
  list(opts?: { includeHidden?: boolean }): Promise<Calendar[]>;
  /** Our fields only: labels (registered on demand), hidden, colour. */
  update(ref: string, input: CalendarUpdate, ctx: Ctx): Promise<Receipt<Calendar>>;
  /** Assign `order` 0..n-1 in the given sequence; every id must be a live calendar of one account. */
  reorder(ids: string[], ctx: Ctx): Promise<Receipt<Calendar>[]>;
  /** Sync that calendar only (the account's calendar list is reconciled on the way). Throws when `ref` names no calendar. */
  sync(ref: string): Promise<SyncReport>;
}

export type Accounts = { account: AccountOps; calendar: CalendarOps };

/** What this module needs from the credential files: adopting the sign-in's provisional file and deleting an account's. `CredentialStore` fits; tests inject one on a temp directory. */
export type CredentialFiles = Pick<CredentialStore, "rename" | "delete">;

export type AccountsDeps = { adapters: Adapters; credentials: CredentialFiles };

// ------------------------------------------------------------------ small helpers

const accountAddSchema = z.strictObject({
  provider: providerSchema,
  label: textSchema.nullable().optional(),
  open: z.custom<(url: string) => void>((value) => typeof value === "function", "Pass a function that receives the sign-in URL"),
  timeoutMs: z.number().int().positive().optional(),
});

const unique = (items: string[]): string[] => [...new Set(items)];
const byCreation = <T extends { createdAt: string; id: string }>(a: T, b: T): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const sameIdentity = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Accounts oldest first. `createdAt` has second resolution, so two accounts
 * connected in the same second (or under a fixed clock) tie; the seq of each
 * account's first log entry is its real insertion order and breaks the tie
 * before the id does, so the order never depends on a random draw.
 */
async function oldestFirst(tx: Tx, accounts: Account[]): Promise<Account[]> {
  const firstSeq = new Map<string, number>();
  for (const account of accounts) {
    const history = await tx.history("account", account.id);
    firstSeq.set(account.id, history[0]?.seq ?? Number.MAX_SAFE_INTEGER);
  }
  const seqOf = (account: Account): number => firstSeq.get(account.id) ?? Number.MAX_SAFE_INTEGER;
  return [...accounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || seqOf(a) - seqOf(b) || a.id.localeCompare(b.id));
}

type Bookkept = { id: string; version: number; updatedAt: string };

/** `updated` with a bump when anything outside version/updatedAt differs, else `unchanged`. */
function updatedOrUnchanged<T extends Bookkept>(before: T, next: T, now: string): Mutation<T> {
  return Object.keys(diff(before, next)).length ? okMutation("updated", before, bump(next, now)) : okMutation("unchanged", before, before);
}

type Lookup<T> = { ok: true; record: T } | { ok: false; issues: string[]; id?: string };
const failed = <T>(lookup: { issues: string[]; id?: string }): Mutation<T> => fail<T>(lookup.issues, lookup.id !== undefined ? { id: lookup.id } : {});
const rejectedLookup = <T>(lookup: { issues: string[]; id?: string }): Receipt<T> => rejected<T>(lookup.issues, lookup.id !== undefined ? { id: lookup.id } : {});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------ reference resolution

/**
 * An account by id, identity email (case-insensitive), or label (exact, then
 * case-insensitive). Identity and label only match non-deleted accounts; an id
 * matches a deleted one only with `includeDeleted`.
 */
export async function resolveAccount(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Account | null> {
  const value = ref.trim();
  if (!value) return null;
  if (accountIdSchema.safeParse(value).success) {
    const account = await tx.get("account", value);
    return account && (opts.includeDeleted || !account.deletedAt) ? account : null;
  }
  const accounts = (await tx.all("account")).sort(byCreation);
  const lowered = value.toLowerCase();
  return (
    accounts.find((account) => account.identity.toLowerCase() === lowered) ??
    accounts.find((account) => account.label === value) ??
    accounts.find((account) => account.label !== null && account.label.toLowerCase() === lowered) ??
    null
  );
}

type CalendarMatch = { calendar: Calendar | null; candidates: Calendar[] };

/** Exact-name matches, else case-insensitive ones. */
function byName(calendars: Calendar[], name: string): Calendar[] {
  const exact = calendars.filter((calendar) => calendar.name === name);
  if (exact.length) return exact;
  const lowered = name.toLowerCase();
  return calendars.filter((calendar) => calendar.name.toLowerCase() === lowered);
}

/**
 * A calendar by id, `<account ref>/<name>`, or a name. A name must be unique
 * among non-deleted calendars; when it is not, `candidates` lists the matches
 * and `calendar` is null. Names only match non-deleted calendars; an id
 * matches a deleted one only with `includeDeleted`.
 */
async function matchCalendar(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<CalendarMatch> {
  const value = ref.trim();
  if (!value) return { calendar: null, candidates: [] };
  if (calendarIdSchema.safeParse(value).success) {
    const calendar = await tx.get("calendar", value);
    return { calendar: calendar && (opts.includeDeleted || !calendar.deletedAt) ? calendar : null, candidates: [] };
  }
  const calendars = await tx.all("calendar");
  const slash = value.indexOf("/");
  if (slash > 0) {
    const account = await resolveAccount(tx, value.slice(0, slash));
    const name = value.slice(slash + 1).trim();
    if (account && name) {
      const matches = byName(
        calendars.filter((calendar) => calendar.accountId === account.id),
        name,
      );
      if (matches.length === 1) return { calendar: matches[0], candidates: [] };
      if (matches.length > 1) return { calendar: null, candidates: matches };
      // No calendar of that name in the account; fall through in case the whole ref is a name with a slash in it.
    }
  }
  const matches = byName(calendars, value);
  if (matches.length === 1) return { calendar: matches[0], candidates: [] };
  return { calendar: null, candidates: matches };
}

/** A calendar by id, `<identity>/<name>`, or unique name; null when nothing or more than one matches. */
export async function resolveCalendar(tx: Tx, ref: string, opts: { includeDeleted?: boolean } = {}): Promise<Calendar | null> {
  return (await matchCalendar(tx, ref, opts)).calendar;
}

async function liveAccount(tx: Tx, ref: string): Promise<Lookup<Account>> {
  const account = await resolveAccount(tx, ref, { includeDeleted: true });
  if (!account) return { ok: false, issues: [`account: no account "${ref}"; run life account list`] };
  if (account.deletedAt) return { ok: false, issues: [`account: account "${ref}" was removed; connect it again with life account add`], id: account.id };
  return { ok: true, record: account };
}

async function liveCalendar(tx: Tx, ref: string): Promise<Lookup<Calendar>> {
  const match = await matchCalendar(tx, ref, { includeDeleted: true });
  if (match.calendar) {
    if (match.calendar.deletedAt) return { ok: false, issues: [`calendar: calendar "${ref}" is deleted; a sync restores it when the provider lists it again`], id: match.calendar.id };
    return { ok: true, record: match.calendar };
  }
  if (match.candidates.length > 1) {
    const accounts = new Map((await tx.all("account")).map((account) => [account.id, account.identity]));
    const paths = match.candidates.map((calendar) => `${accounts.get(calendar.accountId) ?? calendar.accountId}/${calendar.name}`);
    return { ok: false, issues: [`calendar: "${ref}" names ${match.candidates.length} calendars (${paths.join(", ")}); use <identity>/<name> or the id`] };
  }
  return { ok: false, issues: [`calendar: no calendar "${ref}"; run life calendar list`] };
}

// ------------------------------------------------------------------ the operations

export function createAccounts(store: Store, clock: Clock, deps: AccountsDeps): Accounts {
  const { adapters, credentials } = deps;
  type Work<K extends Kind> = (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>;
  const write = <K extends Kind>(kind: K, op: string, ctx: unknown, work: Work<K>): Promise<Receipt<RecordOf<K>>> => mutate(store, clock, kind, op, ctx, work);

  /** The report for an account whose provider has no adapter: every live calendar failed the same way, nothing thrown, nothing hidden. */
  async function noAdapterReport(account: Account, calendarIds?: string[]): Promise<SyncReport> {
    const error = `No ${account.provider} adapter is configured`;
    const calendars = (await store.read((tx) => tx.all("calendar"))).filter(
      (calendar) => calendar.accountId === account.id && (calendarIds === undefined || calendarIds.includes(calendar.id)),
    );
    return { accountId: account.id, calendars: calendars.map((calendar) => ({ calendarId: calendar.id, outcome: "failed", created: 0, updated: 0, deleted: 0, error })) };
  }

  async function syncOne(account: Account, opts: { full?: boolean; calendarIds?: string[] }): Promise<SyncReport> {
    const adapter = adapters[account.provider];
    if (!adapter) return noAdapterReport(account, opts.calendarIds);
    return syncAccount(store, clock, adapter, account.id, opts);
  }

  // ---------------------------------------------------------------- accounts

  async function accountAdd(input: AccountAddInput, ctx: Ctx): Promise<AccountAddReceipt> {
    // Both are checked before the browser opens: a bad ctx or input must not cost a sign-in.
    const parsedCtx = ctxSchema.safeParse(ctx);
    if (!parsedCtx.success) return rejected<Account>(issuesOf(parsedCtx.error));
    const parsedInput = accountAddSchema.safeParse(input);
    if (!parsedInput.success) return rejected<Account>(issuesOf(parsedInput.error));
    const context = parsedCtx.data;
    const { provider, label, open, timeoutMs } = parsedInput.data;
    const adapter: CalendarAdapter | undefined = adapters[provider];
    if (!adapter) return rejected<Account>([`provider: no ${provider} adapter is configured`]);

    // A replayed key answers from the stored receipt; core does that inside mutate, so the sign-in is skipped here.
    if (context.key !== undefined) {
      const key = context.key;
      const stored = await store.read((tx) => tx.getReceipt(key));
      if (stored !== null) return write("account", "account.add", context, async () => fail([`key: "${key}" replay did not return the stored receipt`]));
    }

    let connected: { identity: string; scopes: string[]; credentialId: string };
    try {
      connected = await adapter.connect({ open, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    } catch (error) {
      if (error instanceof ProviderUnavailable) return rejected<Account>([`provider_unavailable: ${error.message}`]);
      if (error instanceof ProviderRejected) return rejected<Account>([`provider_rejected: ${error.message}`]);
      return rejected<Account>([`connect: ${errorMessage(error)}`]);
    }
    const { identity, scopes, credentialId } = connected;

    const receipt = await write("account", "account.add", context, async (tx, _c, now) => {
      const accounts = await tx.all("account");
      const existing = accounts.find((account) => account.provider === provider && sameIdentity(account.identity, identity));
      if (existing) return fail([`identity: ${identity} is already connected as ${existing.id}`], { id: existing.id, record: existing });
      const id = newId("account");
      // Every check has passed: the credential moves under the new id inside the transaction, so a rollback leaves no account without it.
      const adopted = await credentials.rename(credentialId, id);
      if (!adopted) return fail([`credential: the sign-in left no credential under "${credentialId}"; connect the account again`]);
      const account: Account = {
        id,
        provider,
        identity,
        label: label ?? null,
        primary: accounts.length === 0,
        status: "connected",
        scopes: unique(scopes),
        syncedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      return okMutation("created", null, account);
    });
    if (!receipt.ok) {
      // A refresh token nobody adopted must not stay on disk.
      await credentials.delete(credentialId).catch(() => false);
      return receipt;
    }
    if (receipt.outcome !== "created") return receipt;

    // The first sync opens its own transactions (one per page), so it runs once the account is committed, never inside its transaction.
    const sync = await syncAccount(store, clock, adapter, receipt.id);
    const after = await store.read(async (tx) => ({ account: await tx.get("account", receipt.id), calendars: await tx.all("calendar", { includeDeleted: true }) }));
    const nameOf = (calendarId: string): string => after.calendars.find((calendar) => calendar.id === calendarId)?.name ?? calendarId;
    const warnings = sync.calendars.filter((entry) => entry.error !== undefined).map((entry) => `${nameOf(entry.calendarId)}: ${entry.error}`);
    const record = after.account ?? receipt.record;
    return { ...receipt, record, version: record.version, sync, ...(warnings.length ? { warnings } : {}) };
  }

  async function accountUpdate(tx: Tx, ref: string, input: AccountUpdate, ctx: Ctx, now: string): Promise<Mutation<Account>> {
    const found = await liveAccount(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Account = { ...before };
    if (input.label !== undefined) next.label = input.label;
    return updatedOrUnchanged(before, next, now);
  }

  async function accountPrimary(ref: string, ctx: Ctx): Promise<Receipt<Account>[]> {
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) return [rejected(issuesOf(parsed.error))];
    const context = parsed.data;
    return store.transaction(async (tx) => {
      const found = await liveAccount(tx, ref);
      if (!found.ok) return [rejectedLookup<Account>(found)];
      const target = found.record;
      const receipts: Receipt<Account>[] = [];
      receipts.push(
        await applyIn(tx, clock, "account", "account.primary", itemCtx(context, 0), async (_t, c, now) => {
          const mismatch = checkVersion(target, c);
          if (mismatch) return mismatch;
          return target.primary ? okMutation("unchanged", target, target) : okMutation("updated", target, bump({ ...target, primary: true }, now));
        }),
      );
      if (!receipts[0].ok) return receipts;
      // The others are consequences: same actor, reason, evidence; a derived key each; no ifVersion, which guarded the target.
      const { ifVersion: _ifVersion, ...base } = context;
      const others = await oldestFirst(
        tx,
        (await tx.all("account")).filter((account) => account.id !== target.id && account.primary),
      );
      for (const [index, other] of others.entries()) {
        receipts.push(
          await applyIn(tx, clock, "account", "account.primary", itemCtx(base, index + 1), async (_t, _c, now) =>
            okMutation("updated", other, bump({ ...other, primary: false }, now)),
          ),
        );
      }
      return receipts;
    });
  }

  async function accountSync(ref?: string, opts: { full?: boolean } = {}): Promise<SyncReport[]> {
    let targets: Account[];
    if (ref !== undefined) {
      const account = await store.read((tx) => resolveAccount(tx, ref));
      if (!account) throw new Error(`account: no account "${ref}"; run life account list`);
      targets = [account];
    } else {
      targets = await store.read(async (tx) => oldestFirst(tx, (await tx.all("account")).filter((account) => account.status === "connected")));
    }
    const reports: SyncReport[] = [];
    for (const account of targets) reports.push(await syncOne(account, { full: Boolean(opts.full) }));
    return reports;
  }

  async function accountRemove(tx: Tx, ref: string, ctx: Ctx, now: string): Promise<Mutation<Account>> {
    const found = await liveAccount(tx, ref);
    if (!found.ok) return failed(found);
    const account = found.record;
    const mismatch = checkVersion(account, ctx);
    if (mismatch) return mismatch;
    const others = await oldestFirst(
      tx,
      (await tx.all("account")).filter((other) => other.id !== account.id),
    );
    if (account.primary && others.length) {
      return fail(
        [`primary: ${account.identity} is the primary account; make another one primary first (life account primary ${others[0].identity})`],
        { id: account.id, record: account },
      );
    }
    // Checked: the cascade comes last. A rejection below rolls it back (core.ts).
    const cascade = cascadeCtx(ctx);
    const events = (await tx.all("event")).filter((event) => event.accountId === account.id);
    for (const event of events) {
      const receipt = await applyIn(tx, clock, "event", "account.remove", cascade, async (_t, _c, at) => okMutation("updated", event, bump({ ...event, deletedAt: at }, at)));
      if (!receipt.ok) return fail(receipt.issues.map((issue) => `event ${event.id}: ${issue}`), { id: account.id });
    }
    const calendars = (await tx.all("calendar")).filter((calendar) => calendar.accountId === account.id);
    for (const calendar of calendars) {
      const receipt = await applyIn(tx, clock, "calendar", "account.remove", cascade, async (_t, _c, at) => okMutation("updated", calendar, bump({ ...calendar, deletedAt: at }, at)));
      if (!receipt.ok) return fail(receipt.issues.map((issue) => `calendar ${calendar.id}: ${issue}`), { id: account.id });
    }
    return okMutation("updated", account, bump({ ...account, status: "disconnected", deletedAt: now }, now));
  }

  const account: AccountOps = {
    add: (input, ctx) => accountAdd(input, ctx),
    get: (ref) => store.read((tx) => resolveAccount(tx, ref, { includeDeleted: true })),
    list: () => store.read(async (tx) => oldestFirst(tx, await tx.all("account"))),
    update: (ref, input, ctx) => {
      const parsed = accountUpdateSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(rejected(issuesOf(parsed.error)));
      return write("account", "account.update", ctx, (tx, c, now) => accountUpdate(tx, ref, parsed.data, c, now));
    },
    primary: (ref, ctx) => accountPrimary(ref, ctx),
    sync: (ref, opts) => accountSync(ref, opts),
    remove: async (ref, ctx) => {
      const receipt = await write("account", "account.remove", ctx, (tx, c, now) => accountRemove(tx, ref, c, now));
      // The file goes only once the removal is committed; a rejected remove keeps the token for the account that still exists.
      if (receipt.ok && receipt.outcome === "updated") await credentials.delete(receipt.id);
      return receipt;
    },
  };

  // ---------------------------------------------------------------- calendars

  async function calendarList(opts: { includeHidden?: boolean } = {}): Promise<Calendar[]> {
    const { accounts, calendars } = await store.read(async (tx) => ({ accounts: await oldestFirst(tx, await tx.all("account")), calendars: await tx.all("calendar") }));
    const rank = new Map(accounts.map((account, index) => [account.id, index]));
    const rankOf = (calendar: Calendar): number => rank.get(calendar.accountId) ?? Number.MAX_SAFE_INTEGER;
    return calendars
      .filter((calendar) => opts.includeHidden || !calendar.hidden)
      .sort((a, b) => rankOf(a) - rankOf(b) || a.accountId.localeCompare(b.accountId) || a.order - b.order || a.id.localeCompare(b.id));
  }

  async function calendarUpdate(tx: Tx, ref: string, input: CalendarUpdate, ctx: Ctx, now: string): Promise<Mutation<Calendar>> {
    const found = await liveCalendar(tx, ref);
    if (!found.ok) return failed(found);
    const before = found.record;
    const mismatch = checkVersion(before, ctx);
    if (mismatch) return mismatch;
    const next: Calendar = { ...before };
    if (input.hidden !== undefined) next.hidden = input.hidden;
    if (input.color !== undefined) next.color = input.color;
    // Checked; registering labels is the one write this update cascades, so it comes last.
    if (input.labels !== undefined) {
      const labels = unique(input.labels);
      const ensured = await ensureLabels(tx, clock, ctx, labels);
      if (ensured.issues.length) return fail(ensured.issues, { id: before.id });
      next.labels = labels;
    }
    return updatedOrUnchanged(before, next, now);
  }

  /** Assign order 0..n-1 to `ids` in one transaction; every id must be a live calendar and all must share one account. */
  async function calendarReorder(ids: string[], ctx: Ctx): Promise<Receipt<Calendar>[]> {
    const parsed = ctxSchema.safeParse(ctx);
    if (!parsed.success) return ids.map(() => rejected(issuesOf(parsed.error)));
    const context = parsed.data;
    if (context.ifVersion !== undefined) return ids.map(() => rejected(["ifVersion: not supported by reorder"]));
    if (!ids.length) return [];
    if (new Set(ids).size !== ids.length) return ids.map(() => rejected(["ids: contains duplicates"]));
    return store.transaction(async (tx) => {
      const records: Calendar[] = [];
      const issues: string[] = [];
      for (const id of ids) {
        const record = calendarIdSchema.safeParse(id).success ? await tx.get("calendar", id) : null;
        if (!record) issues.push(`${id}: no calendar`);
        else if (record.deletedAt) issues.push(`${id}: calendar is deleted`);
        else records.push(record);
      }
      if (!issues.length && new Set(records.map((record) => record.accountId)).size > 1) issues.push("ids: every calendar must share the same account");
      if (issues.length) return ids.map(() => rejected(issues));
      const receipts: Receipt<Calendar>[] = [];
      for (const [index, record] of records.entries()) {
        receipts.push(
          await applyIn(tx, clock, "calendar", "calendar.reorder", itemCtx(context, index), async (_tx, _ctx, now) =>
            record.order === index ? okMutation("unchanged", record, record) : okMutation("updated", record, bump({ ...record, order: index }, now)),
          ),
        );
      }
      return receipts;
    });
  }

  async function calendarSync(ref: string): Promise<SyncReport> {
    const found = await store.read(async (tx) => {
      const lookup = await liveCalendar(tx, ref);
      if (!lookup.ok) return lookup;
      const owner = await tx.get("account", lookup.record.accountId);
      return { ok: true as const, record: lookup.record, owner };
    });
    if (!found.ok) throw new Error(found.issues.join("; "));
    if (!found.owner || found.owner.deletedAt) throw new Error(`account: calendar "${ref}" belongs to a removed account`);
    return syncOne(found.owner, { calendarIds: [found.record.id] });
  }

  const calendar: CalendarOps = {
    get: (ref) => store.read((tx) => resolveCalendar(tx, ref, { includeDeleted: true })),
    list: (opts) => calendarList(opts),
    update: (ref, input, ctx) => {
      const parsed = calendarUpdateSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(rejected(issuesOf(parsed.error)));
      return write("calendar", "calendar.update", ctx, (tx, c, now) => calendarUpdate(tx, ref, parsed.data, c, now));
    },
    reorder: (ids, ctx) => calendarReorder(ids, ctx),
    sync: (ref) => calendarSync(ref),
  };

  return { account, calendar };
}
