import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Clock } from "./core.ts";
import { databaseUrl } from "./db/client.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { EXIT, USAGE, main } from "./cli.ts";

// Every run, spawned or in-process, points at one throwaway schema through a URL whose
// connections set search_path to it; nothing here sees the public schema.
const BIN = fileURLToPath(new URL("../bin/life.js", import.meta.url));
const TZ = "America/Los_Angeles";
const UNREACHABLE = "postgres://life:life@127.0.0.1:1/life";

type Run = { code: number; stdout: string; stderr: string };

let db: TestDb;
let url: string;
let scratch: string;
before(async () => {
  db = await createTestDb();
  url = `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${db.schema}`;
  scratch = await mkdtemp(join(tmpdir(), "life-cli-"));
});
after(async () => {
  await db.drop();
  await rm(scratch, { recursive: true, force: true });
});

/** `node bin/life.js ...` with stdin and stdout piped (no terminal), LIFE_ACTOR=neel unless overridden. */
function life(args: string[], opts: { env?: Record<string, string | undefined>; input?: string } = {}): Promise<Run> {
  const env: Record<string, string> = {};
  const wanted: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LIFE_DATABASE_URL: url,
    LIFE_ACTOR: "neel",
    LIFE_TZ: TZ,
    ...opts.env,
  };
  for (const [key, value] of Object.entries(wanted)) if (value !== undefined) env[key] = value;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });
}

type Tty = PassThrough & { isTTY?: boolean };

/** `main()` in this process with fake streams: a terminal or not, an optional typed answer, a fixed clock. LIFE_ACTOR=neel unless overridden. */
async function inProcess(args: string[], opts: { tty?: boolean; stdinTty?: boolean; input?: string; clock?: Clock; env?: Record<string, string | undefined> } = {}): Promise<Run> {
  const stdin: Tty = new PassThrough();
  const stdout: Tty = new PassThrough();
  const stderr = new PassThrough();
  stdin.isTTY = opts.stdinTty ?? opts.tty ?? false;
  stdout.isTTY = opts.tty ?? false;
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
  if (opts.input !== undefined) stdin.write(opts.input);
  stdin.end();
  const env: Record<string, string | undefined> = { LIFE_TZ: TZ, LIFE_ACTOR: "neel", ...opts.env };
  const code = await main([...args, "--db", url], { env, stdin, stdout, stderr, ...(opts.clock ? { clock: opts.clock } : {}) });
  return { code, stdout: out, stderr: err };
}

function json<T = Record<string, unknown>>(run: Run): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error(`not JSON (exit ${run.code}): ${run.stdout}\n${run.stderr}`);
  }
}

type AnyReceipt = { ok: boolean; outcome: string; id?: string; version?: number; record?: Record<string, unknown>; issues: string[]; candidates?: Record<string, unknown>[]; needs?: { field: string; options: string[]; message: string } };
type AnyTask = { id: string; title: string; notes: string; status: string; labels: string[]; due: { date: string; time?: string; timezone?: string } | null; deadline: string | null; priority?: number; projectId: string; sectionId?: string; parentId?: string; comments: { text: string; attachments: { name: string; url: string }[] }[]; origin: { actor: string; evidence: string[] }; deletedAt: string | null };

/** Assert a run produced an ok receipt and return the record. */
function created(run: Run, outcome = "created"): AnyTask & Record<string, unknown> {
  const receipt = json<AnyReceipt>(run);
  assert.equal(run.code, EXIT.ok, `exit ${run.code}: ${run.stdout} ${run.stderr}`);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.outcome, outcome);
  return receipt.record as AnyTask & Record<string, unknown>;
}

const ids = (tasks: { id: string }[]): string[] => tasks.map((t) => t.id);

// Fixtures built up across the tests below (node:test runs a file's tests in order).
let healthId: string;
let dentist: AnyTask;
let rent: AnyTask;
let floss: AnyTask;

// ------------------------------------------------------------------ usage

test("usage errors exit 64 and name the problem", async () => {
  const none = await life([]);
  assert.equal(none.code, EXIT.usage);
  assert.match(none.stderr, /a command is required/);
  assert.match(none.stderr, /usage: life <group> <command>/);

  const group = await life(["task"]);
  assert.equal(group.code, EXIT.usage);
  assert.match(group.stderr, /life task: a command is required/);

  const unknown = await life(["task", "bogus"]);
  assert.equal(unknown.code, EXIT.usage);
  assert.match(unknown.stderr, /unknown command "task bogus"/);

  const missing = await life(["task", "add"]);
  assert.equal(missing.code, EXIT.usage);
  assert.match(missing.stderr, /<title> required/);

  const flag = await life(["task", "add", "x", "--bogus"]);
  assert.equal(flag.code, EXIT.usage);
  assert.match(flag.stderr, /unknown flag --bogus/);

  const value = await life(["task", "add", "x", "--priority"]);
  assert.equal(value.code, EXIT.usage);
  assert.match(value.stderr, /--priority needs a value/);

  const integer = await life(["task", "add", "x", "--priority", "high"]);
  assert.equal(integer.code, EXIT.usage);
  assert.match(integer.stderr, /--priority expects an integer/);

  const time = await life(["task", "add", "x", "--time", "09:00"]);
  assert.equal(time.code, EXIT.usage);
  assert.match(time.stderr, /--time needs --due/);

  const reschedule = await life(["task", "reschedule", "t_0000000000"]);
  assert.equal(reschedule.code, EXIT.usage);
  assert.match(reschedule.stderr, /pass --due d or --no-due/);

  const both = await life(["task", "update", "t_0000000000", "--due", "2026-09-06", "--no-due"]);
  assert.equal(both.code, EXIT.usage);
  assert.match(both.stderr, /--due and --no-due exclude each other/);

  const extra = await life(["today", "extra"]);
  assert.equal(extra.code, EXIT.usage);
  assert.match(extra.stderr, /unexpected argument "extra"/);

  const tz = await life(["today", "--tz", "Mars/Olympus"]);
  assert.equal(tz.code, EXIT.usage);
  assert.match(tz.stderr, /unknown timezone/);

  const help = await life(["help"]);
  assert.equal(help.code, EXIT.ok);
  assert.equal(help.stdout, USAGE);
  assert.equal((await life(["task", "add", "--help"])).stdout, USAGE);
});

test("the actor comes from --actor, then LIFE_ACTOR, then the terminal", async () => {
  const anonymous = await life(["task", "add", "Nobody's task"], { env: { LIFE_ACTOR: undefined } });
  assert.equal(anonymous.code, EXIT.usage, anonymous.stderr);
  assert.match(anonymous.stderr, /--actor is required/);
  assert.match(anonymous.stderr, /LIFE_ACTOR/);

  const read = await life(["task", "list"], { env: { LIFE_ACTOR: undefined } });
  assert.equal(read.code, EXIT.ok, "a read needs no actor");
  assert.deepEqual(json(read), []);

  const fromEnv = created(await life(["task", "add", "From the environment"]));
  assert.equal(fromEnv.origin.actor, "neel");
  assert.equal(fromEnv.status, "accepted", "neel's tasks land accepted");

  const fromFlag = created(await life(["task", "add", "From codex", "--actor", "codex", "--reason", "seen in notes", "--evidence", "vault:a", "--evidence", "vault:b"], { env: { LIFE_ACTOR: undefined } }));
  assert.equal(fromFlag.origin.actor, "codex");
  assert.equal(fromFlag.status, "proposed", "another actor's tasks land proposed");
  assert.deepEqual(fromFlag.origin.evidence, ["vault:a", "vault:b"], "--evidence repeats");
  assert.equal((fromFlag.origin as { reason?: string }).reason, "seen in notes");

  const terminal = await inProcess(["task", "add", "From a terminal", "--json"], { tty: true, env: { LIFE_ACTOR: undefined } });
  assert.equal(terminal.code, EXIT.ok, terminal.stderr);
  assert.equal(created(terminal).origin.actor, "neel", "a terminal defaults to neel");

  const notTerminal = await inProcess(["task", "add", "Not a terminal"], { tty: false, env: { LIFE_ACTOR: undefined } });
  assert.equal(notTerminal.code, EXIT.usage);

  const bad = await life(["task", "add", "Bad actor", "--actor", "somebody"]);
  assert.equal(bad.code, EXIT.rejected);
  assert.match(json<AnyReceipt>(bad).issues.join("\n"), /actor/);
});

// ------------------------------------------------------------------ the task round trip

test("add, list, get, complete, history round trip with JSON output", async () => {
  const health = created(await life(["project", "add", "Health", "--label", "health"]));
  healthId = health.id;

  const add = await life(["task", "add", "Book the dentist", "--project", "health", "--due", "2026-09-06", "--time", "09:00", "--priority", "2", "--label", "urgent", "--notes", "Ask about the crown", "--json"]);
  dentist = created(add);
  assert.match(dentist.id, /^t_[a-z0-9]{10}$/);
  assert.equal(dentist.title, "Book the dentist");
  assert.equal(dentist.projectId, healthId);
  assert.deepEqual(dentist.due, { date: "2026-09-06", time: "09:00", timezone: TZ }, "a time carries the effective timezone");
  assert.equal(dentist.priority, 2);
  assert.deepEqual(dentist.labels, ["urgent"]);
  assert.equal(dentist.notes, "Ask about the crown");

  rent = created(await life(["task", "add", "Pay rent", "--due=2026-09-01", "--deadline", "2026-09-03"]));
  assert.deepEqual(rent.due, { date: "2026-09-01" }, "--flag=value works");
  assert.equal(rent.deadline, "2026-09-03");

  const list = await life(["task", "list"]);
  assert.equal(list.code, EXIT.ok);
  const listed = json<AnyTask[]>(list);
  assert.ok(Array.isArray(listed), "JSON is the default when stdout is not a terminal");
  assert.deepEqual(ids(listed).slice(0, 2), [rent.id, dentist.id], "sorted like list: by due date");

  const byLabel = await life(["task", "list", "--label", "health", "--json"]);
  assert.deepEqual(ids(json<AnyTask[]>(byLabel)), [dentist.id], "the project's label reaches its tasks");
  const byProject = await life(["task", "list", "--project", "health", "--status", "accepted,in_progress"]);
  assert.deepEqual(ids(json<AnyTask[]>(byProject)), [dentist.id]);
  const byFilter = await life(["task", "list", "--filter", "due before: 2026-09-05"]);
  assert.deepEqual(ids(json<AnyTask[]>(byFilter)), [rent.id]);

  const get = await life(["task", "get", dentist.id]);
  assert.equal(get.code, EXIT.ok);
  assert.equal(json<AnyTask>(get).id, dentist.id);

  const missing = await life(["task", "get", "t_0000000000"]);
  assert.equal(missing.code, EXIT.rejected, "an unknown id is not an empty success");
  assert.deepEqual(json<AnyReceipt>(missing).issues, ['task: no task "t_0000000000"'], "and says so in JSON, not a bare null");

  const complete = await life(["task", "complete", rent.id, "--json"]);
  const done = created(complete, "updated");
  assert.equal(done.status, "done");
  assert.equal(json<AnyReceipt>(complete).version, 2);

  const history = await life(["task", "history", rent.id]);
  assert.equal(history.code, EXIT.ok);
  const entries = json<{ op: string; actor: string; patch: Record<string, { from: unknown; to: unknown }> }[]>(history);
  assert.deepEqual(entries.map((e) => e.op), ["task.add", "task.complete"]);
  assert.equal(entries[1]!.patch.status!.to, "done");

  const noHistory = await life(["task", "history", "t_0000000000"]);
  assert.equal(noHistory.code, EXIT.rejected);
});

test("a similar title exits 2 with the candidates until --allow-duplicate", async () => {
  const dup = await life(["task", "add", "Book the dentist"]);
  assert.equal(dup.code, EXIT.duplicate);
  const receipt = json<AnyReceipt>(dup);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.outcome, "duplicate");
  assert.deepEqual(receipt.candidates!.map((c) => c.id), [dentist.id]);

  const human = await inProcess(["task", "add", "Book the dentist"], { tty: true });
  assert.equal(human.code, EXIT.duplicate);
  assert.match(human.stdout, /^duplicate: 1 similar open task/m);
  assert.match(human.stdout, /Book the dentist/);
  assert.match(human.stdout, /pass --allow-duplicate/);

  const allowed = await life(["task", "add", "Book the dentist", "--allow-duplicate"]);
  const twin = created(allowed);
  assert.notEqual(twin.id, dentist.id);
  created(await life(["task", "delete", twin.id]), "updated");
});

test("rejected input exits 1 with the issues", async () => {
  const priority = await life(["task", "add", "Too important", "--priority", "9"]);
  assert.equal(priority.code, EXIT.rejected);
  const receipt = json<AnyReceipt>(priority);
  assert.equal(receipt.outcome, "rejected");
  assert.ok(receipt.issues.some((issue) => /priority/.test(issue)), receipt.issues.join("\n"));

  const human = await inProcess(["task", "cancel", dentist.id], { tty: true });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^rejected t_/m);
  assert.match(human.stdout, /- reason: cancel needs a reason/);

  const project = await life(["task", "add", "Nowhere", "--project", "nope"]);
  assert.equal(project.code, EXIT.rejected);
  assert.ok(json<AnyReceipt>(project).issues.some((issue) => /project/.test(issue)));

  const badDate = await life(["task", "add", "When?", "--due", "someday"]);
  assert.equal(badDate.code, EXIT.rejected, "an unparseable date is the library's rejection, not a usage error");
  assert.ok(json<AnyReceipt>(badDate).issues.some((issue) => /due/.test(issue)));

  const stale = await life(["task", "update", dentist.id, "--title", "Stale", "--if-version", "99"]);
  assert.equal(stale.code, EXIT.rejected);
  assert.match(json<AnyReceipt>(stale).issues[0]!, /version: expected 99/);
});

// ------------------------------------------------------------------ needs

test("a needs rejection without a terminal exits 1 and names the flag to pass", async () => {
  const parent = created(await life(["task", "add", "Parent with children"]));
  const child = created(await life(["task", "add", "First child", "--parent", parent.id]));

  const asked = await life(["task", "complete", parent.id]);
  assert.equal(asked.code, EXIT.rejected);
  const receipt = json<AnyReceipt>(asked);
  assert.equal(receipt.outcome, "rejected");
  assert.deepEqual(receipt.needs, { field: "subtasks", options: ["complete", "leave"], message: receipt.needs!.message }, "the receipt is passed through as the library returns it");
  assert.match(asked.stderr, /pass --subtasks complete\|leave/);
  assert.match(asked.stderr, /1 open sub-task/);

  const human = await inProcess(["task", "complete", parent.id], { tty: true, stdinTty: false });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^rejected t_/m, "stdout is a terminal but stdin is not: no question");
  assert.match(human.stdout, /pass --subtasks complete\|leave/);

  const wrong = await life(["task", "complete", parent.id, "--subtasks", "maybe"]);
  assert.equal(wrong.code, EXIT.usage);
  assert.match(wrong.stderr, /--subtasks expects complete or leave/);

  const chosen = await life(["task", "complete", parent.id, "--subtasks", "complete"]);
  assert.equal(created(chosen, "updated").status, "done");
  assert.equal(json<AnyTask>(await life(["task", "get", child.id])).status, "done", "the sub-task was completed too");

  const deleted = await life(["task", "delete", parent.id]);
  assert.equal(created(deleted, "updated").deletedAt !== null, true, "nothing open below: no question");
});

test("on a terminal a needs rejection becomes a question and the answer is applied", async () => {
  const parent = created(await life(["task", "add", "Parent asked on a terminal"]));
  const child = created(await life(["task", "add", "Second child", "--parent", parent.id]));

  const unanswered = await inProcess(["task", "complete", parent.id], { tty: true });
  assert.equal(unanswered.code, EXIT.rejected, "input ended without an answer");
  assert.match(unanswered.stdout, /subtasks \[complete\/leave\]:/);
  assert.match(unanswered.stdout, /pass --subtasks complete\|leave/);

  const wrong = await inProcess(["task", "complete", parent.id], { tty: true, input: "maybe\n" });
  assert.equal(wrong.code, EXIT.rejected);
  assert.equal(json<AnyTask>(await life(["task", "get", parent.id])).status, "accepted");

  const answered = await inProcess(["task", "complete", parent.id], { tty: true, input: "leave\n" });
  assert.equal(answered.code, EXIT.ok, answered.stdout);
  assert.match(answered.stdout, /subtasks \[complete\/leave\]:/);
  assert.match(answered.stdout, /updated t_[a-z0-9]{10} v2  Parent asked on a terminal/);
  assert.equal(json<AnyTask>(await life(["task", "get", parent.id])).status, "done");
  assert.equal(json<AnyTask>(await life(["task", "get", child.id])).status, "accepted", "leave left the child open");

  const jsonOnTerminal = await inProcess(["task", "delete", parent.id, "--json"], { tty: true, input: "delete\n" });
  assert.equal(jsonOnTerminal.code, EXIT.rejected, "--json never asks");
  assert.equal(json<AnyReceipt>(jsonOnTerminal).needs!.field, "subtasks");
});

// ------------------------------------------------------------------ projects, sections, labels, filters

test("project add and tree, sections, and the contents question on delete", async () => {
  const dental = created(await life(["project", "add", "Dental", "--parent", "health", "--color", "blue"]));
  assert.equal(dental.parentId, healthId);
  assert.equal(dental.slug, "dental");

  const tree = await life(["project", "tree"]);
  assert.equal(tree.code, EXIT.ok);
  type Node = { project: { slug: string; system: boolean }; sections: { name: string }[]; children: Node[] };
  const nodes = json<Node[]>(tree);
  assert.deepEqual(nodes.map((n) => n.project.slug), ["inbox", "health"]);
  assert.equal(nodes[0]!.project.system, true);
  assert.deepEqual(nodes[1]!.children.map((n) => n.project.slug), ["dental"]);

  const section = created(await life(["section", "add", "health", "Plan"]));
  assert.equal(section.projectId, healthId);
  const sections = await life(["section", "list", "health"]);
  assert.deepEqual(json<{ id: string; name: string }[]>(sections).map((s) => s.name), ["Plan"]);
  const renamed = await life(["section", "update", section.id, "--name", "Planning"]);
  assert.equal(created(renamed, "updated").name, "Planning");

  const human = await inProcess(["project", "tree"], { tty: true });
  assert.equal(human.code, EXIT.ok);
  const lines = human.stdout.trimEnd().split("\n");
  assert.match(lines[0]!, /^Inbox +inbox +p_/);
  assert.match(lines[1]!, /^Health +health +p_[a-z0-9]{10} +@health/);
  assert.match(lines[2]!, /^  - Planning +s_/, "sections sit under their project");
  assert.match(lines[3]!, /^  Dental +dental +p_/, "sub-projects are indented");

  const got = await life(["project", "get", "health/dental"]);
  assert.equal(json<{ id: string }>(got).id, dental.id);
  const detail = await inProcess(["project", "get", "health/dental"], { tty: true });
  assert.match(detail.stdout, /^path +health\/dental$/m);

  floss = created(await life(["task", "add", "Floss", "--project", "health", "--section", "Planning"]));
  assert.equal(floss.sectionId, section.id, "a section by name within the project");
  const elsewhere = await life(["task", "add", "Floss more", "--project", "health/dental", "--section", "Planning"]);
  assert.equal(elsewhere.code, EXIT.rejected, "a section of the parent project is not in health/dental");

  const sectionAsk = await life(["section", "delete", section.id]);
  assert.equal(sectionAsk.code, EXIT.rejected);
  assert.match(sectionAsk.stderr, /pass --tasks delete\|unsection/);
  const unsectioned = await life(["section", "delete", section.id, "--tasks", "unsection"]);
  assert.equal(created(unsectioned, "updated").deletedAt !== null, true);
  assert.equal(json<AnyTask>(await life(["task", "get", floss.id])).sectionId, undefined);

  const projectAsk = await life(["project", "delete", "health"]);
  assert.equal(projectAsk.code, EXIT.rejected);
  assert.equal(json<AnyReceipt>(projectAsk).needs!.field, "contents");
  assert.match(projectAsk.stderr, /pass --contents delete\|inbox/);
});

test("label add, a task carrying the label, and label list", async () => {
  const fitness = created(await life(["label", "add", "fitness", "--color", "green"]));
  assert.equal(fitness.name, "fitness");
  assert.equal(fitness.color, "green");

  const run = created(await life(["task", "add", "Run 5k", "--label", "fitness", "--label", "health", "--due", "2026-09-06"]));
  assert.deepEqual(run.labels, ["fitness", "health"]);

  const labels = json<{ name: string; color?: string }[]>(await life(["label", "list"]));
  assert.deepEqual(labels.map((l) => [l.name, l.color ?? null]).sort(), [["fitness", "green"], ["health", null], ["urgent", null]]);

  const tagged = await life(["task", "list", "--label", "fitness"]);
  assert.deepEqual(ids(json<AnyTask[]>(tagged)), [run.id]);

  const human = await inProcess(["label", "list"], { tty: true });
  assert.match(human.stdout, /^l_[a-z0-9]{10}  @fitness  green$/m);

  const inUse = await life(["label", "delete", "fitness"]);
  assert.equal(inUse.code, EXIT.rejected, "a label in use cannot be deleted");
});

test("filter add and run, saved or ad hoc", async () => {
  const saved = created(await life(["filter", "add", "Health stuff", "@health"]));
  assert.equal(saved.query, "@health");

  const byName = await life(["filter", "run", "Health stuff"]);
  assert.equal(byName.code, EXIT.ok);
  const found = ids(json<AnyTask[]>(byName));
  assert.ok(found.includes(dentist.id) && found.includes(floss.id), "the project's label reaches both");

  const adHoc = await life(["filter", "run", "@health & p2"]);
  assert.deepEqual(ids(json<AnyTask[]>(adHoc)), [dentist.id]);

  const list = json<{ name: string; query: string }[]>(await life(["filter", "list"]));
  assert.deepEqual(list.map((f) => f.name), ["Health stuff"]);

  const bad = await life(["filter", "run", "bogus term"]);
  assert.equal(bad.code, EXIT.rejected);
  assert.match(bad.stderr, /neither a saved filter nor a valid query/);
  assert.equal(bad.stdout, "");

  const invalid = await life(["filter", "add", "Broken", "nonsense term"]);
  assert.equal(invalid.code, EXIT.rejected);
});

// ------------------------------------------------------------------ views

test("today, upcoming, search, and trash", async () => {
  const today = await life(["today", "--date", "2026-09-06"]);
  assert.equal(today.code, EXIT.ok);
  const view = json<{ date: string; timezone: string; overdue: AnyTask[]; due: AnyTask[]; deadlines: AnyTask[]; proposed: AnyTask[] }>(today);
  assert.equal(view.date, "2026-09-06");
  assert.equal(view.timezone, TZ);
  assert.ok(ids(view.due).includes(dentist.id), "due today");
  assert.ok(!ids(view.overdue).includes(rent.id), "rent is done, so no longer overdue");
  assert.ok(view.proposed.some((t) => t.title === "From codex"), "the review queue");

  const upcoming = await life(["upcoming", "3", "--from", "2026-09-05"]);
  assert.equal(upcoming.code, EXIT.ok);
  const days = json<{ from: string; to: string; days: { date: string; tasks: AnyTask[] }[] }>(upcoming);
  assert.equal(days.from, "2026-09-05");
  assert.equal(days.to, "2026-09-07");
  assert.deepEqual(days.days.map((d) => d.date), ["2026-09-05", "2026-09-06", "2026-09-07"]);
  assert.ok(ids(days.days[1]!.tasks).includes(dentist.id));
  assert.deepEqual(days.days[2]!.tasks, [], "empty days are listed");
  const badDays = await life(["upcoming", "lots"]);
  assert.equal(badDays.code, EXIT.usage);
  const zeroDays = await life(["upcoming", "0"]);
  assert.equal(zeroDays.code, EXIT.rejected, "the view's own validation");

  const search = await life(["search", "DENTIST"]);
  assert.deepEqual(ids(json<AnyTask[]>(search)), [dentist.id], "case-insensitive over the title");
  const notes = await life(["search", "crown"]);
  assert.deepEqual(ids(json<AnyTask[]>(notes)), [dentist.id], "over the notes too");
  const empty = await life(["search", "   "]);
  assert.equal(empty.code, EXIT.rejected);

  created(await life(["task", "delete", floss.id]), "updated");
  const trash = await life(["trash"]);
  const bin = json<{ tasks: AnyTask[]; projects: unknown[]; sections: { name: string }[]; labels: unknown[]; filters: unknown[] }>(trash);
  assert.ok(ids(bin.tasks).includes(floss.id));
  assert.deepEqual(bin.sections.map((s) => s.name), ["Planning"]);
  assert.ok(!ids(json<AnyTask[]>(await life(["task", "list", "--all"]))).includes(floss.id), "deleted tasks leave every list");
  assert.ok(ids(json<AnyTask[]>(await life(["task", "list", "--all", "--deleted"]))).includes(floss.id));

  const restored = await life(["task", "restore", floss.id]);
  assert.equal(created(restored, "updated").deletedAt, null);

  const human = await inProcess(["today", "--date", "2026-09-06"], { tty: true });
  assert.match(human.stdout, /^Today 2026-09-06 Sun \(America\/Los_Angeles\)$/m);
  assert.match(human.stdout, /^Due today \(\d+\)$/m);
  assert.match(human.stdout, new RegExp(`^  ${dentist.id}  accepted  p2  Book the dentist +2026-09-06 09:00 +health +@urgent @health`, "m"));
  const upcomingHuman = await inProcess(["upcoming", "2", "--from", "2026-09-06"], { tty: true });
  assert.match(upcomingHuman.stdout, /^Upcoming 2026-09-06 to 2026-09-07$/m);
  assert.match(upcomingHuman.stdout, /^2026-09-07 Mon\n  \(nothing\)$/m);
});

test("relative dates resolve against the injected clock and the effective timezone", async () => {
  // 2026-09-06T20:00Z is 13:00 in Los Angeles and 05:00 on the 7th in Tokyo.
  const clock = fixedClock("2026-09-06T20:00:00Z", TZ);
  const env = { LIFE_ACTOR: "neel" };

  const tomorrow = await inProcess(["task", "add", "Tomorrow thing", "--due", "tomorrow", "--json"], { clock, env });
  assert.deepEqual(created(tomorrow).due, { date: "2026-09-07" });
  const plusTwo = await inProcess(["task", "add", "Two days on", "--due", "+2d", "--deadline", "+1w", "--json"], { clock, env });
  const record = created(plusTwo);
  assert.deepEqual(record.due, { date: "2026-09-08" });
  assert.equal(record.deadline, "2026-09-13");

  const today = await inProcess(["today", "--json"], { clock, env });
  assert.equal(json<{ date: string }>(today).date, "2026-09-06");
  const tokyo = await inProcess(["today", "--tz", "Asia/Tokyo", "--json"], { clock, env });
  const view = json<{ date: string; timezone: string }>(tokyo);
  assert.equal(view.date, "2026-09-07", "--tz moves the clock's day");
  assert.equal(view.timezone, "Asia/Tokyo");

  const timed = await inProcess(["task", "reschedule", record.id, "--due", "today", "--time", "18:30", "--tz", "Asia/Tokyo", "--json"], { clock, env });
  assert.deepEqual(created(timed, "updated").due, { date: "2026-09-07", time: "18:30", timezone: "Asia/Tokyo" }, "the due time takes the --tz zone");

  const listed = await inProcess(["task", "list", "--due", "tomorrow", "--json"], { clock, env });
  assert.deepEqual(ids(json<AnyTask[]>(listed)).sort(), [created(tomorrow).id, record.id].sort(), "both now sit on the 7th");
});

// ------------------------------------------------------------------ flags in depth

test("value flags, repeatable flags, and --no-* clearing flags map onto the library", async () => {
  const task = created(await life(["task", "add", "Flag exercise", "--due", "2026-10-01", "--priority", "3", "--duration", "45"]));

  const cleared = await life(["task", "update", task.id, "--no-due", "--no-priority", "--no-duration", "--notes", "kept"]);
  const after = created(cleared, "updated");
  assert.equal(after.due, null);
  assert.equal(after.priority, undefined);
  assert.equal(after.duration, undefined);
  assert.equal(after.notes, "kept");

  const nothing = await life(["task", "update", task.id]);
  assert.equal(nothing.code, EXIT.usage);
  assert.match(nothing.stderr, /nothing to change/);

  const relabeled = created(await life(["task", "update", task.id, "--label", "health", "--label", "fitness"]), "updated");
  assert.deepEqual(relabeled.labels, ["health", "fitness"]);
  assert.deepEqual(created(await life(["task", "update", task.id, "--no-label"]), "updated").labels, []);

  const timed = created(await life(["task", "reschedule", task.id, "--due", "2026-10-02", "--time", "10:00"]), "updated");
  assert.deepEqual(timed.due, { date: "2026-10-02", time: "10:00", timezone: TZ });
  assert.equal(created(await life(["task", "reschedule", task.id, "--no-due"]), "updated").due, null);

  const noted = created(await life(["task", "note", task.id, "Called them", "--attach", "call log=https://example.com/log", "--actor", "agent:phone"]), "updated");
  assert.equal(noted.comments.length, 1);
  assert.equal(noted.comments[0]!.text, "Called them");
  assert.deepEqual(noted.comments[0]!.attachments, [{ name: "call log", url: "https://example.com/log" }]);
  const badAttach = await life(["task", "note", task.id, "x", "--attach", "nourl"]);
  assert.equal(badAttach.code, EXIT.usage);

  const moved = created(await life(["task", "move", task.id, "--project", "health/dental"]), "updated");
  assert.notEqual(moved.projectId, healthId);
  const back = created(await life(["task", "move", task.id, "--project", "inbox"]), "updated");
  assert.equal(back.projectId, task.projectId);

  const assigned = created(await life(["task", "assign", task.id, "--executor", "agent:codex", "--bucket", "review"]), "updated");
  assert.equal(assigned.executor, "agent:codex");
  assert.equal(assigned.bucket, "review");
  assert.equal(created(await life(["task", "assign", task.id, "--no-bucket"]), "updated").bucket, undefined);

  const started = created(await life(["task", "start", task.id]), "updated");
  assert.equal(started.status, "in_progress");
  const keyed = await life(["task", "cancel", task.id, "--reason", "exercise over", "--key", "cli-cancel-1"]);
  assert.equal(created(keyed, "updated").status, "cancelled");
  const replay = await life(["task", "cancel", task.id, "--reason", "exercise over", "--key", "cli-cancel-1"]);
  assert.deepEqual(json(replay), json(keyed), "the same key returns the same receipt");
  assert.equal(created(await life(["task", "uncomplete", task.id]), "updated").status, "accepted");

  const copy = await life(["task", "duplicate", task.id, "--no-subtasks"]);
  const twin = created(copy);
  assert.equal(twin.title, "Flag exercise");
  assert.notEqual(twin.id, task.id);

  const reordered = await life(["task", "reorder", twin.id, task.id]);
  assert.equal(reordered.code, EXIT.ok);
  const receipts = json<AnyReceipt[]>(reordered);
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((r) => r.ok));
  const mixed = await life(["task", "reorder", twin.id, dentist.id]);
  assert.equal(mixed.code, EXIT.rejected, "different scopes: every receipt is rejected");
});

test("human task lines are aligned columns", async () => {
  const run = await inProcess(["task", "list", "--project", "health", "--with-subprojects"], { tty: true });
  assert.equal(run.code, EXIT.ok, run.stderr);
  const lines = run.stdout.trimEnd().split("\n");
  assert.ok(lines.length >= 2, run.stdout);
  for (const line of lines) assert.match(line, /^t_[a-z0-9]{10}  (accepted|proposed|in_progress)/);
  const statusColumn = new Set(lines.map((line) => line.search(/  (accepted|proposed|in_progress)/)));
  assert.equal(statusColumn.size, 1, "the status column starts at the same offset on every line");
  const titles = lines.map((line) => line.indexOf("  ", 14));
  assert.equal(new Set(titles).size, 1, "so does the title column");
  assert.ok(lines.some((line) => /health\/dental|health/.test(line)), "the project path is shown");

  const asJson = await inProcess(["task", "list", "--project", "health", "--json"], { tty: true });
  assert.ok(Array.isArray(json(asJson)), "--json on a terminal is JSON");
});

// ------------------------------------------------------------------ import and export

test("task import reads a file, dry-run first", async () => {
  const file = join(scratch, "import.json");
  await writeFile(file, JSON.stringify([{ title: "Imported one", due: { date: "2026-11-01" } }, { title: "Imported two", labels: ["health"] }, { title: "Book the dentist" }]));

  const dry = await life(["task", "import", file, "--dry-run"]);
  assert.equal(dry.code, EXIT.duplicate, "a duplicate among the items, none rejected");
  const preview = json<{ dryRun: boolean; created: number; duplicate: number; rejected: number; items: { index: number; outcome: string }[] }>(dry);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.created, 2);
  assert.equal(preview.duplicate, 1);
  assert.deepEqual(ids(json<AnyTask[]>(await life(["task", "list", "--text", "Imported"]))), [], "a dry run persists nothing");

  const human = await inProcess(["task", "import", file, "--dry-run"], { tty: true, env: { LIFE_ACTOR: "import:file" } });
  assert.match(human.stdout, /^Dry run: 2 created, 1 duplicate, 0 rejected of 3\./m);
  assert.match(human.stdout, /#2 +duplicate/);

  const real = await life(["task", "import", file, "--actor", "import:file"]);
  assert.equal(real.code, EXIT.duplicate);
  const result = json<{ dryRun: boolean; created: number }>(real);
  assert.equal(result.dryRun, false);
  assert.equal(result.created, 2);
  const imported = json<AnyTask[]>(await life(["task", "list", "--text", "Imported"]));
  assert.equal(imported.length, 2);
  assert.ok(imported.every((t) => t.status === "proposed" && t.origin.actor === "import:file"), "an import actor lands proposed");

  await writeFile(join(scratch, "bad.json"), "{ not json");
  const bad = await life(["task", "import", join(scratch, "bad.json")]);
  assert.equal(bad.code, EXIT.rejected);
  assert.match(bad.stderr, /cannot read/);
  const missing = await life(["task", "import", join(scratch, "missing.json")]);
  assert.equal(missing.code, EXIT.rejected);
});

test("export writes a file, or JSON to stdout", async () => {
  const file = join(scratch, "export.json");
  const run = await life(["export", file]);
  assert.equal(run.code, EXIT.ok, run.stderr);
  const summary = json<{ file: string; exportedAt: string; tasks: number; projects: number; log: number }>(run);
  assert.equal(summary.file, file);
  const dump = JSON.parse(await readFile(file, "utf8")) as { exportedAt: string; projects: unknown[]; sections: unknown[]; labels: unknown[]; filters: unknown[]; tasks: AnyTask[]; log: unknown[] };
  assert.deepEqual(Object.keys(dump), ["exportedAt", "projects", "sections", "labels", "filters", "tasks", "log"]);
  assert.equal(dump.exportedAt, summary.exportedAt);
  assert.equal(dump.tasks.length, summary.tasks);
  assert.ok(dump.tasks.some((t) => t.id === dentist.id));
  assert.ok(dump.tasks.some((t) => t.deletedAt !== null), "deleted rows are exported");
  assert.equal(dump.log.length, summary.log);
  assert.ok(dump.log.length > 10);

  const human = await inProcess(["export", file], { tty: true });
  assert.match(human.stdout, /^Exported \d+ projects, \d+ sections, \d+ labels, \d+ filters, \d+ tasks, \d+ log to .* \(\d+ bytes\)\.$/m);

  const stdout = await life(["export"]);
  assert.equal(stdout.code, EXIT.ok);
  assert.equal(json<{ tasks: unknown[] }>(stdout).tasks.length, dump.tasks.length);
  const terminal = await inProcess(["export"], { tty: true });
  assert.equal(JSON.parse(terminal.stdout).tasks.length, dump.tasks.length, "a dump is JSON on a terminal too");
});

// ------------------------------------------------------------------ the database

test("an unreachable database exits 3, for reads, writes, and migrate", async () => {
  const read = await life(["task", "list", "--db", UNREACHABLE]);
  assert.equal(read.code, EXIT.database);
  assert.match(read.stderr, /database unavailable/);
  assert.match(read.stderr, /ECONNREFUSED/);

  const write = await life(["task", "add", "Nowhere to go", "--db", UNREACHABLE]);
  assert.equal(write.code, EXIT.database);

  const migrate = await life(["migrate", "--db", UNREACHABLE]);
  assert.equal(migrate.code, EXIT.database, "migrate connects eagerly");
  assert.match(migrate.stderr, /database unavailable/);

  const viaEnv = await life(["today"], { env: { LIFE_DATABASE_URL: UNREACHABLE } });
  assert.equal(viaEnv.code, EXIT.database);
});

// ------------------------------------------------------------------ review findings

test("a missing record is a rejection in JSON with the reason, not a bare null", async () => {
  for (const args of [["task", "get", "t_doesnotexist"], ["task", "history", "t_doesnotexist"]]) {
    const run = await life(args);
    assert.equal(run.code, EXIT.rejected, args.join(" "));
    const receipt = json<AnyReceipt>(run);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.outcome, "rejected");
    assert.deepEqual(receipt.issues, ['task: no task "t_doesnotexist"']);
  }
  const project = await life(["project", "get", "doesnotexist"]);
  assert.equal(project.code, EXIT.rejected);
  assert.deepEqual(json<AnyReceipt>(project).issues, ['project: no project "doesnotexist"']);
  const human = await inProcess(["task", "get", "t_doesnotexist"], { tty: true });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^No task "t_doesnotexist"\.$/m);
});

test("task add --project inbox on an empty database creates the Inbox on first use", async () => {
  const fresh = await createTestDb();
  try {
    const env = { LIFE_DATABASE_URL: `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${fresh.schema}` };
    const run = await life(
      ["task", "add", "Renew car registration", "--project", "inbox", "--actor", "codex", "--evidence", "vault:Areas/Admin.md#2026-09-07", "--reason", "noticed while working"],
      { env },
    );
    const task = created(run);
    assert.equal(task.status, "proposed");
    const inbox = json<{ id: string; system: boolean }>(await life(["project", "get", "inbox"], { env }));
    assert.equal(inbox.system, true);
    assert.equal(task.projectId, inbox.id);
  } finally {
    await fresh.drop();
  }
});
