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
import { COMMANDS, ENV_FILE, EXIT, FILTER_GRAMMAR, commandHelp, describeUrl, groupHelp, main, suggest, topHelp, version, type Envelope, type ErrorCode } from "./cli.ts";

// Every run, spawned or in-process, points at one throwaway schema through a URL whose
// connections set search_path to it; nothing here sees the public schema.
const BIN = fileURLToPath(new URL("../bin/life.js", import.meta.url));
const TZ = "America/Los_Angeles";
const UNREACHABLE = "postgres://life:s3cretpw@127.0.0.1:1/life";

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
async function inProcess(args: string[], opts: { tty?: boolean; stdinTty?: boolean; input?: string; clock?: Clock; env?: Record<string, string | undefined>; db?: string } = {}): Promise<Run> {
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
  const code = await main([...args, "--db", opts.db ?? url], { env, stdin, stdout, stderr, ...(opts.clock ? { clock: opts.clock } : {}) });
  return { code, stdout: out, stderr: err };
}

/** The one JSON object on stdout: parsing the whole stream proves nothing else was printed there. */
function envelope(run: Run): Envelope {
  try {
    return JSON.parse(run.stdout) as Envelope;
  } catch {
    throw new Error(`stdout is not one JSON object (exit ${run.code}): ${JSON.stringify(run.stdout)}\n${run.stderr}`);
  }
}

/** The envelope's `result`, typed by the caller. */
function result<T = Record<string, unknown>>(run: Run): T {
  const env = envelope(run);
  assert.ok("result" in env, `no result in ${run.stdout}\n${run.stderr}`);
  return env.result as T;
}

/** Assert the run failed with this error code and exit code, and return the error. */
function failed(run: Run, code: ErrorCode, exitCode: number): NonNullable<Envelope["error"]> {
  const env = envelope(run);
  assert.equal(run.code, exitCode, `exit ${run.code}: ${run.stdout}\n${run.stderr}`);
  assert.equal(env.exitCode, exitCode);
  assert.equal(env.ok, false);
  assert.ok(env.error, `no error in ${run.stdout}`);
  assert.equal(env.error.code, code, env.error.message);
  assert.ok(Array.isArray(env.error.issues) && env.error.issues.length > 0, "issues is a non-empty list");
  assert.equal(typeof env.error.message, "string");
  return env.error;
}

type AnyReceipt = { ok: boolean; outcome: string; id?: string; version?: number; record?: Record<string, unknown>; issues: string[]; candidates?: Record<string, unknown>[]; needs?: { field: string; options: string[]; message: string } };
type AnyTask = { id: string; title: string; notes: string; status: string; labels: string[]; due: { date: string; time?: string; timezone?: string } | null; deadline: string | null; priority?: number; projectId: string; sectionId?: string; parentId?: string; comments: { text: string; attachments: { name: string; url: string }[] }[]; origin: { actor: string; evidence: string[] }; deletedAt: string | null };

/** Assert a run produced an ok receipt and return the record. */
function created(run: Run, outcome = "created"): AnyTask & Record<string, unknown> {
  const env = envelope(run);
  assert.equal(run.code, EXIT.ok, `exit ${run.code}: ${run.stdout} ${run.stderr}`);
  assert.equal(env.ok, true);
  assert.equal(env.exitCode, EXIT.ok);
  assert.equal(env.error, undefined);
  const receipt = env.result as AnyReceipt;
  assert.equal(receipt.ok, true);
  assert.equal(receipt.outcome, outcome);
  return receipt.record as AnyTask & Record<string, unknown>;
}

const ids = (tasks: { id: string }[]): string[] => tasks.map((t) => t.id);

/** Split a help example into argv the way a shell would: double-quoted strings are one argument. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) words.push(match[1] ?? match[2]!);
  return words;
}

// Fixtures built up across the tests below (node:test runs a file's tests in order).
let healthId: string;
let dentist: AnyTask;
let rent: AnyTask;
let floss: AnyTask;

// ------------------------------------------------------------------ help at every layer

test("help at the top, group, and command layers, through --help, -h, and the help command", async () => {
  const top = await life(["--help"]);
  assert.equal(top.code, EXIT.ok);
  assert.equal(top.stderr, "");
  assert.equal(top.stdout.trimEnd(), topHelp(), "the spawned binary prints the same help the module renders");
  assert.equal((await life(["-h"])).stdout, top.stdout);
  assert.equal((await life(["help"])).stdout, top.stdout);
  assert.equal((await life([])).code, EXIT.usage, "no command at all is a usage error, not help");
  for (const group of ["task", "project", "section", "label", "filter"]) assert.match(top.stdout, new RegExp(`^  life ${group} <command>`, "m"), `the ${group} group is listed`);
  for (const command of ["today", "upcoming", "search", "trash", "export", "migrate", "doctor"]) assert.match(top.stdout, new RegExp(`^  life ${command}\\b`, "m"), `${command} is listed`);
  for (const flag of ["--actor", "--reason", "--evidence", "--key", "--if-version", "--json", "--tz", "--db", "--verbose"]) assert.match(top.stdout, new RegExp(`^  ${flag}\\b`, "m"), `global flag ${flag}`);
  for (const name of ["LIFE_DATABASE_URL", "LIFE_ACTOR", "LIFE_TZ", "LIFE_DEBUG"]) assert.match(top.stdout, new RegExp(`^  ${name} `, "m"), `environment variable ${name}`);
  assert.ok(top.stdout.includes(ENV_FILE), "the .env path is named");
  for (const code of ["0 ", "1 ", "2 ", "3 ", "64 "]) assert.match(top.stdout, new RegExp(`^  ${code}`, "m"), `exit code ${code.trim()}`);
  assert.match(top.stdout, /life help <group>/, "says where to go next");
  assert.match(top.stdout, /life doctor/);
  assert.match(top.stdout, /not_found/, "documents the envelope error codes");

  const group = await life(["task", "--help"]);
  assert.equal(group.code, EXIT.ok);
  assert.equal(group.stdout.trimEnd(), groupHelp("task"));
  assert.equal((await life(["help", "task"])).stdout, group.stdout);
  assert.equal((await life(["task", "-h"])).stdout, group.stdout);
  for (const command of COMMANDS.values()) if (command.group === "task") assert.match(group.stdout, new RegExp(`^  life task ${command.name}\\b.*  \\S`, "m"), `task ${command.name} with a purpose`);
  assert.doesNotMatch(group.stdout, /^  life project /m, "only the group's own commands");

  const command = await life(["task", "add", "--help"]);
  assert.equal(command.code, EXIT.ok);
  assert.equal(command.stdout.trimEnd(), commandHelp(COMMANDS.get("task add")!));
  assert.equal((await life(["help", "task", "add"])).stdout, command.stdout);
  assert.equal((await life(["task", "add", "-h"])).stdout, command.stdout);
  assert.equal((await life(["task", "add", "Some title", "--project", "x", "--help"])).stdout, command.stdout, "--help wins over everything else on the line");
  assert.match(command.stdout, /^positionals:\n  <title>  /m);
  assert.match(command.stdout, /^  --priority <integer> .*One of 1, 2, 3, 4/m, "type and allowed values");
  assert.match(command.stdout, /^  --label <name> .*Repeatable/m, "repeatable flags say so");
  assert.match(command.stdout, /^  --project <ref> .*Default: inbox/m, "defaults are shown");
  assert.match(command.stdout, /^  --status <proposed\|accepted>/m);
  assert.match(command.stdout, /^examples:\n  life task add "Book the dentist"/m);
  assert.match(command.stdout, /^  2   duplicate candidates/m, "the exit codes this command can produce");

  const topLevel = await life(["today", "--help"]);
  assert.equal(topLevel.stdout.trimEnd(), commandHelp(COMMANDS.get("today")!));
  assert.equal((await life(["help", "today"])).stdout, topLevel.stdout);
  assert.match(topLevel.stdout, /^  --date <date>  .*YYYY-MM-DD, today, tomorrow, yesterday, \+Nd, or -Nw/m);
  assert.equal((await life(["help", "doctor"])).code, EXIT.ok);
  assert.match((await life(["help", "filter"])).stdout, /filter grammar/, "the group help carries the query grammar");
  for (const { line } of FILTER_GRAMMAR) assert.ok((await life(["help", "filter"])).stdout.includes(line), "every grammar line");
  assert.match((await life(["task", "list", "--help"])).stdout, /filter grammar/, "and so does task list");

  const structured = await life(["help", "task", "complete", "--json"]);
  const help = result<{ command: string; flags: { name: string; values?: string[]; repeatable: boolean }[]; examples: string[]; exitCodes: { code: number }[]; text: string }>(structured);
  assert.equal(help.command, "task complete");
  assert.deepEqual(help.flags.find((f) => f.name === "subtasks")?.values, ["complete", "leave"]);
  assert.ok(help.examples.length >= 2);
  assert.deepEqual(help.exitCodes.map((e) => e.code), [0, 1, 3, 64]);
  assert.equal(help.text, commandHelp(COMMANDS.get("task complete")!));
});

test("every command's help names all its positionals and flags and shows at least two examples", () => {
  for (const command of COMMANDS.values()) {
    const name = command.group ? `${command.group} ${command.name}` : command.name;
    const text = commandHelp(command);
    assert.match(text, new RegExp(`^usage: life ${name}\\b`, "m"));
    for (const positional of command.positionals) assert.ok(text.includes(`<${positional.name}>`) || text.includes(`[${positional.name}]`), `${name}: positional ${positional.name}`);
    for (const flag of Object.keys(command.flags)) assert.match(text, new RegExp(`^  --${flag}\\b`, "m"), `${name}: flag --${flag}`);
    assert.ok(command.examples.length >= 2, `${name} has ${command.examples.length} examples`);
    for (const example of command.examples) assert.ok(example.startsWith(`life ${name}`), `${name}: example "${example}"`);
    for (const code of command.exits) assert.match(text, new RegExp(`^  ${code} `, "m"), `${name}: exit ${code}`);
    const group = command.group ? groupHelp(command.group) : topHelp();
    assert.match(group, new RegExp(`^  life ${name}\\b`, "m"), `${name} is listed one layer up`);
  }
});

test("--version prints the package version", async () => {
  const run = await life(["--version"]);
  assert.equal(run.code, EXIT.ok);
  assert.equal(run.stdout, `life ${version()}\n`);
  assert.match(run.stdout, /^life \d+\.\d+\.\d+(-\S+)?\n$/);
  assert.equal((await life(["task", "add", "x", "--version"])).stdout, run.stdout, "--version wins wherever it appears");
  const asJson = await life(["--version", "--json"]);
  assert.equal(result<{ version: string }>(asJson).version, version());
  assert.equal(envelope(asJson).command, "version");
});

// ------------------------------------------------------------------ usage errors

test("unknown groups, commands, and flags exit 64, name what was unknown, suggest the closest names, and print that layer's help", async () => {
  const group = await life(["tsk"]);
  const groupError = failed(group, "usage", EXIT.usage);
  assert.match(groupError.message, /unknown command "tsk"; did you mean `life task`\?/);
  assert.match(group.stderr, /^life: unknown command "tsk"/m);
  assert.match(group.stderr, /^groups \(run `life help <group>`/m, "the top-level help follows");

  const command = await life(["task", "ad"]);
  const commandError = failed(command, "usage", EXIT.usage);
  assert.match(commandError.message, /unknown command "task ad"; did you mean `life task add`/);
  assert.match(command.stderr, /^commands \(run `life help task <command>`/m, "the group help follows");
  assert.doesNotMatch(command.stderr, /^groups \(run/m);
  assert.equal(envelope(command).command, "task", "the envelope names the layer that was reached");

  const nothingClose = await life(["task", "zzzz"]);
  assert.match(failed(nothingClose, "usage", EXIT.usage).message, /unknown command "task zzzz"; `life help task` lists the task commands/);

  const flag = await life(["task", "add", "x", "--priorty", "2"]);
  const flagError = failed(flag, "usage", EXIT.usage);
  assert.match(flagError.message, /unknown flag --priorty for `life task add`; did you mean --priority\?/);
  assert.match(flagError.hint!, /life task add --help/);
  assert.match(flag.stderr, /^usage: life task add <title>/m, "the command help follows");
  assert.equal(envelope(flag).command, "task add");

  const early = await life(["--bogus", "task", "list"]);
  assert.match(failed(early, "usage", EXIT.usage).message, /unknown flag --bogus before the command/);

  const inGroup = await life(["task", "--all", "list"]);
  assert.match(failed(inGroup, "usage", EXIT.usage).message, /unknown flag --all before the task command/);

  assert.deepEqual(suggest("proect", ["task", "project", "section"]), ["project"]);
  assert.deepEqual(suggest("comp", ["complete", "cancel", "uncomplete"]), ["complete", "uncomplete"], "prefix matches come first");
  assert.deepEqual(suggest("qqqqqq", ["task", "project"]), []);
});

test("missing and extra positionals, bad values, and missing commands are usage errors that name the problem", async () => {
  const none = await life([]);
  assert.match(failed(none, "usage", EXIT.usage).message, /a command is required/);
  assert.match(none.stderr, /^groups \(run/m);

  const group = await life(["task"]);
  const groupError = failed(group, "usage", EXIT.usage);
  assert.match(groupError.message, /life task: a command is required/);
  assert.match(groupError.hint!, /life help task/);

  const missing = await life(["task", "add"]);
  assert.match(failed(missing, "usage", EXIT.usage).message, /life task add: missing <title>: The task title\./);

  const second = await life(["task", "note", "t_0000000000"]);
  assert.match(failed(second, "usage", EXIT.usage).message, /life task note: missing <text>/);

  const extra = await life(["today", "extra"]);
  assert.match(failed(extra, "usage", EXIT.usage).message, /unexpected argument "extra"/);

  const value = await life(["task", "add", "x", "--priority"]);
  assert.match(failed(value, "usage", EXIT.usage).message, /--priority needs a value \(integer\)/);

  const choice = await life(["task", "add", "x", "--priority", "9"]);
  const choiceError = failed(choice, "usage", EXIT.usage);
  assert.match(choiceError.message, /--priority expects one of 1, 2, 3, 4, got "9"/);
  assert.equal(choiceError.hint, "pass --priority 1|2|3|4");

  const integer = await life(["task", "add", "x", "--duration", "long"]);
  assert.match(failed(integer, "usage", EXIT.usage).message, /--duration expects an integer/);

  const time = await life(["task", "add", "x", "--time", "09:00"]);
  const timeError = failed(time, "usage", EXIT.usage);
  assert.match(timeError.message, /--time needs --due/);
  assert.match(timeError.hint!, /--due <date> --time HH:MM/);

  const reschedule = await life(["task", "reschedule", "t_0000000000"]);
  assert.match(failed(reschedule, "usage", EXIT.usage).message, /pass --due <date> or --no-due/);

  const both = await life(["task", "update", "t_0000000000", "--due", "2026-09-06", "--no-due"]);
  assert.match(failed(both, "usage", EXIT.usage).message, /--due and --no-due exclude each other/);

  const tz = await life(["today", "--tz", "Mars/Olympus"]);
  const tzError = failed(tz, "usage", EXIT.usage);
  assert.match(tzError.message, /--tz: unknown timezone "Mars\/Olympus"/);
  assert.match(tzError.hint!, /America\/Los_Angeles/);

  const days = await life(["upcoming", "lots"]);
  assert.match(failed(days, "usage", EXIT.usage).message, /days must be a whole number/);
});

test("the actor comes from --actor, then LIFE_ACTOR, then the terminal; a missing one names both", async () => {
  const anonymous = await life(["task", "add", "Nobody's task"], { env: { LIFE_ACTOR: undefined } });
  const error = failed(anonymous, "usage", EXIT.usage);
  assert.match(error.message, /--actor is required/);
  assert.match(error.message, /LIFE_ACTOR/);
  assert.match(error.hint!, /--actor codex/);
  assert.match(error.hint!, /LIFE_ACTOR/);
  assert.match(anonymous.stderr, /--actor is required/);

  const read = await life(["task", "list"], { env: { LIFE_ACTOR: undefined } });
  assert.equal(read.code, EXIT.ok, "a read needs no actor");
  assert.deepEqual(result(read), []);

  const fromEnv = created(await life(["task", "add", "From the environment"]));
  assert.equal(fromEnv.origin.actor, "neel");
  assert.equal(fromEnv.status, "accepted", "neel's tasks land accepted");

  const fromFlag = created(await life(["task", "add", "From codex", "--actor", "codex", "--reason", "seen in notes", "--evidence", "vault:a", "--evidence", "vault:b"], { env: { LIFE_ACTOR: undefined } }));
  assert.equal(fromFlag.origin.actor, "codex");
  assert.equal(fromFlag.status, "proposed", "another actor's tasks land proposed");
  assert.deepEqual(fromFlag.origin.evidence, ["vault:a", "vault:b"], "--evidence repeats");
  assert.equal((fromFlag.origin as { reason?: string }).reason, "seen in notes");

  const terminal = await inProcess(["task", "add", "From a terminal", "--json"], { tty: true, env: { LIFE_ACTOR: undefined } });
  assert.equal(created(terminal).origin.actor, "neel", "a terminal defaults to neel");

  const notTerminal = await inProcess(["task", "add", "Not a terminal"], { tty: false, env: { LIFE_ACTOR: undefined } });
  assert.equal(notTerminal.code, EXIT.usage);

  const bad = await life(["task", "add", "Bad actor", "--actor", "somebody"]);
  const badError = failed(bad, "rejected", EXIT.rejected);
  assert.match(badError.issues.join("\n"), /^actor: /m, "the library's issue keeps its field path");
  assert.match(badError.hint!, /--actor neel, codex, agent:<name>, or import:<provider>, or set LIFE_ACTOR/);
});

// ------------------------------------------------------------------ the envelope

test("add, list, get, complete, history round trip through the JSON envelope", async () => {
  const health = created(await life(["project", "add", "Health", "--label", "health"]));
  healthId = health.id;

  const add = await life(["task", "add", "Book the dentist", "--project", "health", "--due", "2026-09-06", "--time", "09:00", "--priority", "2", "--label", "urgent", "--notes", "Ask about the crown", "--json"]);
  const env = envelope(add);
  assert.deepEqual(Object.keys(env), ["ok", "command", "exitCode", "result"], "the envelope's keys, in order");
  assert.equal(env.command, "task add");
  dentist = created(add);
  assert.match(dentist.id, /^t_[a-z0-9]{10}$/);
  assert.equal(dentist.title, "Book the dentist");
  assert.equal(dentist.projectId, healthId);
  assert.deepEqual(dentist.due, { date: "2026-09-06", time: "09:00", timezone: TZ }, "a time carries the effective timezone");
  assert.equal(dentist.priority, 2);
  assert.deepEqual(dentist.labels, ["urgent"]);
  assert.equal(dentist.notes, "Ask about the crown");
  assert.equal(add.stderr, "", "nothing on stderr for a success");

  rent = created(await life(["task", "add", "Pay rent", "--due=2026-09-01", "--deadline", "2026-09-03"]));
  assert.deepEqual(rent.due, { date: "2026-09-01" }, "--flag=value works");
  assert.equal(rent.deadline, "2026-09-03");

  const list = await life(["task", "list"]);
  assert.equal(list.code, EXIT.ok);
  const listed = result<AnyTask[]>(list);
  assert.ok(Array.isArray(listed), "JSON is the default when stdout is not a terminal; result is the library's list");
  assert.deepEqual(ids(listed).slice(0, 2), [rent.id, dentist.id], "sorted like list: by due date");
  assert.equal((await life(["task", "list"])).stdout, list.stdout, "identical inputs give identical output");

  const byLabel = await life(["task", "list", "--label", "health", "--json"]);
  assert.deepEqual(ids(result<AnyTask[]>(byLabel)), [dentist.id], "the project's label reaches its tasks");
  const byProject = await life(["task", "list", "--project", "health", "--status", "accepted,in_progress"]);
  assert.deepEqual(ids(result<AnyTask[]>(byProject)), [dentist.id]);
  const byFilter = await life(["task", "list", "--filter", "due before: 2026-09-05"]);
  assert.deepEqual(ids(result<AnyTask[]>(byFilter)), [rent.id]);

  const get = await life(["task", "get", dentist.id]);
  assert.equal(get.code, EXIT.ok);
  const record = result<AnyTask>(get);
  assert.equal(record.id, dentist.id);
  assert.deepEqual(record, dentist, "the full record, untouched");

  const complete = await life(["task", "complete", rent.id, "--json"]);
  const done = created(complete, "updated");
  assert.equal(done.status, "done");
  assert.equal(result<AnyReceipt>(complete).version, 2);

  const history = await life(["task", "history", rent.id]);
  const entries = result<{ op: string; actor: string; patch: Record<string, { from: unknown; to: unknown }> }[]>(history);
  assert.deepEqual(entries.map((e) => e.op), ["task.add", "task.complete"]);
  assert.equal(entries[1]!.patch.status!.to, "done");
});

test("a missing record is a not_found error with a hint, never a bare null or an empty success", async () => {
  for (const args of [["task", "get", "t_0000000000"], ["task", "history", "t_0000000000"]]) {
    const run = await life(args);
    const error = failed(run, "not_found", EXIT.rejected);
    assert.equal(error.message, 'task: no task "t_0000000000"');
    assert.deepEqual(error.issues, ['task: no task "t_0000000000"']);
    assert.match(error.hint!, /life task list --all|life search/);
    assert.equal("result" in envelope(run), false, "no result when nothing was found");
  }
  const project = await life(["project", "get", "doesnotexist"]);
  const error = failed(project, "not_found", EXIT.rejected);
  assert.equal(error.message, 'project: no project "doesnotexist"');
  assert.match(error.hint!, /life project tree/);

  const mutation = await life(["task", "complete", "t_0000000000"]);
  const rejected = failed(mutation, "not_found", EXIT.rejected);
  assert.deepEqual(result<AnyReceipt>(mutation).issues, ['task: no task "t_0000000000"'], "the rejected receipt is still the result");
  assert.match(rejected.hint!, /life task list --all/);

  const human = await inProcess(["task", "get", "t_0000000000"], { tty: true });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^No task "t_0000000000"\.$/m);
});

test("a similar title exits 2 as a duplicate error with the candidates and --allow-duplicate in the hint", async () => {
  const dup = await life(["task", "add", "Book the dentist"]);
  const error = failed(dup, "duplicate", EXIT.duplicate);
  const receipt = result<AnyReceipt>(dup);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.outcome, "duplicate");
  assert.deepEqual(receipt.candidates!.map((c) => c.id), [dentist.id], "the receipt is the library's, untouched");
  assert.deepEqual(error.candidates!.map((c) => c.id), [dentist.id], "and the error carries the candidates too");
  assert.match(error.hint!, /--allow-duplicate/);
  assert.ok(error.hint!.includes(`${dentist.id} "Book the dentist"`), "candidate ids and titles in the hint");
  assert.match(dup.stderr, /hint: pass --allow-duplicate/);

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

test("rejected input exits 1 with the issues, their field paths, and a hint that fits the problem", async () => {
  const badDate = await life(["task", "add", "When?", "--due", "someday"]);
  const dateError = failed(badDate, "rejected", EXIT.rejected);
  assert.deepEqual(dateError.issues, ["due.date: Use YYYY-MM-DD"], "a validation issue keeps its field path");
  assert.match(dateError.hint!, /life task add --help/);
  assert.equal(result<AnyReceipt>(badDate).outcome, "rejected", "the library's receipt is the result");

  const badTime = await life(["task", "add", "When?", "--due", "today", "--time", "9am"]);
  assert.deepEqual(failed(badTime, "rejected", EXIT.rejected).issues, ["due.time: Use HH:MM"]);

  const project = await life(["task", "add", "Nowhere", "--project", "nope"]);
  const projectError = failed(project, "rejected", EXIT.rejected);
  assert.deepEqual(projectError.issues, ['project: no project "nope"']);
  assert.match(projectError.hint!, /run `life project tree`/);

  const section = await life(["task", "add", "Nowhere", "--project", "health", "--section", "Nope"]);
  const sectionError = failed(section, "rejected", EXIT.rejected);
  assert.match(sectionError.issues[0]!, /^section: no section "Nope" in project "health"/);
  assert.match(sectionError.hint!, /run `life project tree`/);

  const listProject = await life(["task", "list", "--project", "nope"]);
  assert.match(failed(listProject, "rejected", EXIT.rejected).hint!, /life project tree/, "a thrown lookup failure gets the same hint");

  const filter = await life(["task", "list", "--filter", "bogus term"]);
  const filterError = failed(filter, "rejected", EXIT.rejected);
  assert.equal(filterError.message, 'list: filter: Unknown filter term "bogus term"');
  assert.match(filterError.hint!, /^filter grammar, what: p1 \| p2/, "quotes the grammar line that applies");
  assert.match(filterError.hint!, /life help filter/);
  const badDue = await life(["filter", "run", "due: someday"]);
  assert.match(failed(badDue, "rejected", EXIT.rejected).hint!, /^filter grammar, dates: /);
  const badStatus = await life(["filter", "add", "Broken", "status: maybe"]);
  assert.match(failed(badStatus, "rejected", EXIT.rejected).hint!, /^filter grammar, status: /);
  const unclosed = await life(["filter", "run", "(today | overdue"]);
  assert.match(failed(unclosed, "rejected", EXIT.rejected).hint!, /^filter grammar, combine: /);
  const label = await life(["filter", "run", "@nope-label"]);
  assert.equal(label.code, EXIT.ok, "an unknown label in a query matches nothing rather than failing");

  const cancel = await inProcess(["task", "cancel", dentist.id], { tty: true });
  assert.equal(cancel.code, EXIT.rejected);
  assert.match(cancel.stdout, /^rejected t_/m);
  assert.match(cancel.stdout, /- reason: cancel needs a reason/);
  assert.match(cancel.stdout, /pass --reason "why"/);

  const stale = await life(["task", "update", dentist.id, "--title", "Stale", "--if-version", "99"]);
  const staleError = failed(stale, "rejected", EXIT.rejected);
  assert.match(staleError.issues[0]!, /^version: expected 99/);
  assert.match(staleError.hint!, /--if-version/);
});

test("a needs rejection is a needs error naming the flag and values; on a terminal it becomes a question", async () => {
  const parent = created(await life(["task", "add", "Parent with children"]));
  const child = created(await life(["task", "add", "First child", "--parent", parent.id]));

  const asked = await life(["task", "complete", parent.id]);
  const error = failed(asked, "needs", EXIT.rejected);
  assert.deepEqual(error.needs, { field: "subtasks", options: ["complete", "leave"], message: error.needs!.message });
  assert.equal(error.hint, "pass --subtasks complete|leave");
  assert.match(error.message, /1 open sub-task/);
  const receipt = result<AnyReceipt>(asked);
  assert.equal(receipt.outcome, "rejected");
  assert.deepEqual(receipt.needs, error.needs, "the receipt is passed through as the library returns it");
  assert.match(asked.stderr, /pass --subtasks complete\|leave/);

  const human = await inProcess(["task", "complete", parent.id], { tty: true, stdinTty: false });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^rejected t_/m, "stdout is a terminal but stdin is not: no question");
  assert.match(human.stdout, /pass --subtasks complete\|leave/);

  const wrong = await life(["task", "complete", parent.id, "--subtasks", "maybe"]);
  assert.match(failed(wrong, "usage", EXIT.usage).message, /--subtasks expects one of complete, leave/);

  const chosen = await life(["task", "complete", parent.id, "--subtasks", "complete"]);
  assert.equal(created(chosen, "updated").status, "done");
  assert.equal(result<AnyTask>(await life(["task", "get", child.id])).status, "done", "the sub-task was completed too");

  const deleted = await life(["task", "delete", parent.id]);
  assert.equal(created(deleted, "updated").deletedAt !== null, true, "nothing open below: no question");

  const parent2 = created(await life(["task", "add", "Parent asked on a terminal"]));
  const child2 = created(await life(["task", "add", "Second child", "--parent", parent2.id]));

  const unanswered = await inProcess(["task", "complete", parent2.id], { tty: true });
  assert.equal(unanswered.code, EXIT.rejected, "input ended without an answer");
  assert.match(unanswered.stdout, /subtasks \[complete\/leave\]:/);
  assert.match(unanswered.stdout, /pass --subtasks complete\|leave/);

  const wrongAnswer = await inProcess(["task", "complete", parent2.id], { tty: true, input: "maybe\n" });
  assert.equal(wrongAnswer.code, EXIT.rejected);
  assert.equal(result<AnyTask>(await life(["task", "get", parent2.id])).status, "accepted");

  const answered = await inProcess(["task", "complete", parent2.id], { tty: true, input: "leave\n" });
  assert.equal(answered.code, EXIT.ok, answered.stdout);
  assert.match(answered.stdout, /subtasks \[complete\/leave\]:/);
  assert.match(answered.stdout, /updated t_[a-z0-9]{10} v2  Parent asked on a terminal/);
  assert.equal(result<AnyTask>(await life(["task", "get", parent2.id])).status, "done");
  assert.equal(result<AnyTask>(await life(["task", "get", child2.id])).status, "accepted", "leave left the child open");

  const jsonOnTerminal = await inProcess(["task", "delete", parent2.id, "--json"], { tty: true, input: "delete\n" });
  assert.equal(failed(jsonOnTerminal, "needs", EXIT.rejected).needs!.field, "subtasks", "--json never asks");
});

// ------------------------------------------------------------------ projects, sections, labels, filters

test("project add and tree, sections, and the contents question on delete", async () => {
  const dental = created(await life(["project", "add", "Dental", "--parent", "health", "--color", "blue"]));
  assert.equal(dental.parentId, healthId);
  assert.equal(dental.slug, "dental");

  const tree = await life(["project", "tree"]);
  type Node = { project: { slug: string; system: boolean }; sections: { name: string }[]; children: Node[] };
  const nodes = result<Node[]>(tree);
  assert.deepEqual(nodes.map((n) => n.project.slug), ["inbox", "health"]);
  assert.equal(nodes[0]!.project.system, true);
  assert.deepEqual(nodes[1]!.children.map((n) => n.project.slug), ["dental"]);

  const section = created(await life(["section", "add", "health", "Plan"]));
  assert.equal(section.projectId, healthId);
  const sections = await life(["section", "list", "health"]);
  assert.deepEqual(result<{ id: string; name: string }[]>(sections).map((s) => s.name), ["Plan"]);
  const renamed = await life(["section", "update", section.id, "--name", "Planning"]);
  assert.equal(created(renamed, "updated").name, "Planning");
  const noProject = await life(["section", "list", "nope"]);
  assert.equal(failed(noProject, "not_found", EXIT.rejected).message, 'project: no project "nope"');

  const human = await inProcess(["project", "tree"], { tty: true });
  assert.equal(human.code, EXIT.ok);
  const lines = human.stdout.trimEnd().split("\n");
  assert.match(lines[0]!, /^Inbox +inbox +p_/);
  assert.match(lines[1]!, /^Health +health +p_[a-z0-9]{10} +@health/);
  assert.match(lines[2]!, /^  - Planning +s_/, "sections sit under their project");
  assert.match(lines[3]!, /^  Dental +dental +p_/, "sub-projects are indented");

  const got = await life(["project", "get", "health/dental"]);
  assert.equal(result<{ id: string }>(got).id, dental.id);
  const detail = await inProcess(["project", "get", "health/dental"], { tty: true });
  assert.match(detail.stdout, /^path +health\/dental$/m);

  floss = created(await life(["task", "add", "Floss", "--project", "health", "--section", "Planning"]));
  assert.equal(floss.sectionId, section.id, "a section by name within the project");
  const elsewhere = await life(["task", "add", "Floss more", "--project", "health/dental", "--section", "Planning"]);
  assert.equal(elsewhere.code, EXIT.rejected, "a section of the parent project is not in health/dental");

  const sectionAsk = await life(["section", "delete", section.id]);
  assert.equal(failed(sectionAsk, "needs", EXIT.rejected).hint, "pass --tasks delete|unsection");
  const unsectioned = await life(["section", "delete", section.id, "--tasks", "unsection"]);
  assert.equal(created(unsectioned, "updated").deletedAt !== null, true);
  assert.equal(result<AnyTask>(await life(["task", "get", floss.id])).sectionId, undefined);

  const projectAsk = await life(["project", "delete", "health"]);
  const ask = failed(projectAsk, "needs", EXIT.rejected);
  assert.equal(ask.needs!.field, "contents");
  assert.equal(ask.hint, "pass --contents delete|inbox");
});

test("label add, a task carrying the label, and label list", async () => {
  const fitness = created(await life(["label", "add", "fitness", "--color", "green"]));
  assert.equal(fitness.name, "fitness");
  assert.equal(fitness.color, "green");

  const run = created(await life(["task", "add", "Run 5k", "--label", "fitness", "--label", "health", "--due", "2026-09-06"]));
  assert.deepEqual(run.labels, ["fitness", "health"]);

  const labels = result<{ name: string; color?: string }[]>(await life(["label", "list"]));
  assert.deepEqual(labels.map((l) => [l.name, l.color ?? null]).sort(), [["fitness", "green"], ["health", null], ["urgent", null]]);

  const tagged = await life(["task", "list", "--label", "fitness"]);
  assert.deepEqual(ids(result<AnyTask[]>(tagged)), [run.id]);

  const human = await inProcess(["label", "list"], { tty: true });
  assert.match(human.stdout, /^l_[a-z0-9]{10}  @fitness  green$/m);

  const inUse = await life(["label", "delete", "fitness"]);
  assert.equal(inUse.code, EXIT.rejected, "a label in use cannot be deleted");
  const unknown = await life(["label", "delete", "nolabel"]);
  assert.match(failed(unknown, "not_found", EXIT.rejected).hint!, /life label list/);
});

test("filter add and run, saved or ad hoc", async () => {
  const saved = created(await life(["filter", "add", "Health stuff", "@health"]));
  assert.equal(saved.query, "@health");

  const byName = await life(["filter", "run", "Health stuff"]);
  assert.equal(byName.code, EXIT.ok);
  const found = ids(result<AnyTask[]>(byName));
  assert.ok(found.includes(dentist.id) && found.includes(floss.id), "the project's label reaches both");

  const adHoc = await life(["filter", "run", "@health & p2"]);
  assert.deepEqual(ids(result<AnyTask[]>(adHoc)), [dentist.id]);

  const list = result<{ name: string; query: string }[]>(await life(["filter", "list"]));
  assert.deepEqual(list.map((f) => f.name), ["Health stuff"]);

  const bad = await life(["filter", "run", "bogus term"]);
  const error = failed(bad, "rejected", EXIT.rejected);
  assert.match(error.message, /neither a saved filter nor a valid query/);
  assert.match(bad.stderr, /neither a saved filter nor a valid query/);

  const invalid = await life(["filter", "add", "Broken", "nonsense term"]);
  assert.equal(invalid.code, EXIT.rejected);
  const missing = await life(["filter", "delete", "No such filter"]);
  assert.match(failed(missing, "not_found", EXIT.rejected).hint!, /life filter list/);
});

// ------------------------------------------------------------------ views

test("today, upcoming, search, and trash", async () => {
  const today = await life(["today", "--date", "2026-09-06"]);
  assert.equal(envelope(today).command, "today");
  const view = result<{ date: string; timezone: string; overdue: AnyTask[]; due: AnyTask[]; deadlines: AnyTask[]; proposed: AnyTask[] }>(today);
  assert.equal(view.date, "2026-09-06");
  assert.equal(view.timezone, TZ);
  assert.ok(ids(view.due).includes(dentist.id), "due today");
  assert.ok(!ids(view.overdue).includes(rent.id), "rent is done, so no longer overdue");
  assert.ok(view.proposed.some((t) => t.title === "From codex"), "the review queue");

  const upcoming = await life(["upcoming", "3", "--from", "2026-09-05"]);
  const days = result<{ from: string; to: string; days: { date: string; tasks: AnyTask[] }[] }>(upcoming);
  assert.equal(days.from, "2026-09-05");
  assert.equal(days.to, "2026-09-07");
  assert.deepEqual(days.days.map((d) => d.date), ["2026-09-05", "2026-09-06", "2026-09-07"]);
  assert.ok(ids(days.days[1]!.tasks).includes(dentist.id));
  assert.deepEqual(days.days[2]!.tasks, [], "empty days are listed");
  const zeroDays = await life(["upcoming", "0"]);
  assert.match(failed(zeroDays, "rejected", EXIT.rejected).message, /upcoming: days: expected an integer from 1 to 366/, "the view's own validation");

  const search = await life(["search", "DENTIST"]);
  assert.deepEqual(ids(result<AnyTask[]>(search)), [dentist.id], "case-insensitive over the title");
  const notes = await life(["search", "crown"]);
  assert.deepEqual(ids(result<AnyTask[]>(notes)), [dentist.id], "over the notes too");
  const empty = await life(["search", "   "]);
  assert.equal(failed(empty, "rejected", EXIT.rejected).message, "search: text is required");

  created(await life(["task", "delete", floss.id]), "updated");
  const trash = await life(["trash"]);
  const bin = result<{ tasks: AnyTask[]; projects: unknown[]; sections: { name: string }[]; labels: unknown[]; filters: unknown[] }>(trash);
  assert.ok(ids(bin.tasks).includes(floss.id));
  assert.deepEqual(bin.sections.map((s) => s.name), ["Planning"]);
  assert.ok(!ids(result<AnyTask[]>(await life(["task", "list", "--all"]))).includes(floss.id), "deleted tasks leave every list");
  assert.ok(ids(result<AnyTask[]>(await life(["task", "list", "--all", "--deleted"]))).includes(floss.id));

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

test("relative dates resolve against the injected clock and the effective timezone; a bad LIFE_TZ is a warning", async () => {
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
  assert.equal(result<{ date: string }>(today).date, "2026-09-06");
  const tokyo = await inProcess(["today", "--tz", "Asia/Tokyo", "--json"], { clock, env });
  const view = result<{ date: string; timezone: string }>(tokyo);
  assert.equal(view.date, "2026-09-07", "--tz moves the clock's day");
  assert.equal(view.timezone, "Asia/Tokyo");

  const timed = await inProcess(["task", "reschedule", record.id, "--due", "today", "--time", "18:30", "--tz", "Asia/Tokyo", "--json"], { clock, env });
  assert.deepEqual(created(timed, "updated").due, { date: "2026-09-07", time: "18:30", timezone: "Asia/Tokyo" }, "the due time takes the --tz zone");

  const listed = await inProcess(["task", "list", "--due", "tomorrow", "--json"], { clock, env });
  assert.deepEqual(ids(result<AnyTask[]>(listed)).sort(), [created(tomorrow).id, record.id].sort(), "both now sit on the 7th");

  const warned = await life(["today"], { env: { LIFE_TZ: "Mars/Olympus" } });
  assert.equal(warned.code, EXIT.ok);
  assert.match(envelope(warned).warnings![0]!, /LIFE_TZ="Mars\/Olympus" is not an IANA timezone/);
  const warnedHuman = await inProcess(["today"], { tty: true, env: { LIFE_TZ: "Mars/Olympus" } });
  assert.match(warnedHuman.stderr, /^life: warning: LIFE_TZ=/m);
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
  assert.match(failed(nothing, "usage", EXIT.usage).message, /nothing to change/);
  assert.match(nothing.stderr, /^usage: life task update <id>/m, "the command's help follows");

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
  assert.match(failed(badAttach, "usage", EXIT.usage).hint!, /--attach "call log=/);

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
  assert.deepEqual(envelope(replay), envelope(keyed), "the same key returns the same receipt");
  assert.equal(created(await life(["task", "uncomplete", task.id]), "updated").status, "accepted");

  const copy = await life(["task", "duplicate", task.id, "--no-subtasks"]);
  const twin = created(copy);
  assert.equal(twin.title, "Flag exercise");
  assert.notEqual(twin.id, task.id);

  const reordered = await life(["task", "reorder", twin.id, task.id]);
  assert.equal(reordered.code, EXIT.ok);
  const receipts = result<AnyReceipt[]>(reordered);
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((r) => r.ok));
  const mixed = await life(["task", "reorder", twin.id, dentist.id]);
  const mixedError = failed(mixed, "rejected", EXIT.rejected);
  assert.match(mixedError.message, /2 of 2 rejected/, "different scopes: every receipt is rejected");
  assert.equal(result<AnyReceipt[]>(mixed).length, 2);
});

test("human mode: every success line carries the id, and task lines are aligned columns", async () => {
  const added = await inProcess(["task", "add", "Human mode task"], { tty: true });
  assert.equal(added.code, EXIT.ok, added.stderr);
  assert.match(added.stdout, /^created t_[a-z0-9]{10} v1  Human mode task$/m);
  const id = /t_[a-z0-9]{10}/.exec(added.stdout)![0];
  const completed = await inProcess(["task", "complete", id], { tty: true });
  assert.match(completed.stdout, new RegExp(`^updated ${id} v2  Human mode task$`, "m"));
  const project = await inProcess(["project", "add", "Human project"], { tty: true });
  assert.match(project.stdout, /^created p_[a-z0-9]{10} v1  Human project \(human-project\)$/m);
  const label = await inProcess(["label", "add", "human"], { tty: true });
  assert.match(label.stdout, /^created l_[a-z0-9]{10} v1  human$/m);
  const detail = await inProcess(["task", "get", id], { tty: true });
  assert.match(detail.stdout, new RegExp(`^${id}  done  Human mode task$`, "m"));

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
  assert.ok(Array.isArray(result(asJson)), "--json on a terminal is the envelope");
});

// ------------------------------------------------------------------ import and export

test("task import reads a file, dry-run first", async () => {
  const file = join(scratch, "import.json");
  await writeFile(file, JSON.stringify([{ title: "Imported one", due: { date: "2026-11-01" } }, { title: "Imported two", labels: ["health"] }, { title: "Book the dentist" }]));

  const dry = await life(["task", "import", file, "--dry-run"]);
  const dryError = failed(dry, "duplicate", EXIT.duplicate);
  assert.match(dryError.message, /0 rejected, 1 duplicate of 3 items \(dry run\)/);
  const preview = result<{ dryRun: boolean; created: number; duplicate: number; rejected: number; items: { index: number; outcome: string }[] }>(dry);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.created, 2);
  assert.equal(preview.duplicate, 1);
  assert.deepEqual(ids(result<AnyTask[]>(await life(["task", "list", "--text", "Imported"]))), [], "a dry run persists nothing");

  const human = await inProcess(["task", "import", file, "--dry-run"], { tty: true, env: { LIFE_ACTOR: "import:file" } });
  assert.match(human.stdout, /^Dry run: 2 created, 1 duplicate, 0 rejected of 3\./m);
  assert.match(human.stdout, /#2 +duplicate/);

  const real = await life(["task", "import", file, "--actor", "import:file"]);
  assert.equal(real.code, EXIT.duplicate);
  const outcome = result<{ dryRun: boolean; created: number }>(real);
  assert.equal(outcome.dryRun, false);
  assert.equal(outcome.created, 2);
  const imported = result<AnyTask[]>(await life(["task", "list", "--text", "Imported"]));
  assert.equal(imported.length, 2);
  assert.ok(imported.every((t) => t.status === "proposed" && t.origin.actor === "import:file"), "an import actor lands proposed");
  const another = join(scratch, "import-more.json");
  await writeFile(another, JSON.stringify([{ title: "Imported three" }]));
  const humanReal = await inProcess(["task", "import", another, "--actor", "import:file"], { tty: true });
  assert.match(humanReal.stdout, /^1 created, 0 duplicate, 0 rejected of 1\.\n  #0 +created +t_[a-z0-9]{10}$/m, "every imported item shows its id");

  await writeFile(join(scratch, "bad.json"), "{ not json");
  const bad = await life(["task", "import", join(scratch, "bad.json")]);
  assert.match(failed(bad, "rejected", EXIT.rejected).message, /import: cannot read/);
  const missing = await life(["task", "import", join(scratch, "missing.json")]);
  assert.equal(missing.code, EXIT.rejected);
});

test("export writes a file, or JSON to stdout", async () => {
  const file = join(scratch, "export.json");
  const run = await life(["export", file]);
  assert.equal(run.code, EXIT.ok, run.stderr);
  const summary = result<{ file: string; exportedAt: string; tasks: number; projects: number; log: number }>(run);
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
  assert.equal(result<{ tasks: unknown[] }>(stdout).tasks.length, dump.tasks.length, "the dump is the envelope's result");
  const terminal = await inProcess(["export"], { tty: true });
  assert.equal(JSON.parse(terminal.stdout).tasks.length, dump.tasks.length, "a dump is JSON on a terminal too");
});

// ------------------------------------------------------------------ the database

test("an unreachable database exits 3 as db_unavailable, naming the variable, the host without the password, and life doctor", async () => {
  const read = await life(["task", "list", "--db", UNREACHABLE]);
  const error = failed(read, "db_unavailable", EXIT.database);
  assert.match(error.message, /^database unavailable: .*ECONNREFUSED/);
  assert.equal(error.hint, "read LIFE_DATABASE_URL from --db; tried postgres://life@127.0.0.1:1/life; run `life doctor`");
  assert.ok(!read.stdout.includes("s3cretpw") && !read.stderr.includes("s3cretpw"), "the password is never printed");
  assert.match(read.stderr, /database unavailable/);

  const write = await life(["task", "add", "Nowhere to go", "--db", UNREACHABLE]);
  assert.equal(failed(write, "db_unavailable", EXIT.database).code, "db_unavailable");

  const migrate = await life(["migrate", "--db", UNREACHABLE]);
  assert.equal(failed(migrate, "db_unavailable", EXIT.database).message.includes("ECONNREFUSED"), true, "migrate connects eagerly");

  const viaEnv = await life(["today"], { env: { LIFE_DATABASE_URL: UNREACHABLE } });
  assert.match(failed(viaEnv, "db_unavailable", EXIT.database).hint!, /^read LIFE_DATABASE_URL from LIFE_DATABASE_URL in the environment; tried postgres:\/\/life@127\.0\.0\.1:1\/life/);

  assert.equal(describeUrl("postgres://u:p@h:5/d?x=1"), "postgres://u@h:5/d");
  assert.equal(describeUrl("nonsense"), "(not a parseable URL)");
});

test("doctor reports every check and exits 0 healthy, 3 unreachable, 1 for other problems", async () => {
  type Report = { healthy: boolean; checks: { name: string; status: string; value: string; hint?: string }[] };
  const healthy = await life(["doctor"]);
  assert.equal(healthy.code, EXIT.ok, healthy.stdout + healthy.stderr);
  const report = result<Report>(healthy);
  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.map((c) => c.name), ["env file", "database url", "connectivity", "migrations", "inbox", "timezone", "actor"]);
  assert.ok(report.checks.every((c) => c.status === "ok"), JSON.stringify(report.checks));
  const check = (name: string) => report.checks.find((c) => c.name === name)!;
  assert.ok(check("env file").value.includes(ENV_FILE));
  assert.match(check("database url").value, /^postgres:\/\/\S+@127\.0\.0\.1:\d+\/\S+ \(from LIFE_DATABASE_URL in the environment\)$/);
  assert.match(check("connectivity").value, /PostgreSQL \d+/);
  assert.ok(check("connectivity").value.includes(db.schema), "connected to the throwaway schema");
  assert.match(check("migrations").value, /^current \(1 applied, latest 0000_initial\)$/);
  assert.match(check("inbox").value, /^p_[a-z0-9]{10} \(Inbox\)$/);
  assert.equal(check("timezone").value, `${TZ} (LIFE_TZ)`);
  assert.equal(check("actor").value, "neel (LIFE_ACTOR)");

  const human = await inProcess(["doctor"], { tty: true });
  assert.equal(human.code, EXIT.ok);
  assert.match(human.stdout, /^env file +ok /m);
  assert.match(human.stdout, /^database url +ok +postgres:\/\/\S+ \(from --db\)/m);
  assert.match(human.stdout, /^Healthy\.$/m);

  const down = await life(["doctor", "--db", UNREACHABLE], { env: { LIFE_ACTOR: undefined, LIFE_TZ: "Mars/Olympus" } });
  const error = failed(down, "db_unavailable", EXIT.database);
  const downReport = result<Report>(down);
  assert.equal(downReport.healthy, false);
  const downCheck = (name: string) => downReport.checks.find((c) => c.name === name)!;
  assert.equal(downCheck("connectivity").status, "fail");
  assert.match(downCheck("connectivity").value, /cannot connect to postgres:\/\/life@127\.0\.0\.1:1\/life/);
  assert.equal(downCheck("migrations").status, "warn");
  assert.equal(downCheck("timezone").status, "fail");
  assert.equal(downCheck("actor").status, "warn");
  assert.match(downCheck("actor").hint!, /--actor codex/);
  assert.match(error.message, /checks failed: connectivity, timezone/);
  assert.ok(!down.stdout.includes("s3cretpw"));
  assert.match(envelope(down).warnings![0]!, /LIFE_TZ/);

  const noUrl = await life(["doctor"], { env: { LIFE_DATABASE_URL: undefined, HOME: scratch } });
  // Without the variable the CLI falls back to the repository .env file, which sets it; the check says which.
  const noUrlReport = result<Report>(noUrl);
  assert.match(noUrlReport.checks.find((c) => c.name === "database url")!.value, /from LIFE_DATABASE_URL in .*\.env\)$|is not set/);

  const badTz = await life(["doctor"], { env: { LIFE_TZ: "Mars/Olympus" } });
  assert.equal(failed(badTz, "rejected", EXIT.rejected).message, "1 check failed: timezone");
  assert.equal(result<Report>(badTz).checks.find((c) => c.name === "connectivity")!.status, "ok");
});

test("--verbose and LIFE_DEBUG put stack traces, SQL details, and resolved refs on stderr while stdout stays one JSON object", async () => {
  const refs = await life(["task", "add", "Verbose add", "--project", "health", "--section", "Nope", "--label", "health", "--verbose"]);
  failed(refs, "rejected", EXIT.rejected);
  assert.match(refs.stderr, /^life: command: life task add "Verbose add"$/m);
  assert.match(refs.stderr, /^life: resolved project --project "health" -> p_[a-z0-9]{10} \(health\)$/m);
  assert.match(refs.stderr, /^life: resolved section --section "Nope" -> nothing$/m);
  assert.match(refs.stderr, /^life: resolved label --label "health" -> l_[a-z0-9]{10} \(@health\)$/m);
  assert.match(refs.stderr, /^life: database: postgres:\/\/\S+ \(from LIFE_DATABASE_URL in the environment\)$/m);

  const quiet = await life(["task", "add", "Quiet add", "--project", "nope"]);
  failed(quiet, "rejected", EXIT.rejected);
  assert.ok(quiet.stderr.split("\n").filter(Boolean).length <= 2, `without --verbose stderr stays short:\n${quiet.stderr}`);
  assert.doesNotMatch(quiet.stderr, /resolved|at .*\.ts:/);

  const stack = await life(["task", "list", "--db", UNREACHABLE], { env: { LIFE_DEBUG: "1" } });
  failed(stack, "db_unavailable", EXIT.database);
  assert.match(stack.stderr, /ECONNREFUSED/);
  assert.match(stack.stderr, /^life: sql: .*code=ECONNREFUSED/m, "the driver's error code");
  assert.match(stack.stderr, /^\s+at /m, "a stack trace");
  assert.ok(!stack.stderr.includes("s3cretpw"));

  const section = await life(["section", "add", "health", "Verbose section", "--verbose"]);
  created(section);
  assert.match(section.stderr, /^life: resolved project <project-ref> "health" -> p_/m, "positional refs are traced too");

  const internal = await inProcess(["today"], {
    clock: {
      now: () => {
        throw new TypeError("clock exploded");
      },
      timezone: TZ,
    },
    env: { LIFE_DEBUG: "1" },
  });
  const error = failed(internal, "internal", EXIT.rejected);
  assert.match(error.message, /internal error: clock exploded/);
  assert.match(error.hint!, /bug in life/);
  assert.match(internal.stderr, /TypeError: clock exploded\n\s+at /);
});

// ------------------------------------------------------------------ the standalone rule

test("a flow driven purely from help output: discover the group, the command, its example, then read the result back", async () => {
  const top = (await life(["--help"])).stdout;
  const groupLine = top.split("\n").find((line) => /^  life task <command>/.test(line));
  assert.ok(groupLine, "the top help lists the task group");
  const howToGroupHelp = /run `life help <group>`/.exec(top);
  assert.ok(howToGroupHelp, "and says how to get a group's help");

  const group = (await life(["help", "task"])).stdout;
  const addLine = group.split("\n").find((line) => /^  life task add <title>/.test(line));
  assert.ok(addLine, "the group help lists task add with its positional");
  assert.match(group, /run `life help task <command>`/, "and says how to get a command's help");

  const command = (await life(["help", "task", "add"])).stdout;
  const examples = command.split("\n").filter((line) => /^  life task add /.test(line)).map((line) => line.trim());
  assert.ok(examples.length >= 2, "copy-pasteable examples");
  const example = examples.find((e) => e.includes("--project health"))!;
  const argv = shellWords(example).slice(1);
  assert.deepEqual(argv.slice(0, 2), ["task", "add"]);
  let ran = await life(argv, { env: { LIFE_ACTOR: undefined } });
  if (ran.code === EXIT.duplicate) {
    // The example's title is already open from an earlier test; the help documented exit 2 and the hint names the flag.
    const hint = failed(ran, "duplicate", EXIT.duplicate).hint!;
    const flag = /pass (--allow-duplicate)/.exec(hint)![1]!;
    ran = await life([...argv, flag], { env: { LIFE_ACTOR: undefined } });
  }
  const record = created(ran);
  assert.equal(record.title, "Book the dentist");
  assert.equal(record.projectId, healthId, "the example's --project health resolved");
  assert.equal(record.origin.actor, "codex", "the example carried its own --actor");
  assert.equal(record.status, "proposed");

  // The exit-code line in the help told the flow what 2 would have meant; the example passed, so read it back the way `task get` documents.
  assert.match(command, /^  2   duplicate candidates \(pass --allow-duplicate to add anyway\)$/m);
  const getHelp = (await life(["help", "task", "get"])).stdout;
  const getExample = getHelp.split("\n").find((line) => /^  life task get t_/.test(line))!.trim();
  const getArgv = shellWords(getExample).slice(1).map((word) => (word.startsWith("t_") ? record.id : word));
  const got = await life(getArgv);
  assert.equal(result<AnyTask>(got).id, record.id);

  // A wrong guess at any layer sends the reader to the right help, so the loop closes without a skill loaded.
  const guess = await life(["task", "complet", record.id]);
  assert.match(failed(guess, "usage", EXIT.usage).message, /did you mean `life task complete`/);
  created(await life(["task", "delete", record.id]), "updated");
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
    const inbox = result<{ id: string; system: boolean }>(await life(["project", "get", "inbox"], { env }));
    assert.equal(inbox.system, true);
    assert.equal(task.projectId, inbox.id);
    const doctor = result<{ checks: { name: string; value: string }[] }>(await life(["doctor"], { env }));
    assert.equal(doctor.checks.find((c) => c.name === "inbox")!.value, `${inbox.id} (Inbox)`);
  } finally {
    await fresh.drop();
  }
});
