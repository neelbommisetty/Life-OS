import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { FakeAdapter, ProviderRejected, ProviderUnavailable, type CalendarAdapter, type ProviderCalendar, type SeedEvent } from "./calendar/adapter.ts";
import { CatalogUnavailable, CatalogUnconfigured, FakeCatalog } from "./media/catalog/adapter.ts";
import { CredentialStore } from "./calendar/credentials.ts";
import { fromGoogleEvent, toGoogleInsert } from "./calendar/google/map.ts";
import { NeedsReauth } from "./calendar/google/oauth.ts";
import type { Availability, EventWrite, When } from "./contract.ts";
import type { Clock } from "./core.ts";
import { serveTestApi } from "./api/testing.ts";
import type { DiagnosticsOptions } from "./api/diagnostics.ts";
import type { ToolsOptions } from "./tools.ts";
import { databaseUrl } from "./db/client.ts";
import { createTestDb, fixedClock, type TestDb } from "./db/testing.ts";
import { COMMANDS, ENV_FILE, EXIT, FILTER_GRAMMAR, commandHelp, describeUrl, groupHelp, main, suggest, topHelp, version, type CliIo, type Envelope, type ErrorCode } from "./cli.ts";

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
async function life(args: string[], opts: { env?: Record<string, string | undefined>; input?: string } = {}): Promise<Run> {
  const api = await serveTestApi({ url: opts.env?.LIFE_DATABASE_URL || url, env: opts.env });
  const env: Record<string, string> = {};
  const wanted: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LIFE_API_URL: api.url,
    LIFE_API_TOKEN: api.token,
    LIFE_ACTOR: "neel",
    LIFE_TZ: TZ,
    ...opts.env,
  };
  for (const [key, value] of Object.entries(wanted)) if (value !== undefined) env[key] = value;
  try { return await new Promise<Run>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  }); } finally { await api.close(); }
}

type Tty = PassThrough & { isTTY?: boolean };

type InProcessOptions = {
  tty?: boolean;
  stdinTty?: boolean;
  input?: string;
  clock?: Clock;
  env?: Record<string, string | undefined>;
  db?: string;
  /** The calendar's injection points (adapters, credentials, the browser opener, doctor's token check) and the library's (catalogs, the IGDB token directory). */
  io?: Pick<CliIo, "openUrl"> & Pick<ToolsOptions, "adapters" | "credentials" | "catalogs"> & Pick<DiagnosticsOptions, "refreshToken" | "igdbTokenDir">;
};

/** `main()` in this process with fake streams: a terminal or not, an optional typed answer, a fixed clock. LIFE_ACTOR=neel unless overridden. */
async function inProcess(args: string[], opts: InProcessOptions = {}): Promise<Run> {
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
  const api = await serveTestApi({ url: opts.db ?? url, env, clock: opts.clock, region: env.LIFE_REGION, ...opts.io });
  try {
    const code = await main(args, { env: { ...env, LIFE_API_URL: api.url, LIFE_API_TOKEN: api.token }, stdin, stdout, stderr, ...(opts.clock ? { clock: opts.clock } : {}), openUrl: opts.io?.openUrl });
    return { code, stdout: out, stderr: err };
  } finally { await api.close(); }
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
  for (const group of ["task", "project", "section", "label", "filter", "account", "calendar", "event"]) assert.match(top.stdout, new RegExp(`^  life ${group} <command>`, "m"), `the ${group} group is listed`);
  for (const command of ["today", "week", "slots", "sync", "upcoming", "search", "trash", "export", "migrate", "doctor"]) assert.match(top.stdout, new RegExp(`^  life ${command}\\b`, "m"), `${command} is listed`);
  for (const name of ["LIFE_GOOGLE_CLIENT_ID", "LIFE_CAL_MAX_AGE", "LIFE_CAL_HISTORY_MONTHS"]) assert.ok(top.stdout.includes(name), `environment variable ${name}`);
  assert.match(top.stdout, /provider_unavailable/, "documents the provider error codes");
  assert.match(top.stdout, /e_xxxxxxxxxx@2026-09-10T16:00:00Z/, "shows the occurrence ref format");
  for (const flag of ["--actor", "--reason", "--evidence", "--key", "--if-version", "--json", "--tz", "--api-url", "--verbose"]) assert.match(top.stdout, new RegExp(`^  ${flag}\\b`, "m"), `global flag ${flag}`);
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
  assert.deepEqual((error.candidates as { id: string }[]).map((c) => c.id), [dentist.id], "and the error carries the candidates too");
  assert.equal(error.candidateKind, "task");
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
  assert.deepEqual(Object.keys(dump), ["exportedAt", "projects", "sections", "labels", "filters", "tasks", "accounts", "calendars", "events", "titles", "log"]);
  assert.equal(dump.exportedAt, summary.exportedAt);
  assert.equal(dump.tasks.length, summary.tasks);
  assert.ok(dump.tasks.some((t) => t.id === dentist.id));
  assert.ok(dump.tasks.some((t) => t.deletedAt !== null), "deleted rows are exported");
  assert.equal(dump.log.length, summary.log);
  assert.ok(dump.log.length > 10);

  const human = await inProcess(["export", file], { tty: true });
  assert.match(human.stdout, /^Exported \d+ projects, \d+ sections, \d+ labels, \d+ filters, \d+ tasks, \d+ accounts, \d+ calendars, \d+ events, \d+ titles, \d+ log to .* \(\d+ bytes\)\.$/m);

  const stdout = await life(["export"]);
  assert.equal(result<{ tasks: unknown[] }>(stdout).tasks.length, dump.tasks.length, "the dump is the envelope's result");
  const terminal = await inProcess(["export"], { tty: true });
  assert.equal(JSON.parse(terminal.stdout).tasks.length, dump.tasks.length, "a dump is JSON on a terminal too");
});

// ------------------------------------------------------------------ the database

test("database failures come from the API and never disclose database credentials", async () => {
  for (const args of [["task", "list"], ["task", "add", "Nowhere to go"], ["migrate"], ["today"]]) {
    const run = await life(args, { env: { LIFE_DATABASE_URL: UNREACHABLE } });
    const error = failed(run, "db_unavailable", EXIT.database);
    assert.match(error.message, /API server.*database/);
    assert.match(error.hint!, /life doctor/);
    assert.doesNotMatch(run.stdout + run.stderr, /s3cretpw|postgres:\/\//);
  }
  assert.equal(describeUrl("postgres://u:p@h:5/d?x=1"), "postgres://u@h:5/d");
  assert.equal(describeUrl("nonsense"), "(not a parseable URL)");
  const legacy = await life(["task", "list", "--db", UNREACHABLE]);
  failed(legacy, "usage", EXIT.usage);
});

test("doctor reports every check and exits 0 healthy, 3 unreachable, 1 for other problems", async () => {
  type Report = { healthy: boolean; checks: { name: string; status: string; value: string; hint?: string }[] };
  // The credential directory is injected (and absent) so the report does not depend on what this machine's .local/google holds.
  const noCredentials = new CredentialStore(join(scratch, "no-credentials", "google"));
  const healthy = await inProcess(["doctor"], { io: { credentials: noCredentials } });
  assert.equal(healthy.code, EXIT.ok, healthy.stdout + healthy.stderr);
  const report = result<Report>(healthy);
  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.map((c) => c.name), ["env file", "database url", "connectivity", "migrations", "inbox", "google client", "accounts", "credential files", "catalog tmdb", "catalog openlibrary", "catalog igdb", "igdb token", "region", "timezone", "actor"]);
  assert.ok(report.checks.every((c) => c.status === "ok" || (["google client", "catalog tmdb", "catalog igdb"].includes(c.name) && c.status === "warn")), JSON.stringify(report.checks));
  const check = (name: string) => report.checks.find((c) => c.name === name)!;
  assert.match(check("google client").value, /^LIFE_GOOGLE_CLIENT_ID is (set|not set)/);
  assert.ok(!healthy.stdout.includes("CLIENT_SECRET="), "never the secret");
  assert.match(check("accounts").value, /^none connected; .*life account add google/);
  assert.equal(check("credential files").value, `none yet in ${noCredentials.dir}; the first account add creates one`);
  assert.ok(check("env file").value.includes(ENV_FILE));
  assert.match(check("database url").value, /^postgres:\/\/\S+@127\.0\.0\.1:\d+\/\S+ \(from API server configuration\)$/);
  const fromEnv = await life(["doctor"]);
  assert.equal(fromEnv.code, EXIT.ok, fromEnv.stdout + fromEnv.stderr);
  assert.match(result<Report>(fromEnv).checks.find((c) => c.name === "database url")!.value, /^postgres:\/\/\S+@127\.0\.0\.1:\d+\/\S+ \(from API server configuration\)$/);
  assert.match(check("connectivity").value, /PostgreSQL \d+/);
  assert.ok(check("connectivity").value.includes(db.schema), "connected to the throwaway schema");
  assert.match(check("migrations").value, /^current \(3 applied, latest 0002_library\)$/);
  assert.match(check("inbox").value, /^p_[a-z0-9]{10} \(Inbox\)$/);
  assert.equal(check("timezone").value, `${TZ} (API request)`);
  assert.equal(check("actor").value, "neel (API request)");

  const human = await inProcess(["doctor"], { tty: true, io: { credentials: noCredentials } });
  assert.equal(human.code, EXIT.ok);
  assert.match(human.stdout, /^env file +ok /m);
  assert.match(human.stdout, /^database url +ok +postgres:\/\/\S+ \(from API server configuration\)/m);
  assert.match(human.stdout, /^Healthy\.$/m);

  const down = await life(["doctor"], { env: { LIFE_DATABASE_URL: UNREACHABLE, LIFE_ACTOR: undefined, LIFE_TZ: "Mars/Olympus" } });
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
  assert.match(noUrlReport.checks.find((c) => c.name === "database url")!.value, /from API server configuration\)$/);

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
  assert.match(refs.stderr, /^life: api: http:\/\/127\.0\.0\.1:\d+$/m);

  const quiet = await life(["task", "add", "Quiet add", "--project", "nope"]);
  failed(quiet, "rejected", EXIT.rejected);
  assert.ok(quiet.stderr.split("\n").filter(Boolean).length <= 2, `without --verbose stderr stays short:\n${quiet.stderr}`);
  assert.doesNotMatch(quiet.stderr, /resolved|at .*\.ts:/);

  const stack = await life(["task", "list"], { env: { LIFE_DATABASE_URL: UNREACHABLE, LIFE_DEBUG: "1" } });
  failed(stack, "db_unavailable", EXIT.database);
  assert.match(stack.stderr, /API server.*database/);
  assert.doesNotMatch(stack.stderr, /life: sql:/, "server SQL diagnostics stay on the server");
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


// ------------------------------------------------------------------ the calendar

// The calendar runs in this process against its own schema, with a FakeAdapter in place of Google: the spawned
// binary would wire the real adapter, and these tests never touch the network. 2026-09-09T12:00Z is 05:00 on
// Wednesday the 9th in Los Angeles.
const CAL_NOW = "2026-09-09T12:00:00Z";
const calClock = fixedClock(CAL_NOW, TZ);
const personalCal: ProviderCalendar = { id: "neel@gmail.com", name: "Personal", color: "#0b8043", timezone: TZ, writable: true, primary: true, hidden: false };
const holidaysCal: ProviderCalendar = { id: "holidays@group.v.calendar.google.com", name: "Holidays", color: null, timezone: "UTC", writable: false, primary: false, hidden: true };
const self = { email: "neel@gmail.com", name: null, response: "needsAction" as const, self: true, optional: false };
const timed = (id: string, title: string, start: string, end: string, extra: Partial<SeedEvent> = {}): SeedEvent => ({ id, title, start: { at: start, timezone: TZ }, end: { at: end, timezone: TZ }, ...extra });

let calDb: TestDb;
let calUrl: string;
let fake: FakeAdapter;
let credentials: CredentialStore;
let credentialsRoot: string;
const opened: string[] = [];

/** The fake as a real adapter behaves: `connect` leaves the credential under the provisional id for `account.add` to adopt. */
function connecting(inner: FakeAdapter, files: CredentialStore): CalendarAdapter {
  return {
    provider: "google",
    async connect(opts) {
      const result = await inner.connect(opts);
      await files.write(result.credentialId, { identity: result.identity, refreshToken: `refresh-token-${result.credentialId}`, scopes: result.scopes, obtainedAt: CAL_NOW });
      return result;
    },
    listCalendars: (accountId) => inner.listCalendars(accountId),
    syncPage: (accountId, calendar, cursor, since) => inner.syncPage(accountId, calendar, cursor, since),
    create: (accountId, calendar, event, lifeId) => inner.create(accountId, calendar, event, lifeId),
    update: (accountId, calendar, providerId, patch, etag) => inner.update(accountId, calendar, providerId, patch, etag),
    delete: (accountId, calendar, providerId) => inner.delete(accountId, calendar, providerId),
    respond: (accountId, calendar, providerId, response) => inner.respond(accountId, calendar, providerId, response),
    move: (accountId, from, to, providerId) => inner.move(accountId, from, to, providerId),
    instances: (accountId, calendar, masterId) => inner.instances(accountId, calendar, masterId),
    instanceId: (masterId, originalStart) => inner.instanceId(masterId, originalStart),
  };
}

/** A CLI run against the calendar schema with the fake adapter, in this process; `opts.io` overrides one injection point. */
const cal = (args: string[], opts: InProcessOptions = {}): Promise<Run> =>
  inProcess(args, {
    db: calUrl,
    clock: calClock,
    ...opts,
    io: { adapters: { google: connecting(fake, credentials) }, credentials, openUrl: (url) => opened.push(url), refreshToken: async () => undefined, ...opts.io },
  });

type AnyOccurrence = { id: string; occurrenceId: string; title: string; status: string; myResponse: string | null; masterId: string | null; start: Record<string, unknown>; end: Record<string, unknown>; calendarId: string; deletedAt: string | null };
type AnyEntry = { kind: "event"; occurrence: AnyOccurrence } | { kind: "task"; task: AnyTask };
type AnyFreshness = { calendarId: string; name: string; syncedAt: string | null; ageSeconds: number | null; refreshed: boolean; error: string | null }[];
const labels = (entries: AnyEntry[]): string[] => entries.map((e) => (e.kind === "event" ? `E:${e.occurrence.title}` : `T:${e.task.title}`));

let accountId: string;
let personalId: string;
let yogaId: string;
let dentist2: AnyOccurrence & Record<string, unknown>;

before(async () => {
  calDb = await createTestDb();
  calUrl = `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${calDb.schema}`;
  credentialsRoot = await mkdtemp(join(tmpdir(), "life-cli-credentials-"));
  credentials = new CredentialStore(join(credentialsRoot, ".local", "google"));
  fake = new FakeAdapter({ clock: calClock });
  fake.connectAs("neel@gmail.com");
  fake.seed("neel@gmail.com", personalCal, [
    timed("yoga", "Yoga", "2026-09-02T14:00:00Z", "2026-09-02T15:00:00Z", { repeat: { rrule: "RRULE:FREQ=WEEKLY;BYDAY=WE", exdates: [] } }), // 07:00 LA, Wednesdays
    timed("standup", "Standup", "2026-09-09T16:00:00Z", "2026-09-09T16:30:00Z"), // 09:00 LA
    timed("review", "Design review", "2026-09-09T20:00:00Z", "2026-09-09T21:00:00Z", { myResponse: "needsAction", organizer: { email: "pm@example.com", name: "PM", self: false }, attendees: [self] }), // 13:00 LA
    timed("invite", "Lunch invite", "2026-09-11T19:00:00Z", "2026-09-11T20:00:00Z", { myResponse: "needsAction", attendees: [self] }), // 12:00 LA Friday
    { id: "offsite", title: "Offsite", start: { date: "2026-09-09" }, end: { date: "2026-09-11" } },
  ]);
  fake.seed("neel@gmail.com", holidaysCal, [{ id: "holiday", title: "Holiday", start: { date: "2026-09-09" }, end: { date: "2026-09-10" } }]);
});
after(async () => {
  await calDb.drop();
  await rm(credentialsRoot, { recursive: true, force: true });
});

test("help alone reaches every account, calendar, and event command, and `life help event` explains refs, when formats, and scopes", async () => {
  for (const group of ["account", "calendar", "event"] as const) {
    const help = await life(["help", group]);
    assert.equal(help.code, EXIT.ok);
    assert.equal(help.stdout.trimEnd(), groupHelp(group));
    for (const command of COMMANDS.values()) if (command.group === group) assert.match(help.stdout, new RegExp(`^  life ${group} ${command.name}\\b.*  \\S`, "m"), `${group} ${command.name} with a purpose`);
    assert.match(help.stdout, /^refs: |^when formats:/m, "the group help names its ref format");
  }
  const event = (await life(["help", "event"])).stdout;
  assert.match(event, /^when formats:$/m);
  assert.match(event, /--start, --end\s+"YYYY-MM-DD HH:MM"/);
  assert.match(event, /--date, --end-date\s+YYYY-MM-DD/);
  assert.match(event, /e_xxxxxxxxxx@2026-09-10T16:00:00Z/);
  assert.match(event, /^scope rules \(repeating events\):$/m);
  for (const scope of ["this", "following", "all"]) assert.match(event, new RegExp(`^  --scope ${scope}\\s+\\S`, "m"));
  assert.match(event, /provider_unavailable \(exit 3\)/);
  const add = (await life(["help", "event", "add"])).stdout;
  assert.equal(add.trimEnd(), commandHelp(COMMANDS.get("event add")!));
  assert.match(add, /^  --start <when> /m);
  assert.match(add, /^  --floating /m);
  assert.match(add, /^  --calendar <ref> .*Default: the primary account's main calendar/m);
  assert.match(add, /^when formats:$/m, "the command help carries the formats too");
  const update = (await life(["help", "event", "update"])).stdout;
  assert.match(update, /^  --scope <this\|following\|all>/m);
  const respond = (await life(["help", "event", "respond"])).stdout;
  assert.match(respond, /^  --scope <this\|all>/m, "respond takes this or all");
  const slotsHelp = (await life(["help", "slots"])).stdout;
  assert.match(slotsHelp, /^  --days <weekdays> .*mon-fri/m);
  assert.match(slotsHelp, /^  --hours <HH:MM-HH:MM> .*Default: 09:00-18:00/m);
  const asJson = result<{ group: string; notes: string[] }>(await life(["help", "event", "--json"]));
  assert.equal(asJson.group, "event");
  assert.ok(asJson.notes.some((line) => /scope rules/.test(line)));
  const wrong = await life(["event", "ad"]);
  assert.match(failed(wrong, "usage", EXIT.usage).message, /unknown command "event ad"; did you mean `life event add`/);
  const wrongGroup = await life(["calender"]);
  assert.match(failed(wrongGroup, "usage", EXIT.usage).message, /did you mean `life calendar`/);
});

test("account add google runs the sign-in through the adapter, prints the URL on stderr, adopts the credential, syncs, and lists", async () => {
  const noProvider = await cal(["account", "add", "outlook"]);
  assert.match(failed(noProvider, "usage", EXIT.usage).message, /unknown provider "outlook"; google is the only provider/);

  const run = await cal(["account", "add", "google", "--label", "home"]);
  const account = created(run);
  accountId = account.id;
  assert.match(accountId, /^a_[a-z0-9]{10}$/);
  assert.equal(account.identity, "neel@gmail.com");
  assert.equal(account.label, "home");
  assert.equal(account.primary, true, "the first account is primary");
  assert.equal(account.status, "connected");
  assert.equal(account.syncedAt, CAL_NOW, "synced once as part of add");
  const receipt = result<AnyReceipt & { sync: { accountId: string; calendars: { outcome: string }[] } }>(run);
  assert.equal(receipt.sync.accountId, accountId);
  assert.deepEqual(receipt.sync.calendars.map((c) => c.outcome), ["synced", "synced"], "the sync report rides on the receipt");
  assert.equal(envelope(run).warnings, undefined, "nothing failed, so no warnings");
  assert.equal(opened.length, 1, "the browser opener was handed the URL once");
  assert.match(opened[0]!, /^https:\/\/accounts\.google\.com\//);
  assert.match(run.stderr, /sign in with Google in the browser; if it did not open, visit:\n  https:\/\/accounts\.google\.com/, "the URL is printed as a fallback, on stderr");
  assert.doesNotMatch(run.stdout, /accounts\.google\.com/, "and never on stdout in JSON mode");
  assert.deepEqual(await readdir(credentials.dir), [`${accountId}.json`], "the provisional credential was adopted under the account id");
  assert.ok(!run.stdout.includes("refresh-token-") && !run.stderr.includes("refresh-token-"), "the refresh token is never printed");

  // Signing in again as the same identity re-authorises the account: the new grant replaces the file, the account stays the same row.
  const tokenBefore = (await credentials.read(accountId))!.refreshToken;
  fake.connectAs("neel@gmail.com");
  const again = await cal(["account", "add", "google"]);
  const reauthorised = created(again, "updated");
  assert.equal(reauthorised.id, accountId, "the same account, not a second one");
  assert.equal(reauthorised.status, "connected");
  assert.deepEqual(await readdir(credentials.dir), [`${accountId}.json`], "one credential file, under the account id");
  assert.notEqual((await credentials.read(accountId))!.refreshToken, tokenBefore, "holding the new grant");
  assert.ok(!again.stdout.includes("refresh-token-") && !again.stderr.includes("refresh-token-"));

  const list = result<{ id: string; identity: string; primary: boolean }[]>(await cal(["account", "list"]));
  assert.deepEqual(list.map((a) => [a.id, a.identity, a.primary]), [[accountId, "neel@gmail.com", true]]);
  const byLabel = result<{ id: string }>(await cal(["account", "get", "home"]));
  assert.equal(byLabel.id, accountId);
  const byEmail = result<{ id: string }>(await cal(["account", "get", "NEEL@gmail.com"]));
  assert.equal(byEmail.id, accountId);
  const missing = await cal(["account", "get", "nobody@example.com"]);
  const missingError = failed(missing, "not_found", EXIT.rejected);
  assert.match(missingError.hint!, /life account list/);

  const human = await cal(["account", "list"], { tty: true });
  assert.match(human.stdout, new RegExp(`^${accountId}  neel@gmail.com  home  primary  connected  synced ${CAL_NOW}$`, "m"));
  const humanAdd = await cal(["account", "primary", "home"], { tty: true });
  assert.match(humanAdd.stdout, new RegExp(`^unchanged ${accountId} v\\d+  neel@gmail.com \\(home\\)  primary$`, "m"));

  const synced = await cal(["account", "sync", "home", "--full"]);
  assert.equal(synced.code, EXIT.ok, synced.stdout);
  const reports = result<{ accountId: string; calendars: { outcome: string; created: number }[] }[]>(synced);
  assert.equal(reports[0]!.accountId, accountId);
  assert.ok(reports[0]!.calendars.every((c) => c.outcome === "unchanged"), "a full sync of an unchanged provider writes nothing");
  const unknown = await cal(["account", "sync", "nobody"]);
  assert.equal(failed(unknown, "not_found", EXIT.rejected).message, 'account: no account "nobody"; run life account list');
});

test("calendar list, get, update (labels, hidden, colour), and reorder", async () => {
  const listed = result<{ id: string; name: string; hidden: boolean; writable: boolean; primaryOfAccount: boolean }[]>(await cal(["calendar", "list"]));
  assert.deepEqual(listed.map((c) => c.name), ["Personal"], "hidden calendars are left out");
  personalId = listed[0]!.id;
  assert.match(personalId, /^c_[a-z0-9]{10}$/);
  assert.equal(listed[0]!.primaryOfAccount, true, JSON.stringify(listed));
  const withHidden = result<{ id: string; name: string; hidden: boolean }[]>(await cal(["calendar", "list", "--hidden"]));
  assert.deepEqual(withHidden.map((c) => [c.name, c.hidden]), [["Personal", false], ["Holidays", true]]);
  const holidaysId = withHidden[1]!.id;

  const byPath = result<{ id: string }>(await cal(["calendar", "get", "neel@gmail.com/Personal"]));
  assert.equal(byPath.id, personalId);
  const byName = result<{ id: string }>(await cal(["calendar", "get", "holidays"]));
  assert.equal(byName.id, holidaysId, "a unique name matches case-insensitively");
  const missing = await cal(["calendar", "get", "Birthdays"]);
  assert.match(failed(missing, "not_found", EXIT.rejected).hint!, /life calendar list --hidden/);

  const labelled = created(await cal(["calendar", "update", personalId, "--label", "health", "--label", "family", "--color", "teal"]), "updated");
  assert.deepEqual(labelled.labels, ["health", "family"]);
  assert.equal(labelled.color, "teal");
  assert.deepEqual(result<{ name: string }[]>(await cal(["label", "list"])).map((l) => l.name).sort(), ["family", "health"], "labels named on a calendar are registered");
  const shown = created(await cal(["calendar", "update", "Holidays", "--visible"]), "updated");
  assert.equal(shown.hidden, false);
  assert.equal(result<unknown[]>(await cal(["calendar", "list"])).length, 2);
  created(await cal(["calendar", "update", "Holidays", "--hidden", "--no-label"]), "updated");
  const both = await cal(["calendar", "update", "Holidays", "--hidden", "--visible"]);
  assert.match(failed(both, "usage", EXIT.usage).message, /--hidden and --visible exclude each other/);
  const nothing = await cal(["calendar", "update", "Holidays"]);
  assert.match(failed(nothing, "usage", EXIT.usage).message, /nothing to change/);

  const reordered = await cal(["calendar", "reorder", holidaysId, personalId]);
  assert.equal(reordered.code, EXIT.ok, reordered.stdout);
  assert.deepEqual(result<{ id: string }[]>(await cal(["calendar", "list", "--hidden"])).map((c) => c.id), [holidaysId, personalId]);
  const back = await cal(["calendar", "reorder", personalId, holidaysId]);
  assert.equal(back.code, EXIT.ok, back.stdout);
  assert.ok(result<AnyReceipt[]>(back).every((r) => r.ok && r.outcome === "updated"));

  const human = await cal(["calendar", "list", "--hidden"], { tty: true });
  assert.match(human.stdout, new RegExp(`^${personalId}  Personal  neel@gmail.com  main +@health @family  teal  synced ${CAL_NOW}$`, "m"));
  assert.match(human.stdout, new RegExp(`^${holidaysId}  Holidays  neel@gmail.com +read-only  hidden`, "m"));
  const synced = await cal(["calendar", "sync", "neel@gmail.com/Personal"]);
  assert.equal(synced.code, EXIT.ok);
  assert.deepEqual(result<{ calendars: { calendarId: string }[] }[]>(synced)[0]!.calendars.map((c) => c.calendarId), [personalId]);
});

test("event add parses --start/--end/--duration/--floating and --date/--end-date/--days in the display zone; the readback is the record", async () => {
  const run = await cal(["event", "add", "Dentist", "--start", "2026-09-10 16:00", "--duration", "45", "--location", "12 Main St", "--notes", "Bring the x-rays"]);
  dentist2 = created(run) as unknown as AnyOccurrence & Record<string, unknown>;
  assert.match(dentist2.id, /^e_[a-z0-9]{10}$/);
  assert.deepEqual(dentist2.start, { at: "2026-09-10T23:00:00Z", timezone: TZ }, "16:00 in Los Angeles");
  assert.deepEqual(dentist2.end, { at: "2026-09-10T23:45:00Z", timezone: TZ });
  assert.equal(dentist2.calendarId, personalId, "the primary account's main calendar by default");
  assert.equal(dentist2.busy, true);
  assert.equal(dentist2.location, "12 Main St");
  assert.equal((dentist2.external as { id: string }).id, fake.events(accountId).at(-1)!.external.id, "the provider's readback is what was stored");
  assert.equal(run.stderr, "");

  const allDay = created(await cal(["event", "add", "Team offsite", "--date", "2026-09-14", "--days", "2", "--calendar", "neel@gmail.com/Personal"]));
  assert.deepEqual(allDay.start, { date: "2026-09-14" });
  assert.deepEqual(allDay.end, { date: "2026-09-16" }, "the end date is exclusive");
  assert.equal(allDay.busy, false, "all-day events default to free");
  const endDated = created(await cal(["event", "add", "Retreat", "--date", "tomorrow", "--end-date", "+3d", "--free"]));
  assert.deepEqual([endDated.start, endDated.end], [{ date: "2026-09-10" }, { date: "2026-09-12" }]);

  const floating = created(await cal(["event", "add", "Morning pages", "--start", "2026-09-12 08:00", "--floating"]));
  assert.deepEqual(floating.start, { at: "2026-09-12T08:00:00Z", timezone: null }, "the wall clock itself, spelled as UTC with no zone: 08:00 wherever Neel is");
  assert.deepEqual(floating.end, { at: "2026-09-12T09:00:00Z", timezone: null });
  const floatingInstant = created(await cal(["event", "add", "Morning pages (offset)", "--start", "2026-09-13T15:00:00Z", "--floating", "--free"]));
  assert.deepEqual(floatingInstant.start, { at: "2026-09-13T08:00:00Z", timezone: null }, "an instant with an offset becomes the wall clock it reads as in the display zone");
  const tokyo = created(await cal(["event", "add", "Call Tokyo", "--start", "2026-09-10 09:00", "--end", "2026-09-10 09:30", "--tz", "Asia/Tokyo"]));
  assert.deepEqual(tokyo.start, { at: "2026-09-10T00:00:00Z", timezone: "Asia/Tokyo" }, "--tz names the zone of the wall clock");
  const relative = created(await cal(["event", "add", "Standup tomorrow", "--start", "tomorrow 09:00", "--free"]));
  assert.deepEqual(relative.start, { at: "2026-09-10T16:00:00Z", timezone: TZ });
  assert.equal(relative.busy, false);
  const instant = created(await cal(["event", "add", "UTC instant", "--start", "2026-09-13T10:00:00Z"]));
  assert.deepEqual(instant.start, { at: "2026-09-13T10:00:00Z", timezone: TZ });

  const neither = await cal(["event", "add", "When?"]);
  assert.match(failed(neither, "usage", EXIT.usage).message, /pass --start "YYYY-MM-DD HH:MM" for a timed event or --date/);
  const both = await cal(["event", "add", "When?", "--start", "2026-09-10 16:00", "--date", "2026-09-10"]);
  assert.match(failed(both, "usage", EXIT.usage).message, /--start\/--end\/--duration \(timed\) and --date\/--end-date\/--days \(all-day\) exclude each other/);
  const bad = await cal(["event", "add", "When?", "--start", "someday soon"]);
  const badError = failed(bad, "usage", EXIT.usage);
  assert.match(badError.message, /--start expects "YYYY-MM-DD HH:MM" \(read in America\/Los_Angeles\) or an instant, got "someday soon"/);
  assert.match(badError.hint!, /--date YYYY-MM-DD instead/);
  const dateOnly = await cal(["event", "add", "When?", "--start", "2026-09-10"]);
  assert.equal(dateOnly.code, EXIT.usage, "a bare date is not a start time");
  const backwards = await cal(["event", "add", "Backwards", "--start", "2026-09-10 16:00", "--end", "2026-09-10 15:00"]);
  const backwardsError = failed(backwards, "rejected", EXIT.rejected);
  assert.match(backwardsError.issues[0]!, /^end: End must be after start/, "the library's validation keeps its field path");
  const readOnly = await cal(["event", "add", "Not here", "--start", "2026-09-10 16:00", "--calendar", "Holidays"]);
  const readOnlyError = failed(readOnly, "rejected", EXIT.rejected);
  assert.match(readOnlyError.message, /read-only/);
  assert.match(readOnlyError.hint!, /life calendar list/);
  const noCalendar = await cal(["event", "add", "Nowhere", "--start", "2026-09-10 16:00", "--calendar", "Birthdays"]);
  assert.match(failed(noCalendar, "rejected", EXIT.rejected).hint!, /life calendar list --hidden/);

  const human = await cal(["event", "add", "Human event", "--start", "2026-09-10 18:00"], { tty: true });
  assert.match(human.stdout, /^created e_[a-z0-9]{10} v1  Human event  2026-09-10 18:00-19:00$/m, "the success line carries the id and the time");
});

test("event list prints occurrence refs that round-trip into get, update, reschedule, respond, and delete; scope is asked for", async () => {
  const listed = result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-09", "--to", "2026-09-16"]));
  for (const occurrence of listed) assert.match(occurrence.occurrenceId, /^e_[a-z0-9]{10}@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|\d{4}-\d{2}-\d{2})$/, `every line has a ref: ${occurrence.occurrenceId}`);
  const yogas = listed.filter((o) => o.title === "Yoga");
  assert.equal(yogas.length, 2, "the weekly series is laid out on both Wednesdays");
  yogaId = yogas[0]!.id;
  assert.deepEqual(yogas.map((o) => o.occurrenceId), [`${yogaId}@2026-09-09T14:00:00Z`, `${yogaId}@2026-09-16T14:00:00Z`]);
  assert.ok(!listed.some((o) => o.title === "Holiday"), "hidden calendars are left out");
  assert.ok(result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-09", "--to", "2026-09-09", "--hidden"])).some((o) => o.title === "Holiday"));
  assert.deepEqual(result<AnyOccurrence[]>(await cal(["event", "list", "--from", "today", "--to", "today", "--calendar", "Holidays"])).map((o) => o.title), ["Holiday"], "a hidden calendar named is included");
  const noWindow = await cal(["event", "list"]);
  assert.match(failed(noWindow, "usage", EXIT.usage).message, /pass --from <date> and --to <date>/);

  const human = await cal(["event", "list", "--from", "2026-09-09", "--to", "2026-09-09"], { tty: true });
  assert.match(human.stdout, new RegExp(`^${yogaId}@2026-09-09T14:00:00Z +2026-09-09 07:00-08:00 +E  Yoga +Personal +repeats$`, "m"), "occurrence ref, range in the display zone, E marker, title, calendar");
  assert.match(human.stdout, /^e_[a-z0-9]{10}@2026-09-09T20:00:00Z +2026-09-09 13:00-14:00 +E  \? Design review +Personal/m, "an invitation awaiting an answer carries a ?");
  assert.match(human.stdout, /^e_[a-z0-9]{10}@2026-09-09 +2026-09-09 to 2026-09-10 +E  Offsite/m, "an all-day span is inclusive in print");
  assert.match(human.stdout, /^e_[a-z0-9]{10}@2026-09-10T00:00:00Z +2026-09-09 17:00-17:30 Asia\/Tokyo +E  Call Tokyo/m, "an event in another zone is shown in the display zone with its own zone named");

  const ref = `${yogaId}@2026-09-16T14:00:00Z`;
  const got = result<AnyOccurrence>(await cal(["event", "get", ref]));
  assert.equal(got.occurrenceId, ref);
  assert.deepEqual(got.start, { at: "2026-09-16T14:00:00Z", timezone: TZ });
  const missingOccurrence = await cal(["event", "get", `${yogaId}@2026-09-15T14:00:00Z`]);
  assert.equal(failed(missingOccurrence, "not_found", EXIT.rejected).message, `event: no occurrence "${yogaId}@2026-09-15T14:00:00Z"`);
  const missing = await cal(["event", "get", "e_0000000000"]);
  assert.match(failed(missing, "not_found", EXIT.rejected).hint!, /life event list --from/);

  const asked = await cal(["event", "update", ref, "--title", "Yoga (long)"]);
  const needs = failed(asked, "needs", EXIT.rejected);
  assert.deepEqual(needs.needs!.field, "scope");
  assert.deepEqual(needs.needs!.options, ["this", "following", "all"]);
  assert.equal(needs.hint, "pass --scope this|following|all");
  assert.match(asked.stderr, /pass --scope this\|following\|all/);
  const badScope = await cal(["event", "update", ref, "--title", "x", "--scope", "some"]);
  assert.match(failed(badScope, "usage", EXIT.usage).message, /--scope expects one of this, following, all/);

  const answered = await cal(["event", "update", ref, "--title", "Yoga (long)", "--end", "2026-09-16 08:30"], { tty: true, input: "this\n" });
  assert.equal(answered.code, EXIT.ok, answered.stdout + answered.stderr);
  assert.match(answered.stdout, /scope \[this\/following\/all\]:/, "a terminal asks");
  assert.match(answered.stdout, /created e_[a-z0-9]{10} v1  Yoga \(long\)  2026-09-16 07:00-08:30$/m, "this yields an exception row with its own id");
  const exceptionId = /created (e_[a-z0-9]{10})/.exec(answered.stdout)![1]!;
  const exception = result<AnyOccurrence>(await cal(["event", "get", exceptionId]));
  assert.equal(exception.masterId, yogaId);
  const relisted = result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-16", "--to", "2026-09-16"]));
  assert.deepEqual(relisted.filter((o) => o.id === exceptionId).map((o) => [o.occurrenceId, o.title]), [[ref, "Yoga (long)"]], "the occurrence keeps its ref (the master's id) and shows the exception's fields");

  const moved = created(await cal(["event", "reschedule", `${yogaId}@2026-09-23T14:00:00Z`, "--start", "2026-09-23 08:00", "--scope", "this"]));
  assert.deepEqual([moved.start, moved.end], [{ at: "2026-09-23T15:00:00Z", timezone: TZ }, { at: "2026-09-23T16:00:00Z", timezone: TZ }], "the duration is kept");
  const noStart = await cal(["event", "reschedule", yogaId, "--scope", "all"]);
  assert.match(failed(noStart, "usage", EXIT.usage).message, /pass --start/);

  const review = listed.find((o) => o.title === "Design review")!;
  const accepted = created(await cal(["event", "respond", review.id, "accepted"]), "updated");
  assert.equal(accepted.myResponse, "accepted");
  const badResponse = await cal(["event", "respond", review.id, "maybe"]);
  const badResponseError = failed(badResponse, "usage", EXIT.usage);
  assert.match(badResponseError.message, /<response> must be one of accepted, declined, tentative/);
  assert.equal(badResponseError.hint, "pass accepted|declined|tentative");
  const notInvited = await cal(["event", "respond", dentist2.id, "declined"]);
  assert.match(failed(notInvited, "rejected", EXIT.rejected).message, /not an attendee/);
  const notOrganizer = await cal(["event", "cancel", review.id, "--reason", "clash"]);
  assert.match(failed(notOrganizer, "rejected", EXIT.rejected).message, /only the organizer can cancel/);
  const noReason = await cal(["event", "cancel", dentist2.id]);
  const noReasonError = failed(noReason, "rejected", EXIT.rejected);
  assert.match(noReasonError.message, /^reason: /);
  assert.match(noReasonError.hint!, /--reason/);

  const cancelledOccurrence = created(await cal(["event", "delete", `${yogaId}@2026-09-30T14:00:00Z`, "--scope", "this"]));
  assert.equal(cancelledOccurrence.status, "cancelled", "deleting one occurrence cancels it at the provider");
  assert.equal(cancelledOccurrence.masterId, yogaId);
  const thatWeek = result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-30", "--to", "2026-09-30"]));
  assert.ok(!thatWeek.some((o) => o.id === yogaId), "the cancelled occurrence is off the list");

  const history = result<{ op: string; actor: string }[]>(await cal(["event", "history", yogaId]));
  assert.equal(history[0]!.op, "event.sync");
  assert.equal(history[0]!.actor, "import:google", "the sync that brought the event in is in its history");
  const exceptionHistory = result<{ op: string; actor: string }[]>(await cal(["event", "history", exceptionId]));
  assert.deepEqual(exceptionHistory.map((e) => [e.op, e.actor]), [["event.update", "neel"]]);
});

test("event cancel, delete, restore, duplicate, and move, with the trash in between", async () => {
  const cancelled = created(await cal(["event", "cancel", dentist2.id, "--reason", "rescheduled by the clinic"]), "updated");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.deletedAt, null, "cancelled is not deleted");
  const stillListed = result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-10", "--to", "2026-09-10"]));
  assert.ok(stillListed.some((o) => o.id === dentist2.id && o.status === "cancelled"), "a cancelled event stays on the list");

  const deleted = created(await cal(["event", "delete", dentist2.id]), "updated");
  assert.ok(deleted.deletedAt);
  assert.ok(!result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-10", "--to", "2026-09-10"])).some((o) => o.id === dentist2.id));
  assert.ok(result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-10", "--to", "2026-09-10", "--deleted"])).some((o) => o.id === dentist2.id));
  const trash = result<{ events: { id: string }[]; calendars: unknown[]; accounts: unknown[] }>(await cal(["trash"]));
  assert.deepEqual(trash.events.map((e) => e.id), [dentist2.id]);
  const trashHuman = await cal(["trash"], { tty: true });
  assert.match(trashHuman.stdout, new RegExp(`^Events \\(1\\)\\n  ${dentist2.id}  Dentist  2026-09-10 16:00-16:45  Personal +deleted `, "m"));
  const again = await cal(["event", "delete", dentist2.id]);
  assert.equal(created(again, "unchanged").id, dentist2.id, "deleting a deleted event is unchanged");

  const restored = created(await cal(["event", "restore", dentist2.id]), "updated");
  assert.equal(restored.id, dentist2.id, "restored under the same Life-OS id");
  assert.equal(restored.deletedAt, null);
  assert.notEqual((restored.external as { id: string }).id, (dentist2.external as { id: string }).id, "recreated at the provider under a new provider id");
  const occurrenceRestore = await cal(["event", "restore", `${yogaId}@2026-09-16T14:00:00Z`]);
  assert.equal(occurrenceRestore.code, EXIT.rejected, "restore takes an id, not an occurrence ref");

  const copy = created(await cal(["event", "duplicate", dentist2.id]));
  assert.notEqual(copy.id, dentist2.id);
  assert.equal(copy.title, "Dentist");
  assert.deepEqual(copy.start, dentist2.start);
  const toHidden = await cal(["event", "move", copy.id, "--calendar", "Holidays"]);
  assert.match(failed(toHidden, "rejected", EXIT.rejected).message, /read-only/);
  const noTarget = await cal(["event", "move", copy.id]);
  assert.match(failed(noTarget, "usage", EXIT.usage).message, /pass --calendar <ref>/);
  const samePlace = created(await cal(["event", "move", copy.id, "--calendar", personalId]), "unchanged");
  assert.equal(samePlace.id, copy.id);
  created(await cal(["event", "delete", copy.id]), "updated");
});

test("a provider that cannot be reached is provider_unavailable with exit 3, a refusal is provider_rejected with exit 1, and nothing is stored either way", async () => {
  fake.failNext(new ProviderUnavailable("Could not reach www.googleapis.com: connect ETIMEDOUT"));
  const down = await cal(["event", "add", "Ghost", "--start", "2026-09-10 11:00", "--key", "ghost-1"]);
  const downError = failed(down, "provider_unavailable", EXIT.provider);
  assert.equal(EXIT.provider, 3);
  assert.deepEqual(downError.issues, ["provider_unavailable: Could not reach www.googleapis.com: connect ETIMEDOUT"]);
  assert.match(downError.hint!, /same --key/);
  assert.match(downError.hint!, /life doctor/);
  const receipt = result<AnyReceipt>(down);
  assert.equal(receipt.outcome, "rejected", "the library's receipt is the result");
  assert.ok(!result<AnyOccurrence[]>(await cal(["event", "list", "--from", "2026-09-10", "--to", "2026-09-10", "--deleted"])).some((o) => o.title === "Ghost"), "nothing was stored");
  assert.match(down.stderr, /provider_unavailable/);

  const retried = await cal(["event", "add", "Ghost", "--start", "2026-09-10 11:00", "--key", "ghost-1"]);
  const ghost = created(retried);
  assert.equal(ghost.title, "Ghost", "the same key retries cleanly once the provider is back");
  const replay = await cal(["event", "add", "Ghost", "--start", "2026-09-10 11:00", "--key", "ghost-1"]);
  assert.equal(created(replay).id, ghost.id, "and replays the receipt afterwards");

  fake.failNext(new ProviderRejected("Invalid recurrence rule", 400));
  const refused = await cal(["event", "add", "Refused", "--start", "2026-09-10 11:00"]);
  const refusedError = failed(refused, "provider_rejected", EXIT.rejected);
  assert.deepEqual(refusedError.issues, ["provider_rejected: Invalid recurrence rule"]);

  fake.failNext(new ProviderUnavailable("Could not reach www.googleapis.com: connect ETIMEDOUT"));
  const sync = await cal(["sync"]);
  const syncError = failed(sync, "provider_unavailable", EXIT.provider);
  assert.match(syncError.message, /2 calendars failed to sync/);
  const reports = result<{ calendars: { outcome: string; error?: string }[] }[]>(sync);
  assert.ok(reports[0]!.calendars.every((c) => c.outcome === "failed" && /ProviderUnavailable/.test(c.error ?? "")), "the report is still the result");
  const humanDown = await cal(["sync"], { tty: true, io: {} });
  assert.equal(humanDown.code, EXIT.ok, "the next sync succeeds and clears the errors");
  assert.match(humanDown.stdout, new RegExp(`^neel@gmail.com \\(${accountId}\\)\\n  Personal +${personalId} +(synced|unchanged)`, "m"));

  const thrown = await cal(["event", "add", "Boom", "--start", "2026-09-10 11:00"], { io: { adapters: { google: { ...connecting(fake, credentials), create: async () => { throw new ProviderUnavailable("gateway timeout", 504); } } } } });
  assert.equal(failed(thrown, "provider_unavailable", EXIT.provider).issues[0], "provider_unavailable: gateway timeout");
});

test("today, week, and slots merge events and dated tasks, print occurrence refs, and report freshness on stderr in human mode only", async () => {
  created(await cal(["task", "add", "Call the dentist", "--due", "2026-09-09", "--time", "10:30"]));
  created(await cal(["task", "add", "Walk in the park", "--due", "2026-09-09"]));
  created(await cal(["task", "add", "Old rent", "--due", "2026-09-01"]));

  const today = await cal(["today"]);
  assert.equal(today.code, EXIT.ok, today.stdout);
  const view = result<{ date: string; timezone: string; overdue: AnyTask[]; due: AnyTask[]; allDay: AnyEntry[]; timed: AnyEntry[]; freshness: AnyFreshness; warnings: string[] }>(today);
  assert.equal(view.date, "2026-09-09");
  assert.deepEqual(labels(view.allDay), ["E:Offsite", "T:Walk in the park"], "all-day events first, then date-only tasks");
  assert.deepEqual(labels(view.timed), ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Design review", "E:Call Tokyo"], "by start: 07:00, 09:00, 10:30, 13:00, 17:00 (09:00 Tokyo on the 10th is the 9th in Los Angeles)");
  assert.deepEqual(view.overdue.map((t) => t.title), ["Old rent"], "the todo lists are still there");
  assert.deepEqual(view.due.map((t) => t.title), ["Call the dentist", "Walk in the park"]);
  assert.deepEqual(view.freshness.map((f) => [f.name, f.ageSeconds, f.refreshed, f.error]), [["Personal", 0, false, null]], "one entry per visible calendar; the copy is fresh");
  assert.deepEqual(view.warnings, []);
  const entry = view.timed[0]!;
  assert.equal(entry.kind === "event" && entry.occurrence.occurrenceId, `${yogaId}@2026-09-09T14:00:00Z`, "occurrence refs are in the view");
  assert.equal(today.stderr, "", "JSON mode: nothing on stderr for a fresh copy");
  assert.equal(result<{ freshness: AnyFreshness }>(await cal(["today", "--hidden"])).freshness.length, 2);

  const human = await cal(["today"], { tty: true });
  assert.equal(human.code, EXIT.ok, human.stderr);
  assert.match(human.stdout, /^Today 2026-09-09 Wed \(America\/Los_Angeles\)$/m);
  assert.match(human.stdout, /^Schedule \(7\)$/m);
  assert.match(human.stdout, /^  All day: Offsite \[Personal\], Walk in the park \[inbox\]$/m, "the day's all-day line");
  assert.match(human.stdout, new RegExp(`^  07:00-08:00  E  Yoga +Personal  ${yogaId}@2026-09-09T14:00:00Z$`, "m"), "time range, E marker, title, calendar, occurrence ref");
  assert.match(human.stdout, /^  10:30 +T  Call the dentist +inbox +t_[a-z0-9]{10}$/m, "a timed task at its time with a T marker and its project");
  assert.match(human.stdout, /^  13:00-14:00  E  Design review +Personal  e_[a-z0-9]{10}@2026-09-09T20:00:00Z$/m, "answered earlier, so no ? (the week test checks the marker)");
  assert.match(human.stdout, /^  17:00-17:30  E  Call Tokyo/m, "shown in the display zone");
  assert.match(human.stdout, /^Overdue \(1\)$/m);
  assert.match(human.stdout, /^Due today \(2\)$/m);
  assert.equal(human.stderr, "", "a fresh copy: no freshness line");

  // Ten minutes later the copy is stale: a view refreshes it first and says so in `freshness`; --stale answers from the copy and reports that on stderr.
  const later = fixedClock("2026-09-09T12:10:00Z", TZ);
  const pagesBefore = fake.callsTo("syncPage").length;
  const stale = await cal(["today", "--stale"], { clock: later, tty: true });
  assert.equal(stale.code, EXIT.ok);
  assert.equal(fake.callsTo("syncPage").length, pagesBefore, "--stale skips the refresh");
  assert.match(stale.stderr, new RegExp(`^life: calendar "Personal" \\(${personalId}\\) answered from a stale copy, synced 600s ago$`, "m"));
  const staleJson = await cal(["today", "--stale"], { clock: later });
  assert.equal(staleJson.stderr, "", "never on stderr in JSON mode");
  assert.deepEqual(result<{ freshness: AnyFreshness }>(staleJson).freshness.map((f) => [f.ageSeconds, f.refreshed]), [[600, false]]);
  const refreshed = await cal(["today"], { clock: later });
  assert.ok(fake.callsTo("syncPage").length > pagesBefore, "without --stale the stale copy is refreshed first");
  assert.deepEqual(result<{ freshness: AnyFreshness }>(refreshed).freshness.map((f) => [f.syncedAt, f.ageSeconds, f.refreshed, f.error]), [["2026-09-09T12:10:00Z", 0, true, null]]);

  // A refresh that fails: the view still answers, from the copy, and says so.
  const muchLater = fixedClock("2026-09-09T12:30:00Z", TZ);
  fake.failNext(new ProviderUnavailable("Could not reach www.googleapis.com: connect ETIMEDOUT"));
  const failedRefresh = await cal(["today"], { clock: muchLater });
  assert.equal(failedRefresh.code, EXIT.ok, "never an empty answer standing in for a failed one");
  const degraded = result<{ timed: AnyEntry[]; freshness: AnyFreshness; warnings: string[] }>(failedRefresh);
  assert.deepEqual(labels(degraded.timed), ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Design review", "E:Call Tokyo"], "answered from the copy");
  assert.match(degraded.freshness[0]!.error!, /ProviderUnavailable: Could not reach/);
  assert.equal(degraded.freshness[0]!.refreshed, false);
  assert.match(degraded.warnings[0]!, /^Calendar "Personal" \(c_[a-z0-9]{10}\) could not be refreshed: .*Answering from the copy synced at 2026-09-09T12:10:00Z\.$/);
  assert.equal(failedRefresh.stderr, "");
  fake.failNext(new ProviderUnavailable("Could not reach www.googleapis.com: connect ETIMEDOUT"));
  const failedHuman = await cal(["today"], { clock: muchLater, tty: true });
  assert.equal(failedHuman.code, EXIT.ok);
  assert.match(failedHuman.stderr, /^life: calendar "Personal" \(c_[a-z0-9]{10}\) could not be refreshed: ProviderUnavailable: Could not reach .*; answering from the copy, synced 1200s ago$/m);
  assert.match(failedHuman.stdout, /^Schedule \(7\)$/m);
  assert.equal((await cal(["sync"], { clock: muchLater })).code, EXIT.ok, "the next sync clears the error");

  const week = await cal(["week", "--from", "2026-09-09", "--days", "3"]);
  const weekView = result<{ from: string; to: string; timezone: string; days: { date: string; allDay: AnyEntry[]; timed: AnyEntry[] }[]; freshness: AnyFreshness }>(week);
  assert.deepEqual([weekView.from, weekView.to, weekView.timezone], ["2026-09-09", "2026-09-11", TZ]);
  assert.deepEqual(weekView.days.map((d) => d.date), ["2026-09-09", "2026-09-10", "2026-09-11"]);
  assert.deepEqual(labels(weekView.days[0]!.timed), ["E:Yoga", "E:Standup", "T:Call the dentist", "E:Design review", "E:Call Tokyo"]);
  assert.deepEqual(labels(weekView.days[1]!.allDay), ["E:Offsite", "E:Retreat"], "a multi-day event appears on each day it covers");
  assert.ok(!weekView.days.some((d) => labels(d.allDay).includes("T:Old rent")), "overdue tasks are not carried into the week");
  const weekHuman = await cal(["week", "--from", "2026-09-11", "--days", "2"], { tty: true });
  assert.match(weekHuman.stdout, /^Week 2026-09-11 to 2026-09-12 \(America\/Los_Angeles\)$/m);
  assert.match(weekHuman.stdout, /^2026-09-11 Fri \(2\)\n  All day: Retreat \[Personal\]\n  12:00-13:00  E  \? Lunch invite +Personal  e_[a-z0-9]{10}@2026-09-11T19:00:00Z$/m, "the all-day line, then an invitation awaiting an answer marked in place");
  assert.match(weekHuman.stdout, /^2026-09-12 Sat \(1\)\n  08:00-09:00  E  Morning pages/m, "a floating event at its wall clock");
  const badDays = await cal(["week", "--days", "lots"]);
  assert.match(failed(badDays, "usage", EXIT.usage).message, /--days expects an integer/);

  const slots = await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--hours", "09:00-12:00"]);
  const slotsView = result<{ slots: { start: string; end: string }[]; freshness: AnyFreshness }>(slots);
  assert.deepEqual(slotsView.slots, [{ start: "2026-09-11T16:00:00Z", end: "2026-09-11T19:00:00Z" }], "Friday 09:00 to 12:00 in Los Angeles is free (lunch is at noon)");
  assert.equal(slotsView.freshness.length, 1);
  const afternoon = result<{ slots: { start: string; end: string }[] }>(await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--hours", "11:00-15:00"]));
  assert.deepEqual(afternoon.slots, [{ start: "2026-09-11T18:00:00Z", end: "2026-09-11T19:00:00Z" }, { start: "2026-09-11T20:00:00Z", end: "2026-09-11T22:00:00Z" }], "busy time is cut out; the invitation counts as busy");
  const weekend = result<{ slots: unknown[] }>(await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--days", "sat-sun"]));
  assert.deepEqual(weekend.slots, [], "--days maps names onto weekdays: Friday is not a working day");
  const listed = result<{ slots: unknown[] }>(await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--days", "mon,wed,fri", "--hours", "09:00-10:00"]));
  assert.equal(listed.slots.length, 1);
  const wrapped = result<{ slots: unknown[] }>(await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--days", "sat-mon", "--hours", "09:00-10:00"]));
  assert.equal(wrapped.slots.length, 0, "a wrapped range is sat, sun, mon");
  const badWeekday = await cal(["slots", "--duration", "60", "--days", "mon-fry"]);
  assert.match(failed(badWeekday, "usage", EXIT.usage).message, /--days: unknown weekday "fry"/);
  const badHours = await cal(["slots", "--duration", "60", "--hours", "9-5"]);
  assert.equal(failed(badHours, "usage", EXIT.usage).hint, "pass --hours 09:00-18:00");
  const noDuration = await cal(["slots"]);
  assert.match(failed(noDuration, "usage", EXIT.usage).message, /pass --duration <minutes>/);
  const slotsHuman = await cal(["slots", "--duration", "60", "--from", "2026-09-11", "--to", "2026-09-11", "--hours", "09:00-12:00"], { tty: true });
  assert.match(slotsHuman.stdout, /^Free slots \(1\), America\/Los_Angeles\n  2026-09-11 Fri  09:00-12:00  180 min  2026-09-11T16:00:00Z to 2026-09-11T19:00:00Z$/m);
});

test("a floating event round-trips: the CLI flag, the Google insert body, the readback, and the week view all agree on the wall clock", async () => {
  const added = created(await cal(["event", "add", "Evening pages", "--start", "2026-09-12 20:00", "--floating"]));
  const start = added.start as unknown as When;
  const end = added.end as unknown as When;
  assert.deepEqual(start, { at: "2026-09-12T20:00:00Z", timezone: null });
  assert.deepEqual(end, { at: "2026-09-12T21:00:00Z", timezone: null });

  // What the Google adapter would send for this row, and what it would read back from Google's copy.
  const ctx = { calendarTimezone: TZ, fetchedAt: CAL_NOW };
  const write: EventWrite = { title: "Evening pages", notes: null, location: null, start, end, repeat: null, busy: true, status: "confirmed" };
  const body = toGoogleInsert(write, added.id, ctx);
  assert.deepEqual(body.start, { dateTime: "2026-09-12T20:00:00", timeZone: TZ }, "Google is told 8 PM in the calendar's zone, not the display-zone instant");
  assert.deepEqual(body.end, { dateTime: "2026-09-12T21:00:00", timeZone: TZ });
  assert.equal(body.extendedProperties?.private.lifeFloating, "true");
  const readBack = fromGoogleEvent({ id: "g-evening", etag: '"7"', status: "confirmed", summary: body.summary, start: body.start, end: body.end, extendedProperties: body.extendedProperties, updated: CAL_NOW }, ctx);
  assert.deepEqual(readBack.start, start, "the readback is the same wall clock, floating again");
  assert.deepEqual(readBack.end, end);

  // The same item as Google would hand it to sync, authored there: it lands at the same wall clock beside the CLI's.
  const { external: _external, ...provider } = readBack;
  fake.seed(accountId, personalCal, [{ ...provider, id: "evening-google", title: "Evening pages (Google)", lifeId: null }]);
  assert.equal((await cal(["sync"])).code, EXIT.ok);
  const week = result<{ days: { date: string; timed: AnyEntry[] }[] }>(await cal(["week", "--from", "2026-09-12", "--days", "1"]));
  const evenings = week.days[0]!.timed.filter((e) => e.kind === "event" && e.occurrence.title.startsWith("Evening pages"));
  assert.equal(evenings.length, 2, JSON.stringify(labels(week.days[0]!.timed)));
  for (const entry of evenings) assert.deepEqual(entry.kind === "event" && entry.occurrence.start, { at: "2026-09-12T20:00:00Z", timezone: null });
  const human = await cal(["week", "--from", "2026-09-12", "--days", "1"], { tty: true });
  assert.match(human.stdout, /^  20:00-21:00  E  Evening pages +Personal/m, "at 20:00 in Los Angeles");
  assert.match(human.stdout, /^  20:00-21:00  E  Evening pages \(Google\) +Personal/m);
  const kolkata = await cal(["week", "--from", "2026-09-12", "--days", "1"], { tty: true, env: { LIFE_TZ: "Asia/Kolkata" } });
  assert.match(kolkata.stdout, /^Week 2026-09-12 to 2026-09-12 \(Asia\/Kolkata\)$/m);
  assert.match(kolkata.stdout, /^  20:00-21:00  E  Evening pages +Personal/m, "and at 20:00 in Kolkata: it happens at its wall clock wherever Neel is");
  assert.match(kolkata.stdout, /^  20:00-21:00  E  Evening pages \(Google\) +Personal/m);
  const shown = await cal(["event", "get", added.id], { tty: true });
  assert.match(shown.stdout, /2026-09-12 20:00 floating/, "printed as its wall clock, marked floating");
  const listed = await cal(["event", "list", "--from", "2026-09-12", "--to", "2026-09-12"], { tty: true });
  assert.match(listed.stdout, /2026-09-12 20:00-21:00 floating/);
});

test("doctor reports the Google client, each account with its credential and token, its calendars with copy age, and the primary account", async () => {
  type Report = { healthy: boolean; checks: { name: string; status: string; value: string; hint?: string }[] };
  assert.equal((await cal(["sync"], { clock: fixedClock("2026-09-09T12:30:00Z", TZ) })).code, EXIT.ok);
  const healthy = await cal(["doctor"], { clock: fixedClock("2026-09-09T12:30:00Z", TZ) });
  assert.equal(healthy.code, EXIT.ok, healthy.stdout + healthy.stderr);
  const report = result<Report>(healthy);
  assert.equal(report.healthy, true);
  assert.deepEqual(
    report.checks.map((c) => c.name),
    ["env file", "database url", "connectivity", "migrations", "inbox", "google client", "primary account", "account neel@gmail.com", "credential neel@gmail.com", "calendar neel@gmail.com/Personal", "calendar neel@gmail.com/Holidays", "credential files", "catalog tmdb", "catalog openlibrary", "catalog igdb", "igdb token", "region", "timezone", "actor"],
  );
  const check = (name: string) => report.checks.find((c) => c.name === name)!;
  assert.match(check("google client").value, /^LIFE_GOOGLE_CLIENT_ID is (set|not set)/);
  assert.equal(check("primary account").value, `neel@gmail.com (${accountId})`);
  assert.equal(check("account neel@gmail.com").status, "ok");
  assert.match(check("account neel@gmail.com").value, new RegExp(`^${accountId}; connected; primary; synced 2026-09-09T12:30:00Z$`));
  assert.equal(check("credential neel@gmail.com").value, "file present; token refresh works");
  assert.equal(check("credential files").status, "ok");
  assert.equal(check("credential files").value, `1 in ${credentials.dir}, each a live account's`);
  assert.match(check("calendar neel@gmail.com/Personal").value, new RegExp(`^${personalId}; copy 0s old$`));
  assert.match(check("calendar neel@gmail.com/Holidays").value, /copy 0s old; hidden; read-only$/);
  assert.ok(!healthy.stdout.includes("refresh-token-") && !healthy.stderr.includes("refresh-token-"), "the token never appears");

  const human = await cal(["doctor"], { tty: true, clock: fixedClock("2026-09-09T12:30:00Z", TZ) });
  assert.match(human.stdout, new RegExp(`^primary account +ok +neel@gmail.com \\(${accountId}\\)$`, "m"));
  assert.match(human.stdout, /^credential neel@gmail.com +ok +file present; token refresh works$/m);

  const stale = result<Report>(await cal(["doctor"], { clock: fixedClock("2026-09-09T13:00:00Z", TZ) }));
  const staleCalendar = stale.checks.find((c) => c.name === "calendar neel@gmail.com/Personal")!;
  assert.equal(staleCalendar.status, "warn");
  assert.match(staleCalendar.value, /copy 1800s old; older than LIFE_CAL_MAX_AGE \(300s\)/);
  assert.equal(staleCalendar.hint, "run `life sync`");
  assert.equal(stale.healthy, true, "a stale copy is a warning, not a failure");

  // Files no live account owns: a sign-in that never became an account, and one left behind. Each holds a live grant, so doctor names them and how to remove them.
  await credentials.write("pending-abc123", { identity: "neel@gmail.com", refreshToken: "refresh-token-orphan-1", scopes: [], obtainedAt: CAL_NOW });
  await credentials.write("a_gone0000001", { identity: "old@example.com", refreshToken: "refresh-token-orphan-2", scopes: [], obtainedAt: CAL_NOW });
  const orphaned = await cal(["doctor"], { clock: fixedClock("2026-09-09T12:30:00Z", TZ) });
  assert.equal(orphaned.code, EXIT.ok, "a warning, not a failure");
  const files = result<Report>(orphaned).checks.find((c) => c.name === "credential files")!;
  assert.equal(files.status, "warn");
  assert.equal(files.value, `2 of 3 files in ${credentials.dir} belong to no live account: a_gone0000001.json, pending-abc123.json; pending-* is a sign-in that never became an account`);
  assert.equal(files.hint, `each holds a live refresh token; delete the files: rm ${JSON.stringify(credentials.path("a_gone0000001"))} ${JSON.stringify(credentials.path("pending-abc123"))}; then revoke Life-OS under https://myaccount.google.com/permissions if that Google account keeps no other connection here`);
  assert.ok(!orphaned.stdout.includes("refresh-token-") && !orphaned.stderr.includes("refresh-token-"), "the tokens never appear");
  const orphanedHuman = await cal(["doctor"], { tty: true, clock: fixedClock("2026-09-09T12:30:00Z", TZ) });
  assert.match(orphanedHuman.stdout, /^credential files +warn +2 of 3 files .*-> each holds a live refresh token; delete the files: rm /m);
  await credentials.delete("pending-abc123");
  await credentials.delete("a_gone0000001");

  const revoked = await cal(["doctor"], { clock: fixedClock("2026-09-09T12:30:00Z", TZ), io: { refreshToken: async (id) => { throw new NeedsReauth(id); } } });
  const revokedError = failed(revoked, "rejected", EXIT.rejected);
  assert.match(revokedError.message, /1 check failed: credential neel@gmail.com/);
  assert.match(revokedError.hint!, /life account add google/);
  const revokedCheck = result<Report>(revoked).checks.find((c) => c.name === "credential neel@gmail.com")!;
  assert.equal(revokedCheck.status, "fail");
  assert.match(revokedCheck.value, /token refresh failed: Google access for a_[a-z0-9]{10} needs to be granted again/);

  await rm(credentials.path(accountId));
  const missingFile = result<Report>(await cal(["doctor"], { clock: fixedClock("2026-09-09T12:30:00Z", TZ) }));
  const fileCheck = missingFile.checks.find((c) => c.name === "credential neel@gmail.com")!;
  assert.equal(fileCheck.status, "fail");
  assert.ok(fileCheck.value.includes(credentials.path(accountId)));
  await credentials.write(accountId, { identity: "neel@gmail.com", refreshToken: "refresh-token-restored", scopes: [], obtainedAt: CAL_NOW });
});

test("a sync that hits a dead credential marks the account needs_reauth; the views say so and account remove clears everything", async () => {
  const dead = { ...connecting(fake, credentials), syncPage: async () => { throw new NeedsReauth(accountId); } };
  const sync = await cal(["sync", "--full"], { io: { adapters: { google: dead } } });
  assert.equal(failed(sync, "rejected", EXIT.rejected).code, "rejected");
  assert.match(envelope(sync).error!.hint!, /life account add google/);
  const account = result<{ status: string }>(await cal(["account", "get", accountId]));
  assert.equal(account.status, "needs_reauth");
  const doctor = result<{ checks: { name: string; status: string; hint?: string }[] }>(await cal(["doctor"]));
  const accountCheck = doctor.checks.find((c) => c.name === "account neel@gmail.com")!;
  assert.equal(accountCheck.status, "fail");
  assert.match(accountCheck.hint!, /life account add google/);
  const view = result<{ freshness: AnyFreshness; warnings: string[] }>(await cal(["today"], { clock: fixedClock("2026-09-09T14:00:00Z", TZ) }));
  assert.match(view.freshness[0]!.error!, /needs re-authorization \(run life account add google\)/, "a stale copy the account cannot refresh says why");
  const write = await cal(["event", "add", "While signed out", "--start", "2026-09-10 11:00"]);
  const writeError = failed(write, "rejected", EXIT.rejected);
  assert.match(writeError.message, /is needs_reauth/);
  assert.match(writeError.hint!, /life account add google/);

  const removed = created(await cal(["account", "remove", accountId]), "updated");
  assert.equal(removed.status, "disconnected");
  assert.ok(removed.deletedAt);
  assert.deepEqual(await readdir(credentials.dir), [], "the credential file is gone");
  const trash = result<{ events: { id: string }[]; calendars: { id: string }[]; accounts: { id: string }[] }>(await cal(["trash"]));
  assert.deepEqual(trash.accounts.map((a) => a.id), [accountId]);
  assert.deepEqual(trash.calendars.map((c) => c.id).sort(), (await calDb.store.read((tx) => tx.all("calendar", { includeDeleted: true }))).map((c) => c.id).sort());
  assert.ok(trash.events.length > 5, "every event went with the account");
  assert.deepEqual(result<unknown[]>(await cal(["account", "list"])), []);
  const afterwards = result<{ freshness: AnyFreshness; timed: AnyEntry[] }>(await cal(["today"]));
  assert.deepEqual(afterwards.freshness, [], "back to todo-only");
  assert.deepEqual(labels(afterwards.timed), ["T:Call the dentist"]);
  const gone = await cal(["account", "get", accountId]);
  assert.equal(result<{ deletedAt: string | null }>(gone).deletedAt !== null, true, "get by id still finds the removed account, marked");
  const removedRef = await cal(["account", "sync", "home"]);
  assert.equal(failed(removedRef, "not_found", EXIT.rejected).code, "not_found");
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

// ------------------------------------------------------------------ the library: movie, show, game, book, media

// 2026-09-12T12:00Z is 05:00 in Los Angeles, so today is 2026-09-12 (a Saturday; the ISO week starts 2026-09-07).
const LIB_NOW = "2026-09-12T12:00:00Z";
const libClock = fixedClock(LIB_NOW, TZ);
const MEDIA4 = ["movie", "show", "game", "book"] as const;
let libDb: TestDb;
let libUrl: string;
let tokenDir: string;
let tmdb: FakeCatalog;
let openlibrary: FakeCatalog;
let igdb: FakeCatalog;

/** `inProcess` against the library schema with the three FakeCatalogs injected and a fixed clock. */
const lib = (args: string[], opts: InProcessOptions = {}): Promise<Run> =>
  inProcess(args, { db: libUrl, clock: libClock, ...opts, io: { catalogs: { tmdb, openlibrary, igdb }, igdbTokenDir: tokenDir, ...opts.io } });

type AnyOn = { date: string | null; precision: string };
type AnyAvailability = { kind: string; name: string; url: string; region: string; price: { amount: number; currency: string } | null; constructed: boolean };
type AnyTitleEntry = { id: string; type: string; on: AnyOn; text: string | null; progress: string | null; format: string | null; rating: number | null; minutes: number | null; spend: { amount: number; currency: string; kind: string } | null; where: string | null };
type AnyTitle = {
  id: string; medium: string; name: string; aliases: string[]; year: number | null; creators: string[]; status: string; ownership: string;
  ownershipDetail: { where: string | null; since: AnyOn | null; price: { amount: number; currency: string } | null } | null;
  rating: number | null; review: string | null; liked: boolean; priority: string | null; notes: string | null;
  catalog: { source: string; externalId: string } | null; facts: { availability: AnyAvailability[] } | null; length: Record<string, number> | null;
  detail: { format: string | null; platform: string | null; where: string | null }; entries: AnyTitleEntry[]; origin: { actor: string; evidence: string[] }; deletedAt: string | null; version: number;
};
type AnySummary = { id: string; medium: string; name: string; year: number | null; status: string; ownership: string; priority: string | null; rating: number | null; liked: boolean; lastEntry: { type: string; on: AnyOn; text: string | null } | null };
type AnyCandidate = { source: string; externalId: string; name: string; year: number | null; creators: string[]; inLibrary: string | null; availability?: AnyAvailability[] };
type Report = { healthy: boolean; checks: { name: string; status: string; value: string; hint?: string }[] };

/** Assert an ok title receipt and return its record. */
const title = (run: Run, outcome = "created"): AnyTitle => created(run, outcome) as unknown as AnyTitle;
const us = (kind: Availability["kind"], name: string, url: string, price: { amount: number; currency: string } | null = null, constructed = false): Availability => ({ kind, name, url, region: "US", price, constructed });
const DUNE_SERIES = {
  name: "Dune Collection",
  position: 1,
  entries: [
    { externalId: "438631", name: "Dune", position: 1, released: "2021-10-22" },
    { externalId: "693134", name: "Dune: Part Two", position: 2, released: "2024-02-27" },
    { externalId: "999", name: "Dune: Part Three", position: 3, released: "2026-12-18" },
  ],
};

before(async () => {
  libDb = await createTestDb();
  libUrl = `${databaseUrl()}${databaseUrl().includes("?") ? "&" : "?"}options=-c search_path=${libDb.schema}`;
  tokenDir = await mkdtemp(join(tmpdir(), "life-cli-igdb-"));
  tmdb = new FakeCatalog({ source: "tmdb" });
  openlibrary = new FakeCatalog({ source: "openlibrary" });
  igdb = new FakeCatalog({ source: "igdb" });
  tmdb.seed("movie", [
    { externalId: "329865", name: "Arrival", year: 2016, creators: ["Denis Villeneuve"], length: { minutes: 116 }, availability: [us("stream", "Paramount+", "https://paramountplus.example/arrival"), us("rent", "Apple TV", "https://tv.apple.example/arrival", { amount: 3.99, currency: "USD" }), { kind: "stream", name: "Netflix", url: "https://netflix.example/gb/arrival", region: "GB", price: null, constructed: false }] },
    { externalId: "438631", name: "Dune", year: 2021, creators: ["Denis Villeneuve"], facts: { released: "2021-10-22", series: DUNE_SERIES }, availability: [us("buy", "Apple TV", "https://tv.apple.example/dune", { amount: 19.99, currency: "USD" })] },
    { externalId: "841", name: "Dune", year: 1984, creators: ["David Lynch"] },
    { externalId: "693134", name: "Dune: Part Two", year: 2024, creators: ["Denis Villeneuve"], facts: { released: "2024-02-27", series: { ...DUNE_SERIES, position: 2 } }, availability: [us("buy", "Apple TV", "https://tv.apple.example/dune2", { amount: 19.99, currency: "USD" }), us("rent", "Apple TV", "https://tv.apple.example/dune2?rent", { amount: 5.99, currency: "USD" })] },
  ]);
  tmdb.seed("show", [{ externalId: "95396", name: "Severance", year: 2022, creators: ["Dan Erickson"], length: { seasons: 2, episodes: 19 } }]);
  openlibrary.seed("book", [
    { externalId: "OL1W", name: "Skyward", year: 2018, creators: ["Brandon Sanderson"], editionCount: 40, length: { pages: 510 }, availability: [us("listen", "Audible", "https://audible.example/search?keywords=Skyward", null, true), us("borrow", "Libby", "https://libbyapp.example/search/Skyward", null, true)] },
    { externalId: "OL2W", name: "Skyward Flight", year: 2021, creators: ["Brandon Sanderson"], editionCount: 5 },
    { externalId: "OL3W", name: "Project Hail Mary", year: 2021, creators: ["Andy Weir"], editionCount: 30 },
  ]);
  igdb.seed("game", [
    { externalId: "1", name: "Hollow Knight", year: 2017, creators: ["Team Cherry"], category: "main", availability: [us("buy", "Steam", "https://store.steampowered.example/367520", { amount: 14.99, currency: "USD" })] },
    { externalId: "2", name: "Hollow Knight: Silksong", year: 2025, creators: ["Team Cherry"], category: "main" },
    { externalId: "3", name: "Celeste", year: 2018, creators: ["Maddy Makes Games"], category: "main" },
  ]);
});
after(async () => {
  await libDb.drop();
  await rm(tokenDir, { recursive: true, force: true });
});

test("help alone reaches every movie, show, game, book, and media command; the group notes explain refs, dates, ratings, and entry types; inapplicable flags are usage errors per medium", async () => {
  for (const group of [...MEDIA4, "media"] as const) {
    const help = await life(["help", group]);
    assert.equal(help.code, EXIT.ok);
    assert.equal(help.stdout.trimEnd(), groupHelp(group));
    for (const command of COMMANDS.values()) if (command.group === group) assert.match(help.stdout, new RegExp(`^  life ${group} ${command.name}\\b.*  \\S`, "m"), `${group} ${command.name} with a purpose`);
    assert.match(help.stdout, /^refs: a title id \(m_\.\.\.\) or a name/m, `${group} names its ref rule`);
    assert.match(help.stdout, /^dates: .*YYYY-MM-DD~w/m, `${group} names the date forms`);
  }
  const TABLE = ["add", "get", "list", "update", "want", "start", "resume", "pause", "again", "progress", "note", "finish", "drop", "buy", "borrow", "return", "service", "rate", "unrate", "review", "like", "unlike", "where", "next", "series", "lookup", "link", "unlink", "refresh", "merge", "amend", "unlog", "relog", "curious", "backlog", "buy-list", "shelf", "delete", "restore", "history"];
  for (const medium of MEDIA4) {
    for (const command of TABLE) assert.ok(COMMANDS.has(`${medium} ${command}`), `${medium} ${command} exists`);
    const help = (await life(["help", medium])).stdout;
    assert.match(help, /^ratings: half stars from 0\.5 to 5, written 4\.5 or 4½/m);
    assert.match(help, /^entry types and the states they are allowed from/m);
    for (const type of ["want", "start", "again", "resume", "pause", "finish", "drop", "progress, note", "buy, borrow, service"]) assert.match(help, new RegExp(`^  ${type}\\s+\\S`, "m"), `${medium}: ${type} in the table`);
    assert.match(help, /^minutes: --minutes is one sitting's time, never cumulative/m);
    assert.match(help, /^list hides dropped titles unless --status names them/m);
    assert.match(help, new RegExp(`^entry ids \\(n_\\.\\.\\.\\) come from \`life ${medium} get <ref>\` and \`life ${medium} history <ref>\``, "m"));
  }
  for (const command of ["list", "get", "now", "curious", "backlog", "buy-list", "shelf", "diary", "time", "year", "search", "availability"]) assert.ok(COMMANDS.has(`media ${command}`), `media ${command} exists`);
  assert.match((await life(["help", "book"])).stdout, /^audiobooks are books: pass --format audiobook/m);
  assert.doesNotMatch((await life(["help", "movie"])).stdout, /^audiobooks/m);
  assert.deepEqual((result<{ notes: string[] }>(await life(["help", "book", "--json"]))).notes.at(-1)?.startsWith("audiobooks are books"), true, "the notes hook is in the help data too");

  const bookAdd = (await life(["help", "book", "add"])).stdout;
  assert.equal(bookAdd.trimEnd(), commandHelp(COMMANDS.get("book add")!));
  assert.match(bookAdd, /^  --format <audiobook\|physical\|kindle>/m);
  assert.match(bookAdd, /^  --seen-before \[date\] /m, "an optional value shows in brackets");
  assert.match(bookAdd, /^  --on <date> .*YYYY-MM-DD~w/m);
  assert.doesNotMatch(bookAdd, /^  --platform/m);
  assert.doesNotMatch(bookAdd, /^  --watched-on/m);
  const gameAdd = (await life(["help", "game", "add"])).stdout;
  assert.match(gameAdd, /^  --platform <text>/m);
  assert.doesNotMatch(gameAdd, /^  --format/m);
  assert.doesNotMatch(gameAdd, /^  --watched-on/m);
  for (const medium of ["movie", "show"]) {
    const add = (await life(["help", medium, "add"])).stdout;
    assert.match(add, /^  --watched-on <text>/m);
    assert.doesNotMatch(add, /^  --format/m);
    assert.doesNotMatch(add, /^  --platform/m);
  }
  assert.match((await life(["help", "book", "update"])).stdout, /^  --no-format/m);
  assert.doesNotMatch((await life(["help", "movie", "update"])).stdout, /^  --no-format/m);

  const bad = await life(["book", "add", "Skyward", "--platform", "Switch"]);
  assert.match(failed(bad, "usage", EXIT.usage).message, /^unknown flag --platform for `life book add`/);
  assert.match(bad.stderr, /^usage: life book add/m, "the command's help follows");
  assert.match(failed(await life(["game", "add", "Celeste", "--format", "kindle"]), "usage", EXIT.usage).message, /unknown flag --format for `life game add`/);
  assert.match(failed(await life(["movie", "update", "Arrival", "--no-platform"]), "usage", EXIT.usage).message, /unknown flag --no-platform/);
  assert.match(failed(await life(["show", "start", "Severance", "--format", "audiobook"]), "usage", EXIT.usage).message, /unknown flag --format for `life show start`/);
  assert.match(failed(await life(["movie", "list", "--format", "kindle"]), "usage", EXIT.usage).message, /unknown flag --format/);
  assert.match(failed(await life(["media", "list", "--format", "kindle"]), "usage", EXIT.usage).message, /unknown flag --format for `life media list`/);
  assert.match(failed(await life(["book", "add", "X", "--finished", "--rating", "six"]), "usage", EXIT.usage).message, /--rating expects a rating \(half stars from 0\.5 to 5, written 4\.5 or 4½\), got "six"/);
});

test("the top help lists the library groups, keys, and formats, and documents catalog_unavailable and error.candidates with candidateKind", async () => {
  const top = (await life(["--help"])).stdout;
  for (const group of [...MEDIA4, "media"]) assert.match(top, new RegExp(`^  life ${group} <command>`, "m"), `the ${group} group is listed`);
  for (const name of ["LIFE_TMDB_KEY", "LIFE_IGDB_CLIENT_ID", "LIFE_IGDB_CLIENT_SECRET", "LIFE_REGION"]) assert.ok(top.includes(name), `environment variable ${name}`);
  assert.match(top, /catalog_unavailable \(exit 3\)/);
  assert.match(top, /error\.candidates is Task\[\] \| Title\[\] \| Candidate\[\] with error\.candidateKind task \| title \| catalog/);
  assert.match(top, /m_ \(title\)/);
  assert.match(top, /n_ \(a diary entry inside a title\)/);
  assert.match(top, /^  on\s+YYYY-MM-DD, YYYY-MM-DD~w/m);
  assert.match(top, /^  rating\s+half stars/m);
  assert.match(top, /^  3   database, calendar provider, or catalog unavailable \(run `life doctor`\)$/m);
  assert.match((await life(["help", "book", "add"])).stdout, /^  3   database, calendar provider, or catalog unavailable/m);
  assert.deepEqual((result<{ environment: string[] }>(await life(["help", "--json"]))).environment.slice(-4), ["LIFE_TMDB_KEY", "LIFE_IGDB_CLIENT_ID", "LIFE_IGDB_CLIENT_SECRET", "LIFE_REGION"]);
});

test("a flow driven from help alone through the book group: discover add and its audiobook example, run it, read it back with get; the title page prints the take and the diary", async () => {
  const top = (await life(["--help"])).stdout;
  assert.match(top, /^  life book <command>/m);
  const group = (await life(["help", "book"])).stdout;
  assert.ok(group.split("\n").some((line) => /^  life book add <name>/.test(line)), "the group help lists book add with its positional");
  assert.match(group, /run `life help book <command>`/);

  const command = (await life(["help", "book", "add"])).stdout;
  const examples = command.split("\n").filter((line) => /^  life book add /.test(line)).map((line) => line.trim());
  assert.ok(examples.length >= 2, "copy-pasteable examples");
  const example = examples.find((e) => e.includes("--format audiobook") && e.includes("--finished"))!;
  const argv = shellWords(example).slice(1);
  assert.deepEqual(argv.slice(0, 3), ["book", "add", "Skyward"]);
  const run = await lib(argv, { env: { LIFE_ACTOR: undefined } });
  const skyward = title(run);
  assert.equal(envelope(run).warnings, undefined, "a confident lookup warns about nothing");
  assert.equal(skyward.medium, "book");
  assert.equal(skyward.name, "Skyward");
  assert.equal(skyward.year, 2018, "the catalog filled the year");
  assert.deepEqual(skyward.creators, ["Brandon Sanderson"]);
  assert.deepEqual(skyward.catalog, { source: "openlibrary", externalId: "OL1W", pulledAt: LIB_NOW });
  assert.equal(skyward.status, "done");
  assert.equal(skyward.rating, 4.5);
  assert.equal(skyward.liked, true);
  assert.equal(skyward.detail.format, "audiobook");
  assert.equal(skyward.entries.length, 1);
  assert.equal(skyward.entries[0]!.type, "finish");
  assert.deepEqual(skyward.entries[0]!.on, { date: "2026-09-07", precision: "week" }, "~w stored as the ISO week's Monday");
  assert.equal(skyward.entries[0]!.format, "audiobook", "the wanted format is the entry's format too");
  assert.equal(skyward.origin.actor, "codex");
  assert.equal("warnings" in (envelope(run).result as object), false);

  const getHelp = (await life(["help", "book", "get"])).stdout;
  const getExample = getHelp.split("\n").find((line) => /^  life book get "Skyward"/.test(line))!.trim();
  assert.equal(result<AnyTitle>(await lib(shellWords(getExample).slice(1))).id, skyward.id, "the example's ref is the name");

  const human = await lib(["book", "get", "Skyward"], { tty: true });
  assert.equal(human.code, EXIT.ok);
  assert.match(human.stdout, new RegExp(`^${skyward.id}  Skyward \\(2018\\)  book  done$`, "m"));
  assert.match(human.stdout, /^rating       4\.5\/5$/m);
  assert.match(human.stdout, /^liked        yes$/m);
  assert.match(human.stdout, /^catalog      Open Library OL1W \(pulled 2026-09-12T12:00:00Z\)$/m);
  assert.match(human.stdout, /^diary \(1\), newest first$/m);
  assert.match(human.stdout, /^  2026-09-07~w  finish  n_[a-z0-9]{10}  audiobook  4\.5\/5$/m);
  assert.match(human.stdout, /^availability \(2\)$/m);

  const guess = await lib(["book", "finsh", "Skyward"]);
  assert.match(failed(guess, "usage", EXIT.usage).message, /did you mean `life book finish`/);
});

test("a flow driven from help alone through life media: list's example returns compact summaries, --full and get return whole records", async () => {
  const group = (await life(["help", "media"])).stdout;
  assert.match(group, /^  life media list /m);
  assert.match(group, /^output: lists and views return compact summaries/m);
  const listHelp = (await life(["help", "media", "list"])).stdout;
  const example = listHelp.split("\n").find((line) => /^  life media list --json$/.test(line))!.trim();
  const rows = result<AnySummary[]>(await lib(shellWords(example).slice(1)));
  assert.ok(rows.length >= 1);
  const skyward = rows.find((row) => row.name === "Skyward")!;
  assert.deepEqual(Object.keys(skyward), ["id", "medium", "name", "year", "status", "ownership", "priority", "rating", "liked", "timeFit", "moodFit", "lastEntry"], "a summary, not the record");
  assert.equal(skyward.medium, "book");
  assert.equal(skyward.status, "done");
  assert.deepEqual(skyward.lastEntry, { type: "finish", on: { date: "2026-09-07", precision: "week" }, text: null });
  const full = result<AnyTitle[]>(await lib(["media", "list", "--full"]));
  assert.ok("entries" in full[0]!, "--full returns records");
  assert.equal(result<AnyTitle>(await lib(["media", "get", "skyward"])).entries.length, 1);
  const human = await lib(["media", "list"], { tty: true });
  assert.match(human.stdout, new RegExp(`^${skyward.id}  book  done  Skyward \\(2018\\)  4\\.5/5  liked  finish 2026-09-07~w$`, "m"), "one aligned line per title");
});

test("a catalog needs carries the candidates; a terminal asks with a numbered table and takes a number or an id; --json never asks; --catalog and --year retry from scratch; a title duplicate is exit 2 with title candidates", async () => {
  const needs = await lib(["movie", "add", "Dune"]);
  const error = failed(needs, "needs", EXIT.rejected);
  assert.equal(error.needs!.field, "catalog");
  assert.deepEqual(error.needs!.options, ["438631", "841", "693134"], "every hit is a candidate, the two exact matches first");
  assert.match(error.needs!.message, /^3 TMDB candidates for "Dune" \(several exact matches\); pass catalog with one of their ids, or year to narrow the search$/);
  assert.equal(error.candidateKind, "catalog");
  const candidates = error.candidates as AnyCandidate[];
  assert.deepEqual(candidates.map((c) => [c.externalId, c.year, c.inLibrary]), [["438631", 2021, null], ["841", 1984, null], ["693134", 2024, null]]);
  assert.equal(error.hint, 'pass --catalog <id> with one of: 438631 "Dune" (2021), 841 "Dune" (1984), 693134 "Dune: Part Two" (2024); or --year <n> to narrow the search');
  const receipt = envelope(needs).result as AnyReceipt & { candidateKind: string };
  assert.equal(receipt.outcome, "rejected");
  assert.equal(receipt.candidateKind, "catalog");
  assert.equal(receipt.candidates!.length, 3, "the receipt is the library's, candidates included");
  assert.equal(result<AnySummary[]>(await lib(["movie", "list"])).length, 0, "nothing was written");

  const jsonOnTty = await lib(["movie", "add", "Dune", "--json"], { tty: true, input: "1\n" });
  failed(jsonOnTty, "needs", EXIT.rejected);
  assert.equal(result<AnySummary[]>(await lib(["movie", "list"])).length, 0, "--json on a terminal never asks");

  const asked = await lib(["movie", "add", "Dune"], { tty: true, input: "1\n" });
  assert.equal(asked.code, EXIT.ok, asked.stdout + asked.stderr);
  assert.match(asked.stdout, /^#\s+id\s+name \(year\)\s+creators\s+category$/m, "the question is a numbered table");
  assert.match(asked.stdout, /^1\s+438631\s+Dune \(2021\)\s+Denis Villeneuve$/m);
  assert.match(asked.stdout, /^2\s+841\s+Dune \(1984\)\s+David Lynch$/m);
  assert.match(asked.stdout, /^3\s+693134\s+Dune: Part Two \(2024\)\s+Denis Villeneuve$/m);
  assert.match(asked.stdout, /^catalog \[1-3, or the id\]: /m);
  // A terminal echoes the typed answer and its newline; the fake stream does not, so the receipt follows the prompt on the same line here.
  assert.match(asked.stdout, /created m_[a-z0-9]{10} v1  Dune \(2021\)  movie  curious$/m);
  const dune = result<AnyTitle>(await lib(["movie", "get", "Dune"]));
  assert.deepEqual(dune.catalog, { source: "tmdb", externalId: "438631", pulledAt: LIB_NOW }, "the number mapped onto options[0] and add re-ran with --catalog");
  assert.deepEqual(dune.facts!.availability.map((row) => row.name), ["Apple TV"]);

  const byId = await lib(["movie", "add", "Dune", "--allow-duplicate"], { tty: true, input: "841\n" });
  assert.equal(byId.code, EXIT.ok, byId.stdout + byId.stderr);
  assert.match(byId.stdout, new RegExp(`^1\\s+438631\\s+Dune \\(2021\\)\\s+Denis Villeneuve\\s+in the library as ${dune.id}$`, "m"), "a candidate already linked says so");
  assert.match(byId.stdout, /created m_[a-z0-9]{10} v1  Dune \(1984\)  movie  curious$/m);
  const noAnswer = await lib(["movie", "add", "Dune", "--allow-duplicate"], { tty: true, input: "7\n" });
  assert.equal(noAnswer.code, EXIT.rejected);
  assert.match(noAnswer.stdout, /rejected\n  - catalog:/);
  assert.match(noAnswer.stdout, /pass --catalog <id>/);

  const duplicate = await lib(["movie", "add", "Dune"]);
  const dup = failed(duplicate, "duplicate", EXIT.duplicate);
  assert.equal(dup.candidateKind, "title");
  assert.deepEqual((dup.candidates as AnyTitle[]).map((t) => t.year).sort(), [1984, 2021]);
  assert.equal(dup.hint, "pass --allow-duplicate to add anyway, or reuse a candidate: " + (dup.candidates as AnyTitle[]).map((t) => `${t.id} "${t.name}" (${t.year}, ${t.status})`).join(", "));
  const dupHuman = await lib(["movie", "add", "Dune"], { tty: true });
  assert.equal(dupHuman.code, EXIT.duplicate);
  assert.match(dupHuman.stdout, /^duplicate: 2 titles named alike$/m);
  assert.match(dupHuman.stdout, new RegExp(`^  ${dune.id}  curious  Dune \\(2021\\)$`, "m"));
  assert.match(dupHuman.stdout, /^  pass --allow-duplicate to add anyway, or reuse one of them$/m);

  const relinked = await lib(["movie", "add", "Dune", "--catalog", "841", "--allow-duplicate"]);
  assert.match(failed(relinked, "duplicate", EXIT.duplicate).message, /is already linked to tmdb 841; use it, or merge/);
  const narrowed = await lib(["movie", "add", "Dune", "--year", "2021", "--allow-duplicate"]);
  assert.match(failed(narrowed, "duplicate", EXIT.duplicate).message, /is already linked to tmdb 438631/, "--year narrowed the candidates to one, which is linked already");
  assert.match(failed(await lib(["movie", "add", "Dune", "--catalog", "999", "--no-lookup"]), "usage", EXIT.usage).message, /--catalog and --no-lookup exclude each other/);
  const refused = await lib(["movie", "add", "Nope", "--catalog", "nope"]);
  assert.match(failed(refused, "rejected", EXIT.rejected).message, /^catalog: no movie with id "nope" at TMDB$/);
});

test("lookup exits 3 when the source is down and 1 when its key is unset; add warns and creates instead; refresh links the title later and maps catalog_unavailable to exit 3", async () => {
  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 503): down", 503), "search");
  const down = await lib(["movie", "lookup", "Arrival"]);
  const unavailable = failed(down, "catalog_unavailable", EXIT.catalog);
  assert.equal(unavailable.message, "catalog unavailable: TMDB is unavailable (HTTP 503): down");
  assert.match(unavailable.hint!, /life doctor/);
  assert.match(down.stderr, /catalog unavailable/);

  tmdb.failNext(new CatalogUnconfigured("LIFE_TMDB_KEY"), "search");
  const unset = await lib(["movie", "lookup", "Arrival"]);
  const unconfigured = failed(unset, "rejected", EXIT.rejected);
  assert.equal(unconfigured.message, "LIFE_TMDB_KEY is not configured on the API server");
  assert.ok(unconfigured.hint!.includes(ENV_FILE) && /add --no-lookup/.test(unconfigured.hint!));

  tmdb.failNext(new CatalogUnconfigured("LIFE_TMDB_KEY"), "search");
  const added = await lib(["show", "add", "Severance", "--want", "--actor", "codex"]);
  const severance = title(added);
  assert.equal(severance.catalog, null);
  assert.equal(severance.status, "backlog");
  const env = envelope(added);
  assert.equal(env.warnings!.length, 1);
  assert.match(env.warnings![0]!, /^Created without a catalog: LIFE_TMDB_KEY is not set in the root \.env; run life show refresh <ref> once it is$/);
  assert.match(env.warnings![0]!, /created without a catalog/i, "the skill's wording matches case-insensitively");
  assert.equal("warnings" in (env.result as object), false, "lifted into the envelope and nowhere else");
  const human = await lib(["show", "add", "Severance", "--allow-duplicate", "--no-lookup"], { tty: true });
  assert.match(human.stdout, /^created m_[a-z0-9]{10} v1  Severance  show  curious$/m);
  const extra = result<AnyTitle>(await lib(["show", "get", human.stdout.match(/m_[a-z0-9]{10}/)![0]!]));
  created(await lib(["show", "delete", extra.id]), "updated");

  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 500): boom", 500), "search");
  const arrivalRun = await lib(["movie", "add", "Arrival"]);
  const arrival = title(arrivalRun);
  assert.equal(arrival.catalog, null);
  assert.match(envelope(arrivalRun).warnings![0]!, /^Created without a catalog: TMDB is unavailable \(HTTP 500\): boom; run life movie refresh <ref> to link it later$/);

  const refreshed = title(await lib(["show", "refresh", "Severance"]), "updated");
  assert.deepEqual(refreshed.catalog, { source: "tmdb", externalId: "95396", pulledAt: LIB_NOW });
  assert.deepEqual(refreshed.length, { seasons: 2, episodes: 19 });
  const relinked = title(await lib(["movie", "refresh", "arrival"]), "updated");
  assert.equal(relinked.catalog!.externalId, "329865");
  assert.deepEqual(relinked.facts!.availability.map((row) => row.name), ["Paramount+", "Apple TV"], "availability is the region's");

  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 503): down", 503));
  const stuck = await lib(["movie", "refresh", "Arrival"]);
  const stuckError = failed(stuck, "catalog_unavailable", EXIT.catalog);
  assert.match(stuckError.issues[0]!, /^catalog_unavailable: TMDB is unavailable/);
  assert.match(stuckError.hint!, /could not be reached and nothing was stored/);
  assert.equal(result<AnyTitle>(await lib(["movie", "get", "Arrival"])).version, relinked.version, "nothing was stored");
});

test("lookup --where carries availability; where answers from a title's facts or a catalog id live, one line per row with * on constructed links", async () => {
  const found = result<AnyCandidate[]>(await lib(["movie", "lookup", "Arrival", "--where"]));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.externalId, "329865");
  assert.deepEqual(found[0]!.availability!.map((row) => `${row.kind} ${row.name}`), ["stream Paramount+", "rent Apple TV"]);
  assert.match(found[0]!.inLibrary!, /^m_[a-z0-9]{10}$/, "the title exists");
  const human = await lib(["movie", "lookup", "Arrival", "--where"], { tty: true });
  assert.match(human.stdout, /^329865  Arrival \(2016\)  Denis Villeneuve\s+in the library as m_/m);
  assert.match(human.stdout, /^    stream  Paramount\+\s+US  https:\/\/paramountplus\.example\/arrival$/m);
  assert.match(human.stdout, /^    rent    Apple TV    3\.99 USD  US  https/m);
  assert.equal(result<AnyCandidate[]>(await lib(["movie", "lookup", "Dune", "--year", "1984"])).length, 3, "the search returns every hit; --year narrows the confidence rule");

  const live = result<AnyAvailability[]>(await lib(["movie", "where", "--catalog", "329865"]));
  assert.deepEqual(live.map((row) => row.name), ["Paramount+", "Apple TV"]);
  const fromTitle = result<AnyAvailability[]>(await lib(["movie", "where", "Arrival"]));
  assert.deepEqual(fromTitle, live);
  const book = await lib(["book", "where", "Skyward"], { tty: true });
  assert.equal(book.code, EXIT.ok);
  assert.match(book.stdout, /^listen  Audible  \*  US  https:\/\/audible\.example/m, "a constructed link is starred");
  assert.match(book.stdout, /^borrow  Libby    \*  US  /m);
  assert.match(failed(await lib(["movie", "where"]), "usage", EXIT.usage).message, /pass a ref or --catalog <id>/);
  assert.match(failed(await lib(["movie", "where", "Arrival", "--catalog", "1"]), "usage", EXIT.usage).message, /not both/);
  assert.match(failed(await lib(["movie", "where", "Nope"]), "not_found", EXIT.rejected).message, /^title: no movie "Nope"$/);
  tmdb.failNext(new CatalogUnavailable("TMDB is unavailable (HTTP 503): down", 503), "availability");
  failed(await lib(["movie", "where", "--catalog", "329865"]), "catalog_unavailable", EXIT.catalog);
});

test("every date form rides inside the value (day, ~w, month, year, ?), 4½ is a rating, --on defaults to today, and add's flag rules hold", async () => {
  assert.match(failed(await lib(["book", "add", "Project Hail Mary", "--rating", "4"]), "usage", EXIT.usage).message, /--rating and --review need --finished/);
  assert.match(failed(await lib(["book", "add", "X", "--review", "fun"]), "usage", EXIT.usage).message, /--rating and --review need --finished/);
  assert.match(failed(await lib(["book", "add", "X", "--progress", "ch. 2"]), "usage", EXIT.usage).message, /--progress and --minutes need --started/);
  assert.match(failed(await lib(["book", "add", "X", "--minutes", "30"]), "usage", EXIT.usage).message, /--progress and --minutes need --started/);
  assert.match(failed(await lib(["book", "add", "X", "--started-on", "2026-09"]), "usage", EXIT.usage).message, /--started-on needs --started/);
  assert.match(failed(await lib(["game", "buy", "Celeste", "--currency", "EUR"]), "usage", EXIT.usage).message, /--currency and --kind need --price/);
  const badMonth = failed(await lib(["book", "add", "X", "--finished", "--on", "2026-9"]), "usage", EXIT.usage);
  assert.match(badMonth.message, /^--on: "2026-9" is not a date form; use YYYY-MM-DD, YYYY-MM-DD~w/);
  assert.match(badMonth.hint!, /pass --on 2026-09-07, 2026-09-07~w, 2026-09, 2026, or \?/);
  assert.match(failed(await lib(["book", "add", "X", "--finished", "--on", "2026-09-31"]), "usage", EXIT.usage).message, /"2026-09-31" is not a real date/);
  assert.match(failed(await lib(["book", "add", "X", "--finished", "--on", "2026-09~m"]), "usage", EXIT.usage).message, /the only marker is ~w after a full date/);
  assert.match(failed(await lib(["book", "rate", "Skyward", "6"]), "usage", EXIT.usage).message, /^<rating> expects a rating/);
  assert.match(failed(await lib(["book", "rate", "Skyward", "4.25"]), "usage", EXIT.usage).message, /^<rating> expects a rating/);

  const phm = title(await lib(["book", "add", "Project Hail Mary", "--started", "--started-on", "2026-08", "--finished", "--finished-on", "2026-09-07~w", "--rating", "4½", "--review", "fun", "--liked", "--progress", "ch. 1"]));
  assert.equal(phm.catalog!.externalId, "OL3W");
  assert.deepEqual(phm.entries.map((e) => [e.type, e.on, e.rating, e.text, e.progress]), [
    ["start", { date: "2026-08", precision: "month" }, null, null, "ch. 1"],
    ["finish", { date: "2026-09-07", precision: "week" }, 4.5, "fun", null],
  ]);
  assert.equal(phm.status, "done");
  assert.equal(phm.rating, 4.5);
  assert.equal(phm.review, "fun");
  assert.equal(phm.liked, true);

  const again = title(await lib(["book", "again", "Project Hail Mary", "--on", "2026-09-11", "--finished", "--rating", "5", "--format", "kindle"]), "updated");
  assert.deepEqual(again.entries.slice(2).map((e) => [e.type, e.on, e.rating, e.format]), [
    ["again", { date: "2026-09-11", precision: "day" }, null, "kindle"],
    ["finish", { date: "2026-09-11", precision: "day" }, 5, "kindle"],
  ]);
  assert.equal(again.rating, 5, "the latest closing entry's rating");
  assert.match(failed(await lib(["book", "again", "Project Hail Mary", "--rating", "4"]), "usage", EXIT.usage).message, /--rating and --review need --finished/);
  const noted = title(await lib(["book", "note", "Project Hail Mary", "read it on the flight", "--on", "2026"]), "updated");
  assert.deepEqual(noted.entries.find((e) => e.type === "note")!.on, { date: "2026", precision: "year" });
  assert.deepEqual(envelope(await lib(["book", "note", "Project Hail Mary", "warns", "--on", "?"])).warnings, ["title is done; use start if he is on it"]);
  const rated = title(await lib(["book", "rate", "Project Hail Mary", "4½"]), "updated");
  assert.equal(rated.rating, 4.5, "4½ on the positional too");

  const seen = title(await lib(["movie", "add", "Blade Runner", "--no-lookup", "--seen-before", "--finished", "--on", "2026-09-11", "--rating", "4.5"]));
  assert.deepEqual(seen.entries.map((e) => [e.type, e.on, e.rating]), [
    ["finish", { date: null, precision: "unknown" }, null],
    ["finish", { date: "2026-09-11", precision: "day" }, 4.5],
  ]);
  const seenDated = title(await lib(["movie", "add", "Blade Runner 2049", "--no-lookup", "--seen-before", "2019", "--started"]));
  assert.deepEqual(seenDated.entries.map((e) => [e.type, e.on]), [
    ["finish", { date: "2019", precision: "year" }],
    ["again", { date: "2026-09-12", precision: "day" }],
  ], "--seen-before takes a date when one follows, and --on defaults to today in the effective timezone");
  const celeste = title(await lib(["game", "add", "Celeste", "--want", "--actor", "codex"]));
  assert.deepEqual(celeste.entries[0]!.on, { date: "2026-09-12", precision: "day" });

  const human = await lib(["book", "get", "Project Hail Mary"], { tty: true });
  const lines = human.stdout.split("\n");
  const at = (pattern: RegExp) => lines.findIndex((line) => pattern.test(line));
  assert.match(human.stdout, /^diary \(6\), newest first$/m);
  const order = [at(/^  2026-09-11 {2,}finish/), at(/^  2026-09-11 {2,}again/), at(/^  2026-09-07~w {2,}finish/), at(/^  2026-08~m {2,}start/), at(/^  2026~y {2,}note/), at(/^  \? {2,}note/)];
  assert.ok(order.every((i) => i > 0), `every marker prints: ${JSON.stringify(order)}\n${human.stdout}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "newest first: day, week, month, year, then ?");
});

test("refs by name everywhere: exact, case-insensitive, alias, substring; several matches are a needs on ref with the titles; another medium is named; ids are checked against the group", async () => {
  const skyward = title(await lib(["book", "update", "Skyward", "--alias", "Sky1", "--priority", "later"]), "updated");
  assert.deepEqual(skyward.aliases, ["Sky1"]);
  assert.equal(result<AnyTitle>(await lib(["book", "get", "sky1"])).id, skyward.id, "alias");
  assert.equal(result<AnyTitle>(await lib(["book", "get", "hail mary"])).name, "Project Hail Mary", "substring");
  assert.equal(result<AnyTitle>(await lib(["book", "get", "SKYWARD"])).id, skyward.id, "case");
  assert.equal(result<AnyTitle>(await lib(["media", "get", "Skyward"])).medium, "book", "media resolves across media");

  const ambiguous = await lib(["movie", "start", "Dune"]);
  const error = failed(ambiguous, "needs", EXIT.rejected);
  assert.equal(error.needs!.field, "ref");
  assert.equal(error.candidateKind, "title");
  assert.deepEqual(new Set((error.candidates as AnyTitle[]).map((t) => t.id)), new Set(error.needs!.options));
  assert.match(error.message, /^"Dune" names 2 movies \(m_[a-z0-9]{10}, m_[a-z0-9]{10}\); use the id$/);
  assert.equal(error.hint, "pass the title's id as the ref, one of: " + (error.candidates as AnyTitle[]).map((t) => `${t.id} "${t.name}" (${t.year}, ${t.status})`).join(", "));
  const ambiguousGet = await lib(["movie", "get", "Dune"]);
  assert.equal(failed(ambiguousGet, "needs", EXIT.rejected).candidateKind, "title");
  const human = await lib(["movie", "get", "Dune"], { tty: true });
  assert.equal(human.code, EXIT.rejected);
  assert.match(human.stdout, /^rejected$/m);
  assert.match(human.stdout, /^  m_[a-z0-9]{10}  curious  Dune \(2021\)$/m);
  assert.match(human.stdout, /^  pass the title's id as the ref/m);

  const wrong = await lib(["game", "get", "Skyward"]);
  const elsewhere = failed(wrong, "not_found", EXIT.rejected);
  assert.match(elsewhere.message, new RegExp(`^title: no game "Skyward"; found as book ${skyward.id}; use life book$`));
  assert.match(elsewhere.hint!, /run `life game list --text "<part of the name>"`/);
  assert.match(failed(await lib(["game", "get", skyward.id]), "not_found", EXIT.rejected).message, /is a book, not a game; use life book/);
  assert.match(failed(await lib(["game", "start", "Skyward"]), "not_found", EXIT.rejected).message, /found as book/);
  assert.match(failed(await lib(["book", "start", "Nope"]), "not_found", EXIT.rejected).message, /^title: no book "Nope"$/);
});

test("entry commands and corrections: start, progress, buy with a price, borrow needs --where, service, return, pause, resume, drop, finish with the next in a series, next --queue, series, rate, unrate, review, like, unlike, amend, unlog, relog, merge, trash, restore, history", async () => {
  // Distinct commands are recorded at distinct instants; equal timestamps deliberately use the derivation rank.
  let tick = Date.parse(LIB_NOW);
  const stepLib = (args: string[], opts: InProcessOptions = {}) =>
    lib(args, { ...opts, clock: fixedClock(new Date(tick += 1000).toISOString(), TZ) });
  const hk = title(await stepLib(["game", "add", "Hollow Knight", "--want", "--platform", "Switch", "--actor", "codex", "--evidence", 'chat:2026-09-12 "wants to play it"']));
  assert.equal(hk.status, "backlog");
  assert.equal(hk.catalog!.externalId, "1", "one exact match among two hits auto-links");
  assert.equal(hk.detail.platform, "Switch");
  assert.deepEqual(hk.origin.evidence, ['chat:2026-09-12 "wants to play it"']);

  const started = title(await stepLib(["game", "start", "hollow knight", "--progress", "2 hours in", "--minutes", "120"]), "updated");
  assert.equal(started.status, "active");
  const start = started.entries.at(-1)!;
  assert.deepEqual([start.type, start.progress, start.minutes, start.on], ["start", "2 hours in", 120, { date: "2026-09-12", precision: "day" }], "--on defaults to today");
  const progressed = await stepLib(["game", "progress", "Hollow Knight", "5 hours in", "--minutes", "45"], { tty: true });
  assert.match(progressed.stdout, new RegExp(`^updated ${hk.id} v3  Hollow Knight \\(2017\\)  game  active$`, "m"), "every success line carries the id");
  assert.deepEqual(envelope(await stepLib(["game", "progress", "Celeste", "1 hour in"])).warnings, ["title is backlog; use start if he is on it"]);

  const bought = title(await stepLib(["game", "buy", "Hollow Knight", "--where", "Steam", "--price", "14.99"]), "updated");
  assert.equal(bought.ownership, "owned");
  assert.deepEqual(bought.ownershipDetail, { where: "Steam", since: { date: "2026-09-12", precision: "day" }, price: { amount: 14.99, currency: "USD" } });
  assert.deepEqual(bought.entries.at(-1)!.spend, { amount: 14.99, currency: "USD", kind: "purchase" }, "--currency defaults from the region, --kind to purchase");
  const rental = title(await stepLib(["movie", "buy", "Arrival", "--price", "3.99", "--kind", "rental", "--currency", "eur", "--where", "Apple TV"]), "updated");
  assert.deepEqual(rental.entries.at(-1)!.spend, { amount: 3.99, currency: "EUR", kind: "rental" });
  assert.match(failed(await stepLib(["game", "borrow", "Celeste"]), "usage", EXIT.usage).message, /^life game borrow: pass --where <lender>$/);
  assert.equal(title(await stepLib(["game", "borrow", "Celeste", "--where", "a friend"]), "updated").ownership, "borrowed");
  const onService = title(await stepLib(["game", "service", "Celeste", "--where", "Game Pass"]), "updated");
  assert.equal(onService.ownership, "service");
  assert.equal(onService.ownershipDetail!.where, "Game Pass");
  assert.equal(title(await stepLib(["game", "return", "Celeste"]), "updated").ownership, "none");
  const nothing = failed(await stepLib(["game", "return", "Celeste"]), "rejected", EXIT.rejected);
  assert.equal(nothing.message, "return: ownership is none; nothing to return");
  assert.match(nothing.hint!, /record `buy`, `borrow`, or `service` first/);

  assert.equal(title(await stepLib(["game", "pause", "Hollow Knight", "--text", "waiting for a patch"]), "updated").status, "paused");
  const refused = failed(await stepLib(["game", "pause", "Hollow Knight"]), "rejected", EXIT.rejected);
  assert.equal(refused.message, "pause: title is paused; not active");
  assert.match(refused.hint!, /`life game get <ref>` shows the status and the diary/);
  const refusedHuman = await stepLib(["book", "start", "Skyward"], { tty: true });
  assert.equal(refusedHuman.code, EXIT.rejected);
  assert.match(refusedHuman.stdout, /^rejected m_[a-z0-9]{10}\n  - start: title is done; already done; use again\n  /, "a rejection on a resolved title names its id, as task rejections do");
  assert.equal(title(await stepLib(["game", "resume", "Hollow Knight"]), "updated").status, "active");
  assert.match(failed(await stepLib(["game", "drop", "Celeste"]), "usage", EXIT.usage).message, /missing <text>/);
  const dropped = title(await stepLib(["game", "drop", "Celeste", "not fun anymore, the difficulty spikes are the problem", "--rating", "2"]), "updated");
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.review, "not fun anymore, the difficulty spikes are the problem");
  assert.equal(dropped.rating, 2);

  const movies = result<AnySummary[]>(await stepLib(["movie", "list", "--text", "Dune"]));
  const dune = movies.find((row) => row.year === 2021)!;
  const dune84 = movies.find((row) => row.year === 1984)!;
  const finished = await stepLib(["movie", "finish", dune.id, "--rating", "4", "--review", "big screen stuff", "--on", "2026-09-05"]);
  const done = title(finished, "updated");
  assert.equal(done.status, "done");
  assert.equal(done.rating, 4);
  assert.equal(done.review, "big screen stuff");
  assert.deepEqual((envelope(finished).result as { next: unknown }).next, { externalId: "693134", name: "Dune: Part Two", position: 2, titleId: null });
  assert.deepEqual(envelope(finished).warnings, ['Next in Dune Collection: "Dune: Part Two"']);
  const again = failed(await stepLib(["movie", "finish", dune.id]), "rejected", EXIT.rejected);
  assert.equal(again.message, "finish: title is done; already done; use again");

  const next = result<{ seriesEntry: { name: string; externalId: string }; title: null }>(await stepLib(["movie", "next", dune.id]));
  assert.equal(next.seriesEntry.name, "Dune: Part Two");
  assert.equal(next.title, null);
  assert.match((await stepLib(["movie", "next", dune.id], { tty: true })).stdout, /^Next after Dune: "Dune: Part Two" \(#2\), catalog 693134; not in the library; pass --queue to add it to the backlog$/m);
  const queued = title(await stepLib(["movie", "next", dune.id, "--queue", "--actor", "codex"]));
  assert.equal(queued.name, "Dune: Part Two");
  assert.equal(queued.status, "backlog");
  assert.equal(queued.catalog!.externalId, "693134");
  assert.deepEqual(queued.origin.evidence, [`series:${dune.id}`]);
  const queuedAgain = await stepLib(["movie", "next", dune.id, "--queue"]);
  assert.equal(queuedAgain.code, EXIT.ok);
  assert.match(envelope(queuedAgain).warnings![0]!, new RegExp(`already in the library as ${queued.id} \\(backlog\\); nothing queued`));
  const series = result<{ name: string; position: number; entries: { name: string; title: { id: string } | null }[] }>(await stepLib(["movie", "series", "Dune: Part Two"]));
  assert.equal(series.name, "Dune Collection");
  assert.equal(series.position, 2);
  assert.deepEqual(series.entries.map((e) => [e.name, e.title?.id ?? null]), [["Dune", dune.id], ["Dune: Part Two", queued.id], ["Dune: Part Three", null]]);
  const seriesHuman = await stepLib(["movie", "series", dune.id], { tty: true });
  assert.match(seriesHuman.stdout, /^Dune Collection \(this title is #1\)$/m);
  assert.match(seriesHuman.stdout, /^  #3  Dune: Part Three  2026-12-18  999     not in the library$/m);
  assert.match((await stepLib(["movie", "series", "Arrival"], { tty: true })).stdout, /^Arrival is not in a series/);

  assert.equal(title(await stepLib(["movie", "rate", dune.id, "4.5"]), "updated").rating, 4.5);
  assert.equal(title(await stepLib(["movie", "unrate", dune.id]), "updated").rating, null);
  const nothingToRate = failed(await stepLib(["movie", "rate", "Arrival", "3"]), "rejected", EXIT.rejected);
  assert.equal(nothingToRate.message, "rating: nothing to rate; finish or drop first");
  assert.match(nothingToRate.hint!, /finish or drop the title first/);
  assert.equal(title(await stepLib(["movie", "review", dune.id, "rewatch worthy"]), "updated").review, "rewatch worthy");
  assert.equal(title(await stepLib(["movie", "like", dune.id]), "updated").liked, true);
  assert.equal(title(await stepLib(["movie", "unlike", dune.id]), "updated").liked, false);

  const finishEntry = done.entries.find((e) => e.type === "finish")!;
  const amended = title(await stepLib(["movie", "amend", dune.id, finishEntry.id, "--on", "2026-09-06", "--no-rating", "--reason", "he named the day"]), "updated");
  const amendedEntry = amended.entries.find((e) => e.id === finishEntry.id)!;
  assert.deepEqual([amendedEntry.on, amendedEntry.rating, amendedEntry.text], [{ date: "2026-09-06", precision: "day" }, null, "rewatch worthy"]);
  assert.match(failed(await stepLib(["movie", "amend", dune.id, finishEntry.id]), "usage", EXIT.usage).message, /nothing to change/);
  const noEntry = failed(await stepLib(["movie", "amend", dune.id, "n_zzzzzzzzzz", "--on", "2026-09-06"]), "rejected", EXIT.rejected);
  assert.match(noEntry.message, /^entry: no entry "n_zzzzzzzzzz" on m_/);
  assert.match(noEntry.hint!, /entry ids \(n_\.\.\.\) are listed by `life movie get <ref>` and `life movie history <ref>`/);
  const retyped = title(await stepLib(["movie", "amend", dune.id, finishEntry.id, "--type", "drop", "--text", "changed his mind"]), "updated");
  assert.equal(retyped.status, "dropped", "amend changes the type and the diary re-derives");
  title(await stepLib(["movie", "amend", dune.id, finishEntry.id, "--type", "finish"]), "updated");

  const relogged = await stepLib(["movie", "relog", dune.id, finishEntry.id, "--to", "Dune: Part Two", "--reason", "wrong title"]);
  created(relogged, "updated");
  assert.ok(envelope(relogged).warnings!.some((warning) => warning === `Moved finish ${finishEntry.id} to Dune: Part Two (${queued.id}), now backlog`));
  assert.ok(envelope(relogged).warnings!.some((warning) => warning.includes("finish on 2026-09-06 is not the latest entry")));
  assert.equal(result<AnyTitle>(await stepLib(["movie", "get", dune.id])).status, "curious", "the source re-derived");
  const partTwo = result<AnyTitle>(await stepLib(["movie", "get", "Dune: Part Two"]));
  assert.equal(partTwo.status, "backlog", "the later want decides status after the backdated finish moves");
  const unlogged = await stepLib(["movie", "unlog", "Dune: Part Two", finishEntry.id, "--reason", "logged twice"]);
  const unlogReceipt = envelope(unlogged).result as { removed: { id: string; type: string }; record: AnyTitle };
  assert.equal(unlogReceipt.removed.id, finishEntry.id);
  assert.equal(unlogReceipt.record.status, "backlog", "the want remains");
  assert.match((await stepLib(["movie", "unlog", "Dune: Part Two", unlogReceipt.record.entries[0]!.id, "--reason", "again"], { tty: true })).stdout, /^  removed 2026-09-12  want  n_/m);
  title(await stepLib(["movie", "want", "Dune: Part Two"]), "updated");

  const merged = await stepLib(["movie", "merge", dune84.id, dune.id, "--reason", "added twice"]);
  created(merged, "updated");
  assert.match(envelope(merged).warnings![0]!, new RegExp(`^Merged Dune \\(${dune84.id}\\) into Dune \\(${dune.id}\\); ${dune84.id} is in the trash$`));
  const gone = result<AnyTitle>(await stepLib(["movie", "get", dune84.id]));
  assert.ok(gone.deletedAt);
  assert.match(gone.notes!, new RegExp(`merged into ${dune.id}`));
  const trash = result<{ titles: { id: string }[] }>(await stepLib(["trash"]));
  assert.ok(trash.titles.some((t) => t.id === dune84.id));
  assert.match((await stepLib(["trash"], { tty: true })).stdout, /^Titles \(2\)\n  m_[a-z0-9]{10}  movie  curious  Dune \(1984\)/m);
  assert.equal(result<AnyTitle>(await stepLib(["movie", "get", "Dune"])).id, dune.id, "the surviving title resolves by name after merge");
  assert.equal(title(await stepLib(["movie", "restore", dune84.id]), "updated").deletedAt, null);
  title(await stepLib(["movie", "delete", dune84.id, "--reason", "keep one"]), "updated");
  const deleted = title(await stepLib(["movie", "delete", "Blade Runner 2049", "--reason", "never mind"]), "updated");
  assert.ok(deleted.deletedAt);
  assert.match(failed(await stepLib(["movie", "get", "Blade Runner 2049"]), "not_found", EXIT.rejected).message, /^title: no movie "Blade Runner 2049"$/);
  assert.equal(result<AnyTitle>(await stepLib(["movie", "get", deleted.id])).id, deleted.id, "by id, deleted included");

  const history = result<{ op: string }[]>(await stepLib(["game", "history", "Hollow Knight"]));
  assert.deepEqual(history.map((e) => e.op), ["title.add", "title.start", "title.progress", "title.buy", "title.pause", "title.resume"]);
  assert.match(failed(await stepLib(["game", "history", "Nope"]), "not_found", EXIT.rejected).message, /^title: no game "Nope"$/);
  assert.match((await stepLib(["game", "history", "Hollow Knight"], { tty: true })).stdout, /title\.add .*created: Hollow Knight/);
});

test("views: now, curious, backlog, buy-list, shelf per medium and across media; diary, time, year, search; ranges take the date forms and refuse ?", async () => {
  const hk = result<AnyTitle>(await lib(["game", "get", "Hollow Knight"]));
  assert.deepEqual(result<AnySummary[]>(await lib(["game", "now"])).map((row) => row.id), [hk.id]);
  const now = result<AnySummary[]>(await lib(["media", "now"]));
  assert.ok(now.some((row) => row.id === hk.id && row.medium === "game"));
  assert.ok(!now.some((row) => row.name === "Skyward"), "done titles are not on now");
  assert.ok(result<AnySummary[]>(await lib(["movie", "curious"])).some((row) => row.name === "Arrival"));

  const buyList = result<{ title: AnySummary; availability: AnyAvailability[]; lowestPrice: { amount: number; currency: string } | null }[]>(await lib(["media", "buy-list"]));
  const partTwo = buyList.find((item) => item.title.name === "Dune: Part Two")!;
  assert.deepEqual(partTwo.lowestPrice, { amount: 5.99, currency: "USD" });
  assert.deepEqual(partTwo.availability.map((row) => row.kind), ["buy", "rent"]);
  assert.ok(buyList.some((item) => item.title.name === "Severance" && item.lowestPrice === null));
  assert.match((await lib(["movie", "buy-list"], { tty: true })).stdout, /Dune: Part Two \(2024\).*lowest 5\.99 USD\n  buy   Apple TV  19\.99 USD/);
  assert.equal(result<AnySummary[]>(await lib(["media", "backlog"])).length, 0, "backlog needs ownership");
  title(await lib(["movie", "service", "Dune: Part Two", "--where", "Apple TV"]), "updated");
  assert.deepEqual(result<AnySummary[]>(await lib(["media", "backlog"])).map((row) => row.name), ["Dune: Part Two"]);
  assert.deepEqual(result<AnySummary[]>(await lib(["movie", "backlog", "--service", "Apple TV"])).map((row) => row.name), ["Dune: Part Two"]);
  assert.equal(result<AnySummary[]>(await lib(["movie", "backlog", "--service", "Netflix"])).length, 0);
  assert.deepEqual(result<AnySummary[]>(await lib(["media", "backlog", "--wanted-again"])).map((row) => row.name).sort(), ["Dune: Part Two", "Skyward"], "Skyward already has a replay priority from the ref test");
  title(await lib(["book", "update", "Project Hail Mary", "--priority", "soon"]), "updated");
  assert.ok(result<AnySummary[]>(await lib(["media", "backlog", "--wanted-again"])).some((row) => row.name === "Project Hail Mary"), "a done title with a priority is wanted again");
  const shelf = result<{ done: AnySummary[]; inProgress: AnySummary[]; untouched: AnySummary[]; dropped: AnySummary[] }>(await lib(["game", "shelf"]));
  assert.deepEqual(shelf.inProgress.map((row) => row.id), [hk.id]);
  assert.match((await lib(["media", "shelf"], { tty: true })).stdout, /^In progress \(1\)\n  m_[a-z0-9]{10}  game  active  owned  Hollow Knight \(2017\)/m);
  assert.ok("entries" in result<AnyTitle[]>(await lib(["game", "now", "--full"]))[0]!, "--full on a view returns records");

  const diary = result<{ entries: { type: string; medium: string; titleName: string; on: AnyOn }[] }>(await lib(["media", "diary", "--since", "2026-09", "--medium", "game"]));
  assert.ok(diary.entries.length >= 5);
  assert.ok(diary.entries.every((e) => e.medium === "game" && e.on.precision !== "unknown"));
  assert.ok(diary.entries.every((e, i, all) => i === 0 || all[i - 1]!.on.date! >= e.on.date!), "newest first");
  assert.equal(result<{ entries: unknown[] }>(await lib(["media", "diary", "--since", "2026-09-07~w", "--until", "2026-09-07~w", "--limit", "2"])).entries.length, 2);
  assert.match(failed(await lib(["media", "diary", "--since", "?"]), "usage", EXIT.usage).message, /^--since: \? cannot bound a range$/);
  assert.match(failed(await lib(["media", "diary", "--since", "2026-09-10", "--until", "2026-09-01"]), "rejected", EXIT.rejected).message, /is after until 2026-09-01/);
  assert.match((await lib(["media", "diary", "--medium", "game"], { tty: true })).stdout, /^2026-09-12  game  Hollow Knight  buy /m);

  const time = result<{ from: string; to: string; total: { minutes: Record<string, number>; spend: Record<string, { purchase: number }> }; weeks: { from: string }[]; unplaced: number }>(await lib(["media", "time", "--since", "2026-09-07~w", "--until", "2026-09-07~w"]));
  assert.equal(time.from, "2026-09-07");
  assert.equal(time.to, "2026-09-13");
  assert.equal(time.total.minutes.game, 165, "120 and 45 today");
  assert.equal(time.total.spend.USD!.purchase, 14.99);
  assert.equal(time.weeks.length, 1);
  assert.equal(result<{ weeks: unknown[] }>(await lib(["media", "time", "--weeks", "3"])).weeks.length, 3);
  assert.match(failed(await lib(["media", "time", "--weeks", "0"]), "rejected", EXIT.rejected).message, /^time: weeks: /);
  assert.match((await lib(["media", "time", "--since", "2026-09"], { tty: true })).stdout, /^Time 2026-09-01 to 2026-09-13: game 165 min; 3\.99 EUR rental; 14\.99 USD purchase/m);

  const year = result<{ year: number; finished: { title: { name: string }; entry: { on: AnyOn } }[]; dropped: { title: { name: string } }[]; again: number; byMedium: Record<string, { count: number; avgRating: number | null }> }>(await lib(["media", "year", "2026"]));
  assert.equal(year.year, 2026);
  assert.deepEqual(year.finished.map((item) => item.title.name).sort(), ["Blade Runner", "Project Hail Mary", "Project Hail Mary", "Skyward"]);
  assert.equal(year.again, 2, "Project Hail Mary and the seen-before Blade Runner completion are replays");
  assert.deepEqual(year.dropped.map((item) => item.title.name), ["Celeste"]);
  assert.equal(year.byMedium.book!.count, 3);
  assert.equal(year.byMedium.book!.avgRating, 4.5, "the later rate command changed the replay rating to 4.5");
  assert.equal(result<{ finished: unknown[] }>(await lib(["media", "year", "2026", "--medium", "movie"])).finished.length, 1);
  assert.match(failed(await lib(["media", "year", "26"]), "usage", EXIT.usage).message, /<yyyy> must be a four-digit year/);
  assert.match((await lib(["media", "year", "2026"], { tty: true })).stdout, /^2026: 4 finished \(2 again\), 1 dropped; /m);

  assert.deepEqual(result<AnySummary[]>(await lib(["media", "search", "waiting for a patch"])).map((row) => row.id), [hk.id], "entry text is searched");
  assert.deepEqual(result<AnySummary[]>(await lib(["media", "search", "Sanderson"])).map((row) => row.name), ["Skyward"], "creators are searched");
  assert.match(failed(await lib(["media", "search", "  "]), "rejected", EXIT.rejected).message, /^search: text is required/);

  const file = join(scratch, "library-export.json");
  const exported = result<{ titles: number; log: number }>(await lib(["export", file]));
  assert.ok(exported.titles >= 8, `titles are counted: ${exported.titles}`);
  assert.match((await lib(["export", file], { tty: true })).stdout, /\d+ events, \d+ titles, \d+ log to /);
});

test("media availability re-pulls one title or the backlog one transaction at a time; a source that is down is catalog_unavailable with exit 3", async () => {
  const one = await lib(["media", "availability", "Hollow Knight", "--actor", "codex"]);
  assert.equal(envelope(one).ok, true, one.stdout + one.stderr);
  assert.equal((envelope(one).result as { outcome: string }).outcome, "unchanged");
  igdb.failNext(new CatalogUnavailable("IGDB is unavailable (HTTP 503): down", 503), "availability");
  const down = await lib(["media", "availability", "Hollow Knight"]);
  assert.match(failed(down, "catalog_unavailable", EXIT.catalog).issues[0]!, /^catalog_unavailable: IGDB is unavailable/);

  const report = result<{ refreshed: { name: string; outcome: string }[]; failed: unknown[] }>(await lib(["media", "availability", "--backlog"]));
  assert.deepEqual(report.refreshed.map((r) => r.name).sort(), ["Dune: Part Two", "Severance"]);
  assert.equal(report.failed.length, 0);
  tmdb.failAlways(new CatalogUnavailable("TMDB is unavailable (HTTP 503): down", 503), "availability");
  try {
    const partly = await lib(["media", "availability", "--backlog", "--medium", "show"]);
    const error = failed(partly, "catalog_unavailable", EXIT.catalog);
    assert.match(error.message, /^1 of 1 titles failed: m_[a-z0-9]{10} \(Severance\): catalog_unavailable: TMDB is unavailable/);
    assert.equal(result<{ failed: unknown[] }>(partly).failed.length, 1);
    assert.match((await lib(["media", "availability", "--backlog", "--medium", "show"], { tty: true })).stdout, /^Refreshed 0, failed 1\.\nFailed\n  m_/);
  } finally {
    tmdb.recover();
  }
  assert.match(failed(await lib(["media", "availability"]), "usage", EXIT.usage).message, /pass a ref or --backlog$/);
  assert.match(failed(await lib(["media", "availability", "x", "--backlog"]), "usage", EXIT.usage).message, /not both/);
  assert.match(failed(await lib(["media", "availability", "Nope"]), "not_found", EXIT.rejected).message, /^title: no title "Nope"$/);
});

test("doctor reports each catalog key present or not, the IGDB token file and its expiry, and LIFE_REGION; --online searches each configured source through the injected catalogs", async () => {
  const io = { credentials: new CredentialStore(join(scratch, "no-credentials", "google")) };
  const check = (report: Report, name: string) => report.checks.find((c) => c.name === name)!;
  const withoutKeys = await lib(["doctor"], { io });
  assert.equal(withoutKeys.code, EXIT.ok, withoutKeys.stdout + withoutKeys.stderr);
  const bare = result<Report>(withoutKeys);
  assert.equal(check(bare, "catalog tmdb").status, "warn");
  assert.match(check(bare, "catalog tmdb").value, /^LIFE_TMDB_KEY is not set; movies and shows are created without a catalog/);
  assert.ok(check(bare, "catalog tmdb").hint!.includes(ENV_FILE));
  assert.equal(check(bare, "catalog openlibrary").status, "ok");
  assert.match(check(bare, "catalog openlibrary").value, /^Open Library needs no key; books look up there$/);
  assert.equal(check(bare, "catalog igdb").status, "warn");
  assert.match(check(bare, "catalog igdb").value, /^LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are not set; games are created without a catalog/);
  assert.equal(check(bare, "igdb token").status, "ok");
  assert.equal(check(bare, "igdb token").value, `no token file at ${join(tokenDir, "token.json")} yet; not needed until LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are set`);
  assert.equal(check(bare, "region").value, "US (default; set LIFE_REGION to change it)");
  assert.ok(!bare.checks.some((c) => c.name.endsWith(" online")), "offline by default");

  const keys = { LIFE_TMDB_KEY: "tmdb-secret-token", LIFE_IGDB_CLIENT_ID: "igdb-client-id", LIFE_IGDB_CLIENT_SECRET: "igdb-client-secret", LIFE_REGION: "gb" };
  await writeFile(join(tokenDir, "token.json"), JSON.stringify({ accessToken: "igdb-access-token", expiresAt: "2026-12-01T00:00:00Z" }));
  const withKeys = await lib(["doctor"], { env: keys, io });
  assert.equal(withKeys.code, EXIT.ok, withKeys.stdout + withKeys.stderr);
  const keyed = result<Report>(withKeys);
  assert.equal(check(keyed, "catalog tmdb").status, "ok");
  assert.match(check(keyed, "catalog tmdb").value, /^LIFE_TMDB_KEY is set \(never shown\); movies and shows look up at TMDB$/);
  assert.match(check(keyed, "catalog igdb").value, /^LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are set \(never shown\); games look up at IGDB$/);
  assert.equal(check(keyed, "igdb token").status, "ok");
  assert.equal(check(keyed, "igdb token").value, `file present at ${join(tokenDir, "token.json")}; expires 2026-12-01T00:00:00Z`);
  assert.equal(check(keyed, "region").value, 'GB (LIFE_REGION="gb", normalized)');
  for (const secret of ["tmdb-secret-token", "igdb-client-secret", "igdb-client-id", "igdb-access-token"]) assert.ok(!withKeys.stdout.includes(secret) && !withKeys.stderr.includes(secret), `${secret} never appears`);

  await writeFile(join(tokenDir, "token.json"), JSON.stringify({ accessToken: "igdb-access-token", expiresAt: "2026-09-12T20:00:00Z" }));
  const expiring = result<Report>(await lib(["doctor"], { env: keys, io }));
  assert.equal(check(expiring, "igdb token").status, "warn");
  assert.match(check(expiring, "igdb token").value, /expires within a day \(2026-09-12T20:00:00Z\); the next game lookup refreshes it$/);
  await writeFile(join(tokenDir, "token.json"), JSON.stringify({ accessToken: "igdb-access-token", expiresAt: "2026-09-01T00:00:00Z" }));
  const expired = result<Report>(await lib(["doctor"], { io }));
  assert.match(check(expired, "igdb token").value, /expired \(2026-09-01T00:00:00Z\); the next game lookup refreshes it, once LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are set$/);
  assert.equal(expired.healthy, true, "a stale token is a warning");

  const offline = result<Report>(await lib(["doctor", "--online"], { io }));
  assert.equal(check(offline, "catalog tmdb online").status, "warn");
  assert.equal(check(offline, "catalog tmdb online").value, "skipped: not configured");
  assert.equal(check(offline, "catalog igdb online").value, "skipped: not configured");
  assert.equal(check(offline, "catalog openlibrary online").status, "ok");
  assert.equal(check(offline, "catalog openlibrary online").value, 'Open Library answered: 0 candidates for "Dune"');

  const online = await lib(["doctor", "--online"], { env: keys, io });
  assert.equal(online.code, EXIT.ok, online.stdout + online.stderr);
  const live = result<Report>(online);
  assert.equal(check(live, "catalog tmdb online").value, 'TMDB answered: 3 candidates for "Dune"');
  assert.equal(check(live, "catalog igdb online").value, 'IGDB answered: 1 candidate for "Celeste"');
  assert.deepEqual(live.checks.map((c) => c.name).slice(-8), ["catalog igdb", "igdb token", "region", "catalog tmdb online", "catalog openlibrary online", "catalog igdb online", "timezone", "actor"]);
  igdb.failNext(new CatalogUnavailable("IGDB is unavailable (HTTP 503): down", 503), "search");
  const down = await lib(["doctor", "--online"], { env: keys, io });
  const error = failed(down, "rejected", EXIT.rejected);
  assert.equal(error.message, "1 check failed: catalog igdb online");
  assert.match(check(result<Report>(down), "catalog igdb online").value, /^IGDB could not answer a search for "Celeste": IGDB is unavailable/);

  const human = await lib(["doctor"], { tty: true, io });
  assert.match(human.stdout, /^catalog tmdb +warn +LIFE_TMDB_KEY is not set/m);
  assert.match(human.stdout, /^catalog openlibrary +ok +Open Library needs no key/m);
  assert.match(human.stdout, /^region +ok +US \(default/m);
});
