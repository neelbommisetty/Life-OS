import { test } from "node:test";
import assert from "node:assert/strict";
import { issuesOf, titleSchema, type Entry, type EntryType, type On, type Ownership, type Progress, type Title } from "../contract.ts";
import { parseOn } from "./on.ts";
import {
  allowed,
  backdatedWarning,
  cycles,
  derive,
  deriveOwnership,
  deriveProgress,
  deriveTake,
  finalize,
  lastEntry,
  orderEntries,
} from "./derive.ts";

const on = (text: string): On => {
  const result = parseOn(text);
  if (!result.ok) throw new Error(result.error);
  return result.on;
};

let counter = 0;
/** An entry of `type` on `when` (a date form), recorded a minute after the previous one unless `at` is given. */
function entry(type: EntryType, when = "2026-09-07", overrides: Partial<Entry> = {}): Entry {
  counter += 1;
  const minute = String(counter % 60).padStart(2, "0");
  const hour = String(Math.floor(counter / 60) % 24).padStart(2, "0");
  return {
    id: `n_${String(counter).padStart(10, "0")}`,
    type,
    on: on(when),
    at: `2026-09-12T${hour}:${minute}:00Z`,
    actor: "neel",
    text: type === "drop" ? "not for me" : null,
    progress: null,
    format: null,
    rating: null,
    minutes: null,
    spend: null,
    where: null,
    evidence: [],
    ...overrides,
  };
}

const types = (entries: Entry[]): string[] => entries.map((e) => e.type);

function title(entries: Entry[], overrides: Partial<Title> = {}): Title {
  const now = "2026-09-12T12:00:00Z";
  return finalize({
    id: "m_abcdefghij",
    medium: "book",
    name: "Skyward",
    aliases: [],
    year: 2018,
    creators: ["Brandon Sanderson"],
    cover: null,
    length: null,
    facts: null,
    catalog: null,
    edited: [],
    series: null,
    status: "curious",
    ownership: "none",
    ownershipDetail: null,
    priority: null,
    moodFit: [],
    timeFit: null,
    notes: null,
    detail: { format: null, platform: null, where: null },
    rating: null,
    review: null,
    liked: false,
    entries,
    origin: { actor: "neel", at: now, evidence: [] },
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  });
}

// ------------------------------------------------------------------ the lifecycle diagram

/** Every arrow in the LEISURE lifecycle diagram plus the tolerant ones the rule allows: from, type, to. */
const ARROWS: [Progress, EntryType, Progress][] = [
  ["curious", "want", "backlog"],
  ["backlog", "start", "active"],
  ["active", "finish", "done"],
  ["active", "pause", "paused"],
  ["paused", "resume", "active"],
  ["done", "again", "active"],
  ["curious", "start", "active"],
  ["backlog", "drop", "dropped"],
  ["active", "drop", "dropped"],
  ["paused", "drop", "dropped"],
  ["dropped", "start", "active"],
  ["paused", "start", "active"],
  ["curious", "finish", "done"],
  ["backlog", "finish", "done"],
  ["paused", "finish", "done"],
  ["dropped", "finish", "done"],
];

/** The shortest diary that leaves a title in `state`. */
const REACH: Record<Progress, EntryType[]> = {
  curious: [],
  backlog: ["want"],
  active: ["start"],
  paused: ["start", "pause"],
  done: ["finish"],
  dropped: ["want", "drop"],
};

const diary = (steps: EntryType[]): Entry[] => steps.map((type, index) => entry(type, `2026-09-${String(index + 1).padStart(2, "0")}`));

test("every arrow in the lifecycle diagram is allowed from its source and lands on its target", () => {
  for (const [from, type, to] of ARROWS) {
    const before = diary(REACH[from]);
    assert.equal(deriveProgress(before), from, `reach ${from}`);
    assert.deepEqual(allowed(type, from, "none"), { ok: true }, `${from} --${type}-->`);
    const after = [...before, entry(type, "2026-09-20")];
    assert.equal(deriveProgress(after), to, `${from} --${type}--> ${to}`);
  }
});

test("the allowed table: each transition's states and every refusal's hint", () => {
  const states: Progress[] = ["curious", "backlog", "active", "paused", "done", "dropped"];
  const ok: Record<EntryType, Progress[]> = {
    want: ["curious"],
    start: ["curious", "backlog", "paused", "dropped"],
    again: ["done"],
    resume: ["paused"],
    pause: ["active"],
    finish: ["curious", "backlog", "active", "paused", "dropped"],
    drop: ["backlog", "active", "paused"],
    progress: states,
    note: states,
    buy: states,
    borrow: states,
    service: states,
    return: states,
  };
  for (const type of Object.keys(ok) as EntryType[]) {
    for (const state of states) {
      const result = allowed(type, state, "owned");
      assert.equal(result.ok, ok[type].includes(state), `${type} from ${state}`);
      if (!result.ok) {
        assert.match(result.issue, new RegExp(`^${type}: title is ${state}$`));
        assert.equal(result.hint.length > 0, true);
      }
    }
  }
  const hint = (type: EntryType, state: Progress, ownership: Ownership = "none") => {
    const result = allowed(type, state, ownership);
    return result.ok ? "(ok)" : result.hint;
  };
  assert.equal(hint("want", "backlog"), "already wanted; use start");
  assert.equal(hint("want", "active"), "already active");
  assert.equal(hint("want", "done"), "already done; use update --priority to want it again");
  assert.equal(hint("start", "active"), "already active");
  assert.equal(hint("start", "done"), "already done; use again");
  assert.equal(hint("again", "active"), "already active");
  assert.equal(hint("again", "backlog"), "not finished; use start");
  assert.equal(hint("again", "curious"), "not finished; use start");
  assert.equal(hint("resume", "backlog"), "not paused; use start");
  assert.equal(hint("resume", "active"), "already active");
  assert.equal(hint("resume", "done"), "already done; use again");
  assert.equal(hint("pause", "backlog"), "not active");
  assert.equal(hint("pause", "done"), "already done; use again");
  assert.equal(hint("finish", "done"), "already done; use again");
  assert.equal(hint("drop", "dropped"), "already dropped");
  assert.equal(hint("drop", "curious"), "never wanted; use delete to dismiss");
  assert.equal(hint("drop", "done"), "already done");
});

test("return is judged on ownership: owned, borrowed, or service, never none", () => {
  for (const state of ["curious", "active", "done"] as Progress[]) {
    assert.deepEqual(allowed("return", state, "owned"), { ok: true });
    assert.deepEqual(allowed("return", state, "borrowed"), { ok: true });
    assert.deepEqual(allowed("return", state, "service"), { ok: true });
    assert.deepEqual(allowed("return", state, "none"), { ok: false, issue: "return: ownership is none", hint: "nothing to return" });
  }
  const owned = [entry("buy", "2026-09-01", { where: "Kindle store" })];
  assert.equal(deriveOwnership(owned).ownership, "owned");
  const returned = [...owned, entry("return", "2026-09-05")];
  assert.deepEqual(deriveOwnership(returned), { ownership: "none", detail: null });
});

// ------------------------------------------------------------------ sequences

test("add --finished alone is a done title and a cycle of one", () => {
  const entries = [entry("finish", "2026-09-11", { rating: 4.5, text: "great" })];
  assert.equal(deriveProgress(entries), "done");
  const cut = cycles(entries);
  assert.equal(cut.length, 1);
  assert.equal(cut[0]!.opened, null);
  assert.equal(cut[0]!.closed, entries[0]);
  assert.deepEqual(types(cut[0]!.entries), ["finish"]);
  assert.deepEqual(deriveTake(entries), { rating: 4.5, review: "great" });
});

test("again on a done title opens a second cycle; finish after finish is refused", () => {
  const first = [entry("start", "2026-08-01"), entry("finish", "2026-08-20", { rating: 4 })];
  assert.equal(deriveProgress(first), "done");
  assert.deepEqual(allowed("finish", deriveProgress(first), "none"), { ok: false, issue: "finish: title is done", hint: "already done; use again" });
  assert.deepEqual(allowed("again", "done", "none"), { ok: true });
  const rewatch = [...first, entry("again", "2026-09-10")];
  assert.equal(deriveProgress(rewatch), "active");
  const done = [...rewatch, entry("finish", "2026-09-10", { rating: 5 })];
  assert.equal(deriveProgress(done), "done");
  const cut = cycles(done);
  assert.equal(cut.length, 2);
  assert.deepEqual(types(cut[0]!.entries), ["start", "finish"]);
  assert.deepEqual(types(cut[1]!.entries), ["again", "finish"]);
  assert.equal(deriveTake(done).rating, 5, "the latest cycle's rating is the title's");
});

test("drop from curious is refused; drop from backlog, active, or paused lands on dropped and start reopens", () => {
  assert.equal(allowed("drop", "curious", "none").ok, false);
  const entries = [entry("want", "2026-09-01"), entry("start", "2026-09-02"), entry("drop", "2026-09-05", { text: "difficulty spikes", rating: 2 })];
  assert.equal(deriveProgress(entries), "dropped");
  assert.deepEqual(deriveTake(entries), { rating: 2, review: "difficulty spikes" }, "the drop reason doubles as the review");
  assert.deepEqual(allowed("start", "dropped", "none"), { ok: true });
  assert.equal(deriveProgress([...entries, entry("start", "2026-09-08")]), "active");
});

test("unlog of the only start leaves progress entries and a curious title with no cycles", () => {
  const start = entry("start", "2026-09-01");
  const entries = [start, entry("progress", "2026-09-02", { progress: "chapter 3" }), entry("progress", "2026-09-03", { progress: "chapter 7", minutes: 40 })];
  assert.equal(deriveProgress(entries), "active");
  assert.equal(cycles(entries).length, 1);
  const remaining = entries.filter((e) => e.id !== start.id);
  assert.equal(deriveProgress(remaining), "curious");
  assert.deepEqual(cycles(remaining), []);
  assert.deepEqual(derive(remaining), { status: "curious", ownership: "none", ownershipDetail: null, rating: null, review: null });
});

// ------------------------------------------------------------------ ordering

test("precision ordering: unknown first, week before day on the same date, coarser before finer", () => {
  const day = entry("finish", "2026-09-07");
  const week = entry("start", "2026-09-07~w");
  const unknown = entry("want", "?");
  const month = entry("note", "2026-09");
  const year = entry("note", "2026");
  const ordered = orderEntries([day, week, unknown, month, year]);
  assert.deepEqual(ordered.map((e) => e.id), [unknown.id, year.id, month.id, week.id, day.id]);
  assert.equal(deriveProgress([day, week, unknown]), "done", "the week's start precedes the day's finish");
  // "Played years ago, started again this week": the unknown finish sorts first, so the title is active.
  assert.equal(deriveProgress([entry("finish", "?"), entry("start", "2026-09-09~w")]), "active");
});

test("same-day start and finish: the type rank puts the start first, so the title is done", () => {
  const at = "2026-09-12T10:00:00Z";
  const finish = entry("finish", "2026-09-11", { at });
  const start = entry("start", "2026-09-11", { at });
  assert.deepEqual(types(orderEntries([finish, start])), ["start", "finish"]);
  assert.equal(deriveProgress([finish, start]), "done");
  assert.deepEqual(types(orderEntries([entry("finish", "2026-09-11", { at }), entry("again", "2026-09-11", { at })])), ["again", "finish"]);
  assert.deepEqual(types(orderEntries([entry("resume", "2026-09-11", { at }), entry("pause", "2026-09-11", { at }), entry("note", "2026-09-11", { at })])), ["note", "resume", "pause"]);
  assert.deepEqual(types(orderEntries([entry("return", "2026-09-11", { at }), entry("finish", "2026-09-11", { at }), entry("buy", "2026-09-11", { at })])), ["finish", "buy", "return"]);
});

test("equal on and at are broken by type rank, then by id", () => {
  const at = "2026-09-12T10:00:00Z";
  const b = entry("note", "2026-09-11", { at, id: "n_bbbbbbbbbb" });
  const a = entry("note", "2026-09-11", { at, id: "n_aaaaaaaaaa" });
  const want = entry("want", "2026-09-11", { at, id: "n_0000000000" });
  assert.deepEqual(orderEntries([b, want, a]).map((e) => e.id), [a.id, b.id, want.id]);
  const earlier = entry("finish", "2026-09-11", { at: "2026-09-12T09:00:00Z" });
  const later = entry("start", "2026-09-11", { at: "2026-09-12T11:00:00Z" });
  assert.deepEqual(types(orderEntries([later, earlier])), ["finish", "start"], "at wins over rank");
  assert.equal(deriveProgress([later, earlier]), "active");
});

test("a backdated entry warns with the derived status and the later entry that decides it", () => {
  const start = entry("start", "2026-09-05");
  const finish = entry("finish", "2026-09-01");
  const entries = [start, finish];
  assert.equal(deriveProgress(entries), "active");
  assert.equal(
    backdatedWarning(entries, finish.id),
    `finish on 2026-09-01 is not the latest entry: status is active, decided by start on 2026-09-05 (${start.id})`,
  );
  assert.equal(backdatedWarning(entries, start.id), null, "the latest entry never warns");
  const note = entry("note", "2026-09-03", { text: "thoughts" });
  assert.equal(backdatedWarning([start, note], note.id), null, "a note decides nothing");
  const earlyFinish = entry("finish", "2026-09-01");
  assert.equal(backdatedWarning([earlyFinish, entry("note", "2026-09-03")], earlyFinish.id), null, "a later note does not change the status");
  const buy = entry("buy", "2026-09-10", { where: "Steam" });
  const ret = entry("return", "2026-09-12");
  const borrow = entry("borrow", "2026-09-02", { where: "library" });
  assert.equal(
    backdatedWarning([buy, ret, borrow], borrow.id),
    `borrow on 2026-09-02 is not the latest entry: ownership is none, decided by return on 2026-09-12 (${ret.id})`,
  );
  assert.equal(backdatedWarning([start, finish], "n_nosuchentry"), null);
});

// ------------------------------------------------------------------ ownership

test("ownership is independent of progress and ownershipDetail comes from the deciding entry", () => {
  const buy = entry("buy", "2026-09-01", { where: "Nintendo eShop", spend: { amount: 59.99, currency: "USD", kind: "purchase" } });
  let entries = [buy];
  assert.equal(deriveProgress(entries), "curious", "buying does not start");
  assert.deepEqual(deriveOwnership(entries), { ownership: "owned", detail: { where: "Nintendo eShop", since: on("2026-09-01"), price: { amount: 59.99, currency: "USD" } } });
  entries = [...entries, entry("start", "2026-09-02"), entry("finish", "2026-09-08", { rating: 4 })];
  assert.equal(deriveOwnership(entries).ownership, "owned", "finishing does not un-own");
  assert.equal(deriveProgress(entries), "done");
  const iap = entry("buy", "2026-09-09", { where: "in-game", spend: { amount: 4.99, currency: "USD", kind: "iap" } });
  assert.deepEqual(deriveOwnership([...entries, iap]).detail, { where: "in-game", since: on("2026-09-09"), price: null }, "only a purchase is the price");
  const borrow = entry("borrow", "2026-09-10", { where: "Libby" });
  assert.deepEqual(deriveOwnership([...entries, borrow]), { ownership: "borrowed", detail: { where: "Libby", since: on("2026-09-10"), price: null } });
  const service = entry("service", "2026-09-11", { where: "Game Pass" });
  assert.deepEqual(deriveOwnership([...entries, service]), { ownership: "service", detail: { where: "Game Pass", since: on("2026-09-11"), price: null } });
  const returned = entry("return", "2026-09-12");
  assert.deepEqual(deriveOwnership([...entries, borrow, returned]), { ownership: "none", detail: null });
  assert.equal(deriveProgress([...entries, borrow, returned]), "done", "returning does not touch progress");
  assert.deepEqual(deriveOwnership([]), { ownership: "none", detail: null });
});

// ------------------------------------------------------------------ takes and cycles

test("rating and review are per cycle and the title shows the latest non-null of each, independently", () => {
  const entries = [
    entry("start", "2026-01-01"),
    entry("finish", "2026-01-20", { rating: 4, text: "a fine first read" }),
    entry("again", "2026-06-01"),
    entry("finish", "2026-06-10", { rating: null, text: "even better the second time" }),
    entry("again", "2026-09-01"),
    entry("finish", "2026-09-10", { rating: 5, text: null }),
  ];
  assert.deepEqual(deriveTake(entries), { rating: 5, review: "even better the second time" });
  assert.deepEqual(deriveTake(entries.slice(0, 4)), { rating: 4, review: "even better the second time" });
  assert.deepEqual(deriveTake(entries.slice(0, 2)), { rating: 4, review: "a fine first read" });
  assert.deepEqual(deriveTake([entry("start"), entry("progress", "2026-09-08", { progress: "half" })]), { rating: null, review: null });
  const cut = cycles(entries);
  assert.equal(cut.length, 3);
  assert.deepEqual(cut.map((c) => c.closed?.rating ?? null), [4, null, 5], "each cycle keeps its own rating");
});

test("a cycle's format is its opener's, else its closer's", () => {
  const audio = cycles([entry("start", "2026-09-01", { format: "audiobook" }), entry("finish", "2026-09-05", { format: "kindle" })]);
  assert.equal(audio[0]!.format, "audiobook");
  const kindle = cycles([entry("start", "2026-09-01"), entry("finish", "2026-09-05", { format: "kindle" })]);
  assert.equal(kindle[0]!.format, "kindle");
  const alone = cycles([entry("finish", "2026-09-05", { format: "physical" })]);
  assert.equal(alone[0]!.format, "physical");
  assert.equal(cycles([entry("start"), entry("finish", "2026-09-08")])[0]!.format, null);
  assert.equal(cycles([entry("again", "2026-09-01", { format: "physical" })])[0]!.format, "physical", "an open cycle already has its format");
});

test("cycles on corrected sequences: openers cut open cycles short, closers alone are cycles of one, strays belong to none", () => {
  const entries = [
    entry("note", "2026-08-30", { text: "before anything" }),
    entry("start", "2026-09-01"),
    entry("progress", "2026-09-02", { progress: "ch 2" }),
    entry("start", "2026-09-03"),
    entry("pause", "2026-09-04"),
    entry("resume", "2026-09-05"),
    entry("finish", "2026-09-06"),
    entry("note", "2026-09-07", { text: "between cycles" }),
    entry("drop", "2026-09-08", { text: "changed my mind" }),
    entry("again", "2026-09-09"),
  ];
  const cut = cycles(entries);
  assert.equal(cut.length, 4);
  assert.deepEqual(types(cut[0]!.entries), ["start", "progress"]);
  assert.equal(cut[0]!.closed, null, "the second start cut the first cycle short");
  assert.deepEqual(types(cut[1]!.entries), ["start", "pause", "resume", "finish"]);
  assert.equal(cut[1]!.closed?.type, "finish");
  assert.deepEqual(types(cut[2]!.entries), ["drop"]);
  assert.equal(cut[2]!.opened, null, "a closer with no open cycle is a cycle of one");
  assert.deepEqual(types(cut[3]!.entries), ["again"]);
  assert.equal(cut[3]!.closed, null, "still open");
  assert.deepEqual(cycles([]), []);
  assert.equal(deriveProgress(entries), "active");
  assert.equal(lastEntry(entries)?.type, "again");
  assert.equal(lastEntry([]), null);
});

// ------------------------------------------------------------------ finalize and the schema

test("finalize recomputes the five derived fields and titleSchema rejects a stale one", () => {
  const entries = [
    entry("want", "2026-08-01"),
    entry("buy", "2026-08-02", { where: "Audible", spend: { amount: 14.95, currency: "USD", kind: "purchase" } }),
    entry("start", "2026-08-03", { format: "audiobook" }),
    entry("finish", "2026-08-31~w", { rating: 4.5, text: "loved the ending" }),
  ];
  const record = title(entries, { status: "curious", ownership: "none", ownershipDetail: null, rating: null, review: null });
  assert.equal(record.status, "done");
  assert.equal(record.ownership, "owned");
  assert.deepEqual(record.ownershipDetail, { where: "Audible", since: on("2026-08-02"), price: { amount: 14.95, currency: "USD" } });
  assert.equal(record.rating, 4.5);
  assert.equal(record.review, "loved the ending");
  assert.equal(titleSchema.safeParse(record).success, true);

  const stale: [Partial<Title>, RegExp][] = [
    [{ status: "active" }, /^status: Stale derived field: entries derive "done"$/],
    [{ ownership: "none" }, /^ownership: Stale derived field: entries derive "owned"$/],
    [{ ownershipDetail: null }, /^ownershipDetail: Stale derived field/],
    [{ ownershipDetail: { ...record.ownershipDetail!, where: "Kindle" } }, /^ownershipDetail: Stale/],
    [{ ownershipDetail: { ...record.ownershipDetail!, price: null } }, /^ownershipDetail: Stale/],
    [{ ownershipDetail: { ...record.ownershipDetail!, since: on("2026-08") } }, /^ownershipDetail: Stale/],
    [{ rating: 4 }, /^rating: Stale derived field: entries derive 4.5$/],
    [{ review: null }, /^review: Stale derived field: entries derive "loved the ending"$/],
    [{ entries: entries.slice(0, 3) }, /status: Stale.*"active"/],
  ];
  for (const [patch, expected] of stale) {
    const result = titleSchema.safeParse({ ...record, ...patch });
    assert.equal(result.success, false, JSON.stringify(patch));
    if (!result.success) assert.match(issuesOf(result.error).join("\n"), expected, JSON.stringify(patch));
  }
  assert.equal(titleSchema.safeParse(finalize({ ...record, entries: entries.slice(0, 3) })).success, true, "finalize repairs it");
});
