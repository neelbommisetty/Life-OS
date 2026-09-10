import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account, Calendar, Ctx, Receipt } from "../contract.ts";
import { createTestDb, fixedClock, type TestDb } from "../db/testing.ts";
import { FakeAdapter, ProviderUnavailable, type CalendarAdapter, type ProviderCalendar, type SeedEvent } from "./adapter.ts";
import { createAccounts, resolveAccount, resolveCalendar, type Accounts } from "./accounts.ts";
import { CredentialStore } from "./credentials.ts";

const NOW = "2026-09-09T12:00:00Z";
const clock = fixedClock(NOW);
const neel: Ctx = { actor: "neel" };
const noop = (): void => undefined;

const personal: ProviderCalendar = { id: "neel@example.com", name: "Personal", color: "#0b8043", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false };
const holidays: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };
const workMain: ProviderCalendar = { id: "work@example.com", name: "Work", color: "#4285f4", timezone: "America/Los_Angeles", writable: true, primary: true, hidden: false };
const workTeam: ProviderCalendar = { id: "team@example.com", name: "Team", color: "#4285f4", timezone: "America/Los_Angeles", writable: true, primary: false, hidden: false };
const workPersonal: ProviderCalendar = { id: "personal-at-work@example.com", name: "Personal", color: null, timezone: "America/Los_Angeles", writable: true, primary: false, hidden: false };

const timed = (day: string, hour: number, id?: string): SeedEvent => ({
  ...(id ? { id } : {}),
  title: `Event ${id ?? day}`,
  start: { at: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
  end: { at: `${day}T${String(hour + 1).padStart(2, "0")}:00:00Z`, timezone: "America/Los_Angeles" },
});

let db: TestDb;
let credentials: CredentialStore;
let fake: FakeAdapter;
let ops: Accounts;
let tempRoot: string;

before(async () => {
  db = await createTestDb();
  tempRoot = await mkdtemp(join(tmpdir(), "life-accounts-"));
  credentials = new CredentialStore(join(tempRoot, ".local", "google"));
  fake = new FakeAdapter({ clock });
  ops = createAccounts(db.store, clock, { adapters: { google: connecting(fake, credentials) }, credentials });
});
after(async () => {
  await db.drop();
  await rm(tempRoot, { recursive: true, force: true });
});

/** The fake as a real adapter behaves: `connect` leaves the credential under the provisional id for `account.add` to adopt. */
function connecting(inner: FakeAdapter, files: CredentialStore): CalendarAdapter {
  return {
    provider: "google",
    async connect(opts) {
      const result = await inner.connect(opts);
      await files.write(result.credentialId, { identity: result.identity, refreshToken: `refresh-${result.credentialId}`, scopes: result.scopes, obtainedAt: NOW });
      return result;
    },
    listCalendars: (accountId) => inner.listCalendars(accountId),
    syncPage: (accountId, calendar, cursor, since) => inner.syncPage(accountId, calendar, cursor, since),
    create: (accountId, calendar, event, lifeId) => inner.create(accountId, calendar, event, lifeId),
    update: (accountId, calendar, providerId, patch, etag) => inner.update(accountId, calendar, providerId, patch, etag),
    delete: (accountId, calendar, providerId) => inner.delete(accountId, calendar, providerId),
    respond: (accountId, calendar, providerId, response) => inner.respond(accountId, calendar, providerId, response),
    instanceId: (masterId, originalStart) => inner.instanceId(masterId, originalStart),
  };
}

function okRecord<T>(receipt: Receipt<T>, label = "receipt"): T {
  assert.equal(receipt.ok, true, `${label}: ${JSON.stringify(receipt)}`);
  if (!receipt.ok) throw new Error("unreachable");
  return receipt.record;
}

function rejectedIssues<T>(receipt: Receipt<T>): string[] {
  assert.equal(receipt.ok, false, `expected a rejection: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.outcome, "rejected");
  return receipt.issues;
}

const allAccounts = () => db.store.read((tx) => tx.all("account", { includeDeleted: true }));
const calendarsOf = (accountId: string) =>
  db.store.read(async (tx) => (await tx.all("calendar", { includeDeleted: true })).filter((c) => c.accountId === accountId).sort((a, b) => a.order - b.order));
const eventsOf = (accountId: string) => db.store.read(async (tx) => (await tx.all("event", { includeDeleted: true })).filter((e) => e.accountId === accountId));
const logOf = (op: string) => db.store.read(async (tx) => (await tx.allLog()).filter((entry) => entry.op === op));
const calendarNamed = async (accountId: string, name: string): Promise<Calendar> => {
  const found = (await calendarsOf(accountId)).find((c) => c.name === name);
  assert.ok(found, `no calendar ${name} under ${accountId}`);
  return found;
};

let first: Account;
let second: Account;

test("the first account becomes primary, adopts the credential under its id, and syncs", async () => {
  fake.connectAs("neel@example.com");
  fake.seed("neel@example.com", personal, [timed("2026-09-10", 16, "p1"), timed("2026-09-11", 17, "p2")]);
  fake.seed("neel@example.com", holidays, [{ id: "h1", title: "Labor Day", start: { date: "2026-09-07" }, end: { date: "2026-09-08" } }]);

  const opened: string[] = [];
  const receipt = await ops.account.add({ provider: "google", label: "home", open: (url) => opened.push(url) }, neel);
  first = okRecord<Account>(receipt);
  assert.equal(receipt.outcome, "created");
  assert.equal(opened.length, 1, "the sign-in URL was handed to open");
  assert.match(first.id, /^a_[a-z0-9]{10}$/);
  assert.equal(first.identity, "neel@example.com");
  assert.equal(first.label, "home");
  assert.equal(first.primary, true);
  assert.equal(first.status, "connected");
  assert.ok(first.scopes.length > 0);
  assert.equal(first.syncedAt, NOW, "the record on the receipt is the account after its first sync");
  assert.equal(receipt.version, first.version);

  // The credential moved from the provisional id to the account's.
  assert.equal(await credentials.exists(first.id), true);
  assert.deepEqual((await credentials.read(first.id))?.identity, "neel@example.com");
  assert.equal(await credentials.exists("fake-credential-1"), false);

  // The sync report is attached and the calendars and events landed.
  assert.ok(receipt.sync, "sync report attached");
  assert.equal(receipt.sync.accountId, first.id);
  assert.equal(receipt.sync.calendars.length, 2);
  assert.ok(receipt.sync.calendars.every((entry) => entry.outcome === "synced"), JSON.stringify(receipt.sync));
  assert.equal(receipt.warnings, undefined);
  const calendars = await calendarsOf(first.id);
  assert.deepEqual(calendars.map((c) => c.name), ["Personal", "Holidays"]);
  assert.equal(calendars[0].primaryOfAccount, true);
  assert.equal(calendars[1].hidden, true);
  assert.equal((await eventsOf(first.id)).length, 3);

  // Nothing about the credential reached the database or the log.
  const dump = JSON.stringify(await db.store.read(async (tx) => ({ accounts: await tx.all("account"), log: await tx.allLog() })));
  assert.ok(!dump.includes("refresh-"), "no refresh token in a record or the log");
  const added = await logOf("account.add");
  assert.equal(added.length, 1);
  assert.equal(added[0].actor, "neel");
  assert.equal(added[0].recordId, first.id);
});

test("a duplicate identity is rejected with the existing id, and the sign-in's credential is not kept", async () => {
  fake.connectAs("neel@example.com");
  const receipt = await ops.account.add({ provider: "google", open: noop }, neel);
  const issues = rejectedIssues(receipt);
  assert.ok(receipt.ok === false && receipt.outcome === "rejected");
  assert.equal(receipt.id, first.id);
  assert.match(issues[0], /already connected/);
  assert.ok(issues[0].includes(first.id));
  assert.equal((await allAccounts()).length, 1);
  assert.equal(await credentials.exists("fake-credential-2"), false, "the orphaned provisional credential was removed");
  assert.equal(await credentials.exists(first.id), true, "the existing account keeps its credential");
});

test("a sign-in that fails leaves nothing behind", async () => {
  fake.connectAs("nobody@example.com");
  fake.failNext(new ProviderUnavailable("Google is unreachable", 503));
  const receipt = await ops.account.add({ provider: "google", open: noop }, neel);
  const issues = rejectedIssues(receipt);
  assert.match(issues[0], /^provider_unavailable: /);
  assert.equal((await allAccounts()).length, 1);
  assert.deepEqual(
    (await allAccounts()).map((a) => a.identity),
    ["neel@example.com"],
  );
});

test("a bad ctx or input is rejected before the browser opens", async () => {
  const before = fake.callsTo("connect").length;
  const badCtx = await ops.account.add({ provider: "google", open: noop }, { actor: "nobody" } as unknown as Ctx);
  assert.match(rejectedIssues(badCtx)[0], /^actor: /);
  const badInput = await ops.account.add({ provider: "google", open: "browser" as unknown as () => void }, neel);
  assert.match(rejectedIssues(badInput)[0], /^open: /);
  assert.equal(fake.callsTo("connect").length, before, "connect was not called");
});

test("the second account is not primary and the lists are ordered", async () => {
  fake.connectAs("work@example.com");
  fake.seed("work@example.com", workMain, [timed("2026-09-10", 18, "w1")]);
  fake.seed("work@example.com", workTeam);
  fake.seed("work@example.com", workPersonal);
  const receipt = await ops.account.add({ provider: "google", open: noop }, { actor: "neel", key: "add-work" });
  second = okRecord<Account>(receipt);
  assert.equal(second.primary, false);
  assert.equal(second.identity, "work@example.com");
  assert.equal(second.label, null);
  assert.equal(await credentials.exists(second.id), true);

  const listed = await ops.account.list();
  assert.deepEqual(listed.map((a) => a.id), [first.id, second.id]);

  const calendars = await ops.calendar.list();
  assert.deepEqual(
    calendars.map((c) => `${c.accountId === first.id ? "home" : "work"}/${c.name}`),
    ["home/Personal", "work/Work", "work/Team", "work/Personal"],
    "account then order, hidden excluded",
  );
  const withHidden = await ops.calendar.list({ includeHidden: true });
  assert.deepEqual(
    withHidden.map((c) => c.name),
    ["Personal", "Holidays", "Work", "Team", "Personal"],
  );
});

test("a replayed key on add returns the stored receipt without a second sign-in", async () => {
  const before = fake.callsTo("connect").length;
  const replay = await ops.account.add({ provider: "google", open: noop }, { actor: "neel", key: "add-work" });
  assert.equal(replay.ok, true);
  assert.equal(replay.id, second.id);
  assert.equal(replay.outcome, "created");
  assert.equal(fake.callsTo("connect").length, before);
  assert.equal((await allAccounts()).length, 2);
});

test("accounts resolve by id, identity, or label; update changes the label", async () => {
  assert.equal((await ops.account.get(first.id))?.id, first.id);
  assert.equal((await ops.account.get("NEEL@example.com"))?.id, first.id);
  assert.equal((await ops.account.get("home"))?.id, first.id);
  assert.equal((await ops.account.get("Home"))?.id, first.id);
  assert.equal(await ops.account.get("nobody@example.com"), null);
  assert.equal(await ops.account.get("a_0000000000"), null);

  const updated = okRecord(await ops.account.update("work@example.com", { label: "office" }, neel));
  assert.equal(updated.label, "office");
  assert.equal(updated.version, second.version + 1);
  assert.equal((await ops.account.get("office"))?.id, second.id);
  const again = await ops.account.update("office", { label: "office" }, neel);
  assert.equal(again.ok && again.outcome, "unchanged");
  const cleared = okRecord(await ops.account.update(second.id, { label: null }, neel));
  assert.equal(cleared.label, null);
  assert.equal(await ops.account.get("office"), null);
  const missing = await ops.account.update("nobody", { label: "x" }, neel);
  assert.match(rejectedIssues(missing)[0], /no account "nobody"/);
  const badInput = await ops.account.update(second.id, { label: "" }, neel);
  assert.match(rejectedIssues(badInput)[0], /^label: /);
  second = cleared;
});

test("calendars resolve by id, <identity>/<name>, or a unique name", async () => {
  const homePersonal = await calendarNamed(first.id, "Personal");
  const workPersonalRow = await calendarNamed(second.id, "Personal");
  const team = await calendarNamed(second.id, "Team");
  assert.equal((await ops.calendar.get(team.id))?.id, team.id);
  assert.equal((await ops.calendar.get("Team"))?.id, team.id, "unique name");
  assert.equal((await ops.calendar.get("team"))?.id, team.id, "case-insensitive when unambiguous");
  assert.equal((await ops.calendar.get("work@example.com/Team"))?.id, team.id);
  assert.equal((await ops.calendar.get("neel@example.com/Personal"))?.id, homePersonal.id);
  assert.equal((await ops.calendar.get("work@example.com/Personal"))?.id, workPersonalRow.id);
  assert.equal(await ops.calendar.get("Personal"), null, "ambiguous names resolve to nothing");
  assert.equal(await ops.calendar.get("nobody@example.com/Personal"), null);
  assert.equal((await ops.calendar.get("Holidays"))?.id, (await calendarNamed(first.id, "Holidays")).id, "hidden calendars still resolve");

  const ambiguous = await ops.calendar.update("Personal", { hidden: true }, neel);
  const issues = rejectedIssues(ambiguous);
  assert.match(issues[0], /names 2 calendars/);
  assert.ok(issues[0].includes("neel@example.com/Personal") && issues[0].includes("work@example.com/Personal"));

  await db.store.read(async (tx) => {
    assert.equal((await resolveAccount(tx, "home"))?.id, first.id);
    assert.equal((await resolveCalendar(tx, "Team"))?.id, team.id);
  });
});

test("calendar update sets labels (registering new ones), hidden, and colour, and nothing else", async () => {
  const team = await calendarNamed(second.id, "Team");
  const updated = okRecord(await ops.calendar.update("Team", { labels: ["work", "engineering", "work"], hidden: true, color: "#ff0000" }, { actor: "neel", reason: "team calendar" }));
  assert.deepEqual(updated.labels, ["work", "engineering"]);
  assert.equal(updated.hidden, true);
  assert.equal(updated.color, "#ff0000");
  assert.equal(updated.version, team.version + 1);
  assert.equal(updated.name, team.name);
  assert.equal(updated.external.id, team.external.id);
  const labels = await db.store.read((tx) => tx.all("label"));
  assert.deepEqual(labels.map((l) => l.name).sort(), ["engineering", "work"]);
  assert.ok(labels.every((l) => l.origin.actor === "neel" && l.origin.reason === "team calendar"));
  assert.equal((await logOf("label.add")).length, 2);

  assert.equal((await ops.calendar.list()).some((c) => c.id === team.id), false, "hidden now");
  const unchanged = await ops.calendar.update(team.id, { hidden: true }, neel);
  assert.equal(unchanged.ok && unchanged.outcome, "unchanged");
  const cleared = okRecord(await ops.calendar.update(team.id, { color: null, hidden: false }, neel));
  assert.equal(cleared.color, null);
  assert.equal(cleared.hidden, false);

  const badLabel = await ops.calendar.update(team.id, { labels: ["Not A Slug"] }, neel);
  assert.match(rejectedIssues(badLabel)[0], /^labels\.0: /);
  const stale = await ops.calendar.update(team.id, { hidden: true }, { actor: "neel", ifVersion: 1 });
  assert.match(rejectedIssues(stale)[0], /^version: /);
  const unknown = await ops.calendar.update(team.id, { name: "x" } as unknown as { hidden: boolean }, neel);
  assert.match(rejectedIssues(unknown)[0], /Unrecognized key: "name"/);
});

test("our fields on a calendar survive a sync", async () => {
  const team = await calendarNamed(second.id, "Team");
  fake.changeCalendar(second.id, workTeam.id, { name: "Team (renamed)", color: "#123456" });
  const [report] = await ops.account.sync(second.id);
  assert.equal(report.accountId, second.id);
  const after = await ops.calendar.get(team.id);
  assert.equal(after?.name, "Team (renamed)");
  assert.deepEqual(after?.labels, ["work", "engineering"]);
  assert.equal(after?.color, null, "colour Neel cleared stays cleared");
  fake.changeCalendar(second.id, workTeam.id, { name: "Team" });
  await ops.account.sync(second.id);
  assert.equal((await ops.calendar.get(team.id))?.name, "Team");
});

test("reorder works within one account and is refused across accounts", async () => {
  const [work, team, personal] = await calendarsOf(second.id);
  const receipts = await ops.calendar.reorder([personal.id, work.id, team.id], { actor: "neel", key: "reorder-work" });
  assert.equal(receipts.length, 3);
  assert.deepEqual(
    receipts.map((r) => r.ok && r.outcome),
    ["updated", "updated", "updated"],
  );
  assert.deepEqual((await calendarsOf(second.id)).map((c) => c.name), ["Personal", "Work", "Team"]);
  assert.deepEqual(
    (await ops.calendar.list()).map((c) => c.name),
    ["Personal", "Personal", "Work", "Team"],
    "list follows the new order",
  );

  const replay = await ops.calendar.reorder([personal.id, work.id, team.id], { actor: "neel", key: "reorder-work" });
  assert.deepEqual(
    replay.map((r) => r.ok && r.outcome),
    ["updated", "updated", "updated"],
    "same key, same receipts",
  );
  assert.equal((await logOf("calendar.reorder")).length, 3);

  const homePersonal = await calendarNamed(first.id, "Personal");
  const mixed = await ops.calendar.reorder([homePersonal.id, work.id], neel);
  assert.equal(mixed.length, 2);
  assert.ok(mixed.every((r) => !r.ok && r.issues[0].includes("same account")));
  const unknown = await ops.calendar.reorder([work.id, "c_0000000000"], neel);
  assert.ok(unknown.every((r) => !r.ok && r.issues[0].includes("no calendar")));
  const dupes = await ops.calendar.reorder([work.id, work.id], neel);
  assert.ok(dupes.every((r) => !r.ok && r.issues[0].includes("duplicates")));
  assert.deepEqual(await ops.calendar.reorder([], neel), []);
});

test("primary swaps in one transaction, one receipt per changed account", async () => {
  const receipts = await ops.account.primary("work@example.com", { actor: "neel", key: "primary-work" });
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].id, second.id);
  assert.equal(receipts[0].ok && receipts[0].outcome, "updated");
  assert.equal(receipts[1].id, first.id);
  assert.equal(receipts[1].ok && receipts[1].outcome, "updated");
  const accounts = await ops.account.list();
  assert.deepEqual(
    accounts.map((a) => [a.identity, a.primary]),
    [
      ["neel@example.com", false],
      ["work@example.com", true],
    ],
  );
  const entries = await logOf("account.primary");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.patch.primary), [{ from: false, to: true }, { from: true, to: false }]);
  assert.deepEqual(new Set(entries.map((e) => e.at)).size, 1, "both written at the same instant");
  assert.equal(entries[0].key, "primary-work0");
  assert.equal(entries[1].key, "primary-work1");

  // Already primary: the target is unchanged and nothing else moves.
  const again = await ops.account.primary(second.id, neel);
  assert.equal(again.length, 1);
  assert.equal(again[0].ok && again[0].outcome, "unchanged");
  assert.equal((await logOf("account.primary")).length, 2);

  // A stale ifVersion on the target rejects everything: the other account is not touched.
  const stale = await ops.account.primary(first.id, { actor: "neel", ifVersion: 1 });
  assert.equal(stale.length, 1);
  assert.match(rejectedIssues(stale[0])[0], /^version: /);
  assert.equal((await ops.account.get(second.id))?.primary, true);

  const missing = await ops.account.primary("nobody", neel);
  assert.equal(missing.length, 1);
  assert.match(rejectedIssues(missing[0])[0], /no account "nobody"/);
});

test("sync runs for one account or every connected one, full discards cursors, and a calendar syncs alone", async () => {
  fake.calls.length = 0;
  const all = await ops.account.sync();
  assert.deepEqual(all.map((r) => r.accountId), [first.id, second.id]);
  const incremental = fake.callsTo("syncPage");
  assert.ok(incremental.length >= 5);
  assert.ok(incremental.every((call) => call.args[2] !== null), "incremental: every page continues from a stored cursor");

  fake.calls.length = 0;
  const [full] = await ops.account.sync("home", { full: true });
  assert.equal(full.accountId, first.id);
  assert.ok(fake.callsTo("syncPage").every((call) => call.args[0] === first.id && call.args[2] === null), "full: cursors discarded");

  fake.calls.length = 0;
  fake.seed(second.id, workTeam, [timed("2026-09-12", 9, "t1")]);
  const teamRow = await calendarNamed(second.id, "Team");
  const one = await ops.calendar.sync("Team");
  assert.equal(one.accountId, second.id);
  const teamEntry = one.calendars.find((c) => c.calendarId === teamRow.id);
  assert.ok(teamEntry);
  assert.equal(teamEntry.outcome, "synced");
  assert.equal(teamEntry.created, 1);
  assert.deepEqual(fake.callsTo("syncPage").map((call) => call.args[1]), [workTeam.id], "only that calendar was pulled");

  await assert.rejects(() => ops.account.sync("nobody"), /no account "nobody"/);
  await assert.rejects(() => ops.calendar.sync("Nowhere"), /no calendar "Nowhere"/);
  await assert.rejects(() => ops.calendar.sync("Personal"), /names 2 calendars/);
});

test("a sync failure on add comes back as a warning, not a hidden empty", async () => {
  fake.connectAs("third@example.com");
  fake.seed("third@example.com", { id: "third@example.com", name: "Third", color: null, timezone: "UTC", writable: true, primary: true, hidden: false });
  const failing = connecting(fake, credentials);
  const flaky: CalendarAdapter = {
    ...failing,
    syncPage: () => Promise.reject(new ProviderUnavailable("quota exceeded", 403)),
  };
  const local = createAccounts(db.store, clock, { adapters: { google: flaky }, credentials });
  const receipt = await local.account.add({ provider: "google", open: noop }, neel);
  const third = okRecord<Account>(receipt);
  assert.equal(third.primary, false);
  assert.ok(receipt.sync);
  assert.equal(receipt.sync.calendars[0].outcome, "failed");
  assert.deepEqual(receipt.warnings, ["Third: ProviderUnavailable: quota exceeded"]);
  assert.equal((await calendarNamed(third.id, "Third")).syncError, "ProviderUnavailable: quota exceeded");

  // Clean up so the remove tests below see two accounts: no primary guard applies to a non-primary account.
  const removed = okRecord(await ops.account.remove(third.id, neel));
  assert.equal(removed.deletedAt, NOW);
  assert.equal(await credentials.exists(third.id), false);
});

test("remove is refused while the account is primary and another exists", async () => {
  const receipt = await ops.account.remove("work@example.com", neel);
  const issues = rejectedIssues(receipt);
  assert.match(issues[0], /primary account/);
  assert.ok(issues[0].includes("neel@example.com"), "names the account to promote");
  assert.equal(receipt.ok === false && receipt.outcome === "rejected" && receipt.id, second.id);
  assert.equal(await credentials.exists(second.id), true, "the credential stays");
  assert.equal((await ops.account.get(second.id))?.deletedAt, null);
  assert.ok((await calendarsOf(second.id)).every((c) => c.deletedAt === null));
});

test("remove soft-deletes the account, its calendars, and their events, and deletes the credential", async () => {
  const receipt = await ops.account.remove("neel@example.com", { actor: "neel", reason: "old account" });
  const removed = okRecord(receipt);
  assert.equal(receipt.outcome, "updated");
  assert.equal(removed.deletedAt, NOW);
  assert.equal(removed.status, "disconnected");
  assert.equal(await credentials.exists(first.id), false, "credential file deleted");
  assert.equal(await credentials.exists(second.id), true, "the other account's credential is untouched");

  const calendars = await calendarsOf(first.id);
  assert.equal(calendars.length, 2);
  assert.ok(calendars.every((c) => c.deletedAt === NOW));
  const events = await eventsOf(first.id);
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.deletedAt === NOW));
  assert.ok(events.every((e) => e.status !== "cancelled"), "status left alone");
  // Only this account's cascade: an earlier test removed another account under the same op.
  const removedIds = new Set([first.id, ...calendars.map((c) => c.id), ...events.map((e) => e.id)]);
  const cascade = (await logOf("account.remove")).filter((e) => removedIds.has(e.recordId));
  assert.equal(cascade.length, 1 + 2 + 3);
  assert.ok(cascade.every((e) => e.actor === "neel" && e.reason === "old account"));

  assert.deepEqual((await ops.account.list()).map((a) => a.id), [second.id]);
  assert.equal(await ops.account.get("neel@example.com"), null, "identity no longer resolves");
  assert.equal((await ops.account.get(first.id))?.deletedAt, NOW, "the id still does, deleted included");
  assert.equal((await ops.calendar.list({ includeHidden: true })).some((c) => c.accountId === first.id), false);
  assert.equal(await ops.calendar.get("Holidays"), null);

  const again = await ops.account.remove(first.id, neel);
  assert.match(rejectedIssues(again)[0], /was removed/);

  // The identity can be connected again as a new account; the old one stays in the trash.
  fake.connectAs("neel@example.com");
  const back = okRecord<Account>(await ops.account.add({ provider: "google", open: noop }, neel));
  assert.notEqual(back.id, first.id);
  assert.equal(back.primary, false, "another live account is primary");
  assert.equal((await allAccounts()).length, 4);

  // The last remaining primary cannot be removed while the readded one exists; once it is the only one, it can.
  okRecord(await ops.account.remove(back.id, neel));
  const last = okRecord(await ops.account.remove(second.id, neel));
  assert.equal(last.deletedAt, NOW);
  assert.equal(await credentials.exists(second.id), false);
  assert.deepEqual(await ops.account.list(), []);
  assert.deepEqual(await ops.calendar.list({ includeHidden: true }), []);
});

test("without an adapter for the provider, sync reports the failure per calendar and add is rejected", async () => {
  // Every earlier account is removed by now; connect one with the real fake so there is something to sync.
  fake.connectAs("solo@example.com");
  fake.seed("solo@example.com", { id: "solo@example.com", name: "Solo", color: null, timezone: "UTC", writable: true, primary: true, hidden: false });
  const solo = okRecord<Account>(await ops.account.add({ provider: "google", open: noop }, neel));
  assert.equal(solo.primary, true, "the only live account is primary again");

  const bare = createAccounts(db.store, clock, { adapters: {}, credentials });
  const receipt = await bare.account.add({ provider: "google", open: noop }, neel);
  assert.match(rejectedIssues(receipt)[0], /no google adapter/);
  const reports = await bare.account.sync(solo.id);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].calendars.length, 1);
  assert.ok(reports[0].calendars.every((c) => c.outcome === "failed" && c.error === "No google adapter is configured"));
  const one = await bare.calendar.sync("Solo");
  assert.deepEqual(
    one.calendars.map((c) => [c.outcome, c.error]),
    [["failed", "No google adapter is configured"]],
  );
  assert.equal((await ops.calendar.get("Solo"))?.syncError, null, "a missing adapter is reported, not recorded as the calendar's sync error");
});
