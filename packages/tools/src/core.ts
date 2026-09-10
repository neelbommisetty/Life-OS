// Every mutation goes through here: validate the context, honor the
// idempotency key, run the operation's work inside a write transaction,
// validate what it produced, persist it, log the diff, store the receipt.
// No other module writes a record or a log entry.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ID_PREFIXES,
  accountSchema,
  calendarSchema,
  ctxSchema,
  eventSchema,
  filterSchema,
  issuesOf,
  labelSchema,
  projectSchema,
  sectionSchema,
  taskSchema,
  type Ctx,
  type Needs,
  type Receipt,
} from "./contract.ts";
import { toInstant } from "./time.ts";
import type { Kind, RecordOf, Store, Tx } from "./store.ts";

export type Clock = { now(): Date; timezone: string };
export type Mutation<T> = { before: T | null; after: T | null; receipt: Receipt<T> };

/**
 * Separates a caller's idempotency key from an item index in multi-record
 * operations: U+001F, the unit separator. A control character, which
 * ctxSchema keeps out of caller keys, so a derived key can never collide with
 * one a caller passes.
 */
export const ITEM_KEY_SEPARATOR = String.fromCodePoint(0x1f);

/** The ctx for item `index` of a multi-record operation (batch, reorder, import): the caller's key plus the index, so each item replays on its own. */
export function itemCtx(ctx: Ctx, index: number): Ctx {
  return ctx.key === undefined ? ctx : { ...ctx, key: `${ctx.key}${ITEM_KEY_SEPARATOR}${index}` };
}

/**
 * Thrown when work came back rejected after a nested applyIn had already
 * written (a cascade ran before a check failed). The transaction rolls back
 * and `mutate` hands the receipt out once it has, so a rejection never
 * commits what its cascades wrote.
 */
export class RejectedAfterWrites extends Error {
  readonly receipt: Receipt<unknown>;

  constructor(receipt: Receipt<unknown>) {
    super(`rejected after a cascade wrote: ${receipt.issues.join("; ")}`);
    this.receipt = receipt;
  }
}

/**
 * What applyIn accepts: ctxSchema, except that the key may be one itemCtx
 * derived, whose separator ctxSchema refuses from callers. The caller's key
 * was bounded when mutate, batch, reorder, or import validated it.
 */
const appliedCtxSchema = ctxSchema.extend({ key: z.string().min(1).optional() });

/** Writes applyIn made per transaction, so an outer mutation can tell whether a cascade wrote before its own check failed. */
const writesByTx = new WeakMap<Tx, number>();
const writesIn = (tx: Tx): number => writesByTx.get(tx) ?? 0;

/** What the receipts table holds under a key: the receipt plus the kind and op it answers, so a key reused for another operation is caught instead of replayed. */
type StoredReceipt = { kind: Kind; op: string; receipt: unknown };

function isStoredReceipt(value: unknown): value is StoredReceipt {
  return isPlainObject(value) && typeof value.kind === "string" && typeof value.op === "string" && "receipt" in value;
}

const SCHEMAS = {
  task: taskSchema,
  project: projectSchema,
  section: sectionSchema,
  label: labelSchema,
  filter: filterSchema,
  account: accountSchema,
  calendar: calendarSchema,
  event: eventSchema,
} as const;

/** Fields the diff ignores: bookkeeping that every mutation touches. */
const DIFF_IGNORED = new Set(["version", "updatedAt"]);

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;

/** A new id: the kind's prefix, an underscore, ten random [a-z0-9] characters. */
export function newId(kind: Kind): string {
  let suffix = "";
  while (suffix.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH * 2)) {
      // Reject bytes past the largest multiple of 36 so every character is equally likely.
      if (byte >= 252) continue;
      suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (suffix.length === ID_LENGTH) break;
    }
  }
  return `${ID_PREFIXES[kind]}_${suffix}`;
}

/** The clock's instant as "YYYY-MM-DDTHH:MM:SSZ". */
export function nowIso(clock: Clock): string {
  return toInstant(clock.now());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality where an undefined property and a missing one are the same thing. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => same(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (!same(a[key], b[key])) return false;
    return true;
  }
  return false;
}

/**
 * Field-by-field changes from `before` to `after`, ignoring version and
 * updatedAt. Absent reads as null, so a field that is null or missing on both
 * sides is not a change: a create entry lists what the record holds, not every
 * nullable field it does not.
 */
export function diff(before: object | null, after: object): Record<string, { from: unknown; to: unknown }> {
  const from = (before ?? {}) as Record<string, unknown>;
  const to = after as Record<string, unknown>;
  const patch: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (DIFF_IGNORED.has(key)) continue;
    const was = from[key] ?? null;
    const is = to[key] ?? null;
    if (same(was, is)) continue;
    patch[key] = { from: was, to: is };
  }
  return patch;
}

export function bump<T extends { version: number; updatedAt: string }>(record: T, now: string): T {
  return { ...record, version: record.version + 1, updatedAt: now };
}

export function rejected<T>(issues: string[], extra: { id?: string; record?: T; needs?: Needs } = {}): Receipt<T> {
  return {
    ok: false,
    outcome: "rejected",
    issues,
    ...(extra.id !== undefined ? { id: extra.id } : {}),
    ...(extra.record !== undefined ? { record: extra.record } : {}),
    ...(extra.needs !== undefined ? { needs: extra.needs } : {}),
  };
}

export function fail<T>(issues: string[], extra?: { id?: string; record?: T; needs?: Needs }): Mutation<T> {
  return { before: null, after: null, receipt: rejected(issues, extra) };
}

/** A duplicate-check outcome: nothing is written; the caller sees the candidates. */
export function duplicate<T>(candidates: T[], issues: string[] = ["Similar open tasks exist; pass allowDuplicate to add anyway"]): Mutation<T> {
  return { before: null, after: null, receipt: { ok: false, outcome: "duplicate", candidates, issues } };
}

export function okMutation<T extends { id: string; version: number }>(
  outcome: "created" | "updated" | "unchanged",
  before: T | null,
  after: T,
): Mutation<T> {
  return {
    before,
    after,
    receipt: { ok: true, outcome, id: after.id, version: after.version, record: after, issues: [] },
  };
}

/** Optimistic concurrency: a mismatch between ctx.ifVersion and the record is rejected with the current record. */
export function checkVersion<T extends { id: string; version: number }>(record: T, ctx: Ctx): Mutation<T> | null {
  if (ctx.ifVersion === undefined || ctx.ifVersion === record.version) return null;
  return fail([`version: expected ${ctx.ifVersion}, current is ${record.version}`], { id: record.id, record });
}

function validateRecord<K extends Kind>(kind: K, record: unknown): { ok: true; record: RecordOf<K> } | { ok: false; issues: string[] } {
  const result = SCHEMAS[kind].safeParse(record);
  if (result.success) return { ok: true, record: result.data as RecordOf<K> };
  return { ok: false, issues: issuesOf(result.error) };
}

/**
 * Validate ctx, open a write transaction, run `work`, validate the resulting
 * record against its schema, persist, log, store the receipt under the
 * idempotency key. A rejection that came after a cascade wrote rolls the
 * transaction back and is returned as the rejected receipt.
 */
export async function mutate<K extends Kind>(
  store: Store,
  clock: Clock,
  kind: K,
  op: string,
  ctx: unknown,
  work: (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>,
): Promise<Receipt<RecordOf<K>>> {
  const parsed = ctxSchema.safeParse(ctx);
  if (!parsed.success) return rejected(issuesOf(parsed.error));
  try {
    return await store.transaction((tx) => applyIn(tx, clock, kind, op, parsed.data, work));
  } catch (error) {
    if (error instanceof RejectedAfterWrites) return error.receipt as Receipt<RecordOf<K>>;
    throw error;
  }
}

/** The same inside an already-open transaction, for batch and import. */
export async function applyIn<K extends Kind>(
  tx: Tx,
  clock: Clock,
  kind: K,
  op: string,
  ctx: Ctx,
  work: (tx: Tx, ctx: Ctx, now: string) => Promise<Mutation<RecordOf<K>>>,
): Promise<Receipt<RecordOf<K>>> {
  const parsedCtx = appliedCtxSchema.safeParse(ctx);
  if (!parsedCtx.success) return rejected(issuesOf(parsedCtx.error));
  const context = parsedCtx.data;

  if (context.key !== undefined) {
    const stored = await tx.getReceipt(context.key);
    if (stored !== null) {
      // A receipt stored before kind and op were recorded replays as it is.
      if (!isStoredReceipt(stored)) return stored as Receipt<RecordOf<K>>;
      if (stored.kind !== kind || stored.op !== op) return rejected([`key: "${context.key}" was already used by ${stored.op}`]);
      return stored.receipt as Receipt<RecordOf<K>>;
    }
  }

  const now = nowIso(clock);
  const writesBefore = writesIn(tx);
  const mutation = await work(tx, context, now);
  /** A rejection after a cascade wrote must not commit the cascade: abort the transaction instead of returning. */
  const refuse = (receipt: Receipt<RecordOf<K>>): Receipt<RecordOf<K>> => {
    if (writesIn(tx) > writesBefore) throw new RejectedAfterWrites(receipt);
    return receipt;
  };
  if (!mutation.receipt.ok) return refuse(mutation.receipt);
  if (mutation.receipt.outcome === "unchanged") return mutation.receipt;
  if (mutation.after === null) return refuse(rejected([`${op}: internal error, an ok mutation produced no record`]));

  const validated = validateRecord(kind, mutation.after);
  if (!validated.ok) return refuse(rejected(validated.issues, { id: mutation.after.id }));
  const record = validated.record;

  await tx.put(kind, record);
  await tx.appendLog({
    at: now,
    actor: context.actor,
    op,
    recordKind: kind,
    recordId: record.id,
    patch: diff(mutation.before, record),
    reason: context.reason ?? null,
    evidence: context.evidence ?? [],
    key: context.key ?? null,
  });
  writesByTx.set(tx, writesIn(tx) + 1);

  const receipt: Receipt<RecordOf<K>> = {
    ok: true,
    outcome: mutation.receipt.outcome,
    id: record.id,
    version: record.version,
    record,
    issues: [],
  };
  if (context.key !== undefined) {
    const stored: StoredReceipt = { kind, op, receipt };
    await tx.putReceipt(context.key, stored, now);
  }
  return receipt;
}
