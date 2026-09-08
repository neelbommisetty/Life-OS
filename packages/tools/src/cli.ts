// The `life` CLI: a thin client of the Tools facade for a shell, usable by a
// program. Every command maps onto one library call; the CLI adds argument
// parsing, the actor rule, relative dates, the sub-task question on a terminal,
// human or JSON output, and stable exit codes. Nothing here writes a record.
//
// One declarative command table (COMMANDS) drives parsing, validation, and
// help at every layer, so the three cannot drift. An agent's contract is the
// JSON envelope: with --json, or whenever stdout is not a terminal, stdout
// carries exactly one JSON object and everything else goes to stderr.
//
//   life <group> <command> [args] [flags]
//   exit codes: 0 ok, 1 rejected or invalid, 2 duplicate candidates,
//               3 database unavailable, 64 usage

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  AnyRecord,
  Ctx,
  Due,
  Filter,
  FilterUpdate,
  Label,
  LabelAdd,
  LabelUpdate,
  LogEntry,
  Needs,
  Project,
  ProjectAdd,
  ProjectUpdate,
  Receipt,
  Section,
  Task,
  TaskAdd,
  TaskList,
  TaskMove,
  TaskUpdate,
} from "./contract.ts";
import type { Clock } from "./core.ts";
import { createPool, databaseUrl } from "./db/client.ts";
import { effectiveLabels, findInbox, indexProjects, projectPath, type ProjectContents, type ProjectNode, type SectionTasks } from "./organize.ts";
import { PgStore } from "./store.ts";
import type { CompleteOptions, DeleteOptions, ImportResult, TaskAssign } from "./tasks.ts";
import { isValidTimezone, relativeDate, todayIn } from "./time.ts";
import { Tools } from "./tools.ts";
import type { TodayView, TrashView, UpcomingView } from "./views.ts";

// ------------------------------------------------------------------ public surface

export const EXIT = { ok: 0, rejected: 1, duplicate: 2, database: 3, usage: 64 } as const;

/** The error codes an envelope can carry; each maps onto one exit code. */
export type ErrorCode = "usage" | "rejected" | "duplicate" | "needs" | "not_found" | "db_unavailable" | "internal";

export type EnvelopeError = {
  code: ErrorCode;
  message: string;
  issues: string[];
  hint?: string;
  needs?: Needs;
  candidates?: Task[];
};

/** What JSON mode prints: exactly one of these on stdout. `result` is the library's return value, untouched. */
export type Envelope = {
  ok: boolean;
  command: string;
  exitCode: number;
  result?: unknown;
  error?: EnvelopeError;
  warnings?: string[];
};

/** What the CLI talks to; `bin/life.js` passes the process, tests pass streams and a fixed clock. */
export type CliIo = {
  env: Record<string, string | undefined>;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  stderr: NodeJS.WritableStream;
  /** Replaces the wall clock; `--tz` and LIFE_TZ still decide the timezone. */
  clock?: Clock;
};

/** Mirrors db/client.ts: the repository root .env, loaded when LIFE_DATABASE_URL is unset. */
export const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
/** Mirrors db/migrate.ts: the journal of the migrations `life migrate` applies. */
const MIGRATIONS_JOURNAL = fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL("../package.json", import.meta.url));

/** The package version; "0.0.0-dev" until package.json carries a version field. */
export function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

/** Run the CLI and resolve to its exit code. Never throws; every failure is reported on stderr and, in JSON mode, as the envelope on stdout. */
export async function main(argv: string[], io: CliIo = processIo()): Promise<number> {
  const session = new Session(argv, io);
  try {
    return await session.run();
  } catch (error) {
    return session.fail(error);
  }
}

function processIo(): CliIo {
  return { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
}

// ------------------------------------------------------------------ errors

/** Where an error happened, so the right layer of help can be shown. */
type Layer = { kind: "top" } | { kind: "group"; group: GroupName } | { kind: "command"; command: CommandDef };

class UsageError extends Error {
  readonly layer: Layer | undefined;
  readonly hint: string | undefined;

  constructor(message: string, opts: { layer?: Layer; hint?: string } = {}) {
    super(message);
    this.layer = opts.layer;
    this.hint = opts.hint;
  }
}

/** A failure the CLI diagnosed itself (a database that cannot be reached, an unset URL) with the hint already written. */
class CliFailure extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly hint: string;
  override readonly cause: unknown;

  constructor(code: ErrorCode, exitCode: number, message: string, hint: string, cause?: unknown) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.hint = hint;
    this.cause = cause;
  }
}

const DB_ERROR_CODES = new Set([
  // Sockets and DNS.
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  // Postgres: authentication, missing database, missing tables (not migrated), too many connections, shutdown.
  "28000",
  "28P01",
  "3D000",
  "42P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08003",
  "08006",
]);

function messageOf(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) return error.errors.map(messageOf).join("; ");
  return error instanceof Error ? error.message : String(error);
}

/** Connection, authentication, missing-database, and not-migrated failures: the database is not usable. */
function isDatabaseError(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(isDatabaseError);
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && DB_ERROR_CODES.has(code)) return true;
  if (/LIFE_DATABASE_URL is not set/.test(error.message)) return true;
  if (/timeout exceeded when trying to connect|Connection terminated|the database system is (starting|shutting)/i.test(error.message)) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error && isDatabaseError(cause);
}

/** The pg driver's diagnostics on a database error, for --verbose. */
function sqlDetails(error: unknown): string[] {
  const lines: string[] = [];
  const visit = (e: unknown) => {
    if (e instanceof AggregateError) return e.errors.forEach(visit);
    if (!(e instanceof Error)) return;
    const pg = e as { code?: unknown; detail?: unknown; hint?: unknown; severity?: unknown; routine?: unknown; syscall?: unknown; address?: unknown; port?: unknown; cause?: unknown };
    const fields: [string, unknown][] = [
      ["code", pg.code],
      ["severity", pg.severity],
      ["detail", pg.detail],
      ["hint", pg.hint],
      ["routine", pg.routine],
      ["syscall", pg.syscall],
      ["address", pg.address],
      ["port", pg.port],
    ];
    const known = fields.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${String(v)}`);
    if (known.length) lines.push(`${e.name}: ${known.join(" ")}`);
    if (pg.cause !== undefined && pg.cause !== e) visit(pg.cause);
  };
  visit(error);
  return lines;
}

/** A thrown error that is a bug in the CLI or the library rather than a rejection meant for the caller. */
function isInternalError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError || error instanceof SyntaxError;
}

/** The URL with its password removed: scheme, user, host, port, database. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? `${decodeURIComponent(parsed.username)}@` : "";
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}`;
  } catch {
    return "(not a parseable URL)";
  }
}

// ------------------------------------------------------------------ the command table: types

type FlagKind = "value" | "list" | "bool";

type FlagDef = {
  kind: FlagKind;
  /** One line, for help. */
  help: string;
  /** The value's type as shown in help: date, HH:MM, integer, ref, name, text... Omitted for booleans. */
  type?: string;
  /** Allowed values; the parser enforces them. */
  values?: readonly string[];
  /** Shown in help. */
  default?: string;
  /** What the value refers to, so --verbose can report how it resolved. */
  ref?: "project" | "section" | "label" | "filter";
};
type FlagSpec = Readonly<Record<string, FlagDef>>;

type Positional = {
  name: string;
  help: string;
  optional?: boolean;
  /** Takes every remaining argument. */
  variadic?: boolean;
  ref?: "project" | "section" | "label" | "filter";
};

type GroupName = "task" | "project" | "section" | "label" | "filter";

type Rendered = {
  code: number;
  /** The library's return value, untouched; what `result` carries in the envelope. */
  result: unknown;
  /** The human rendering, built only when asked for. */
  text: () => Promise<string> | string;
  /** For a failure: what the envelope's `error` carries. */
  error?: EnvelopeError;
  /** A rejection the caller can turn into a question. */
  needs?: Needs;
};

/** Everything a command needs before the database is opened. */
type Setup = {
  args: string[];
  flags: Flags;
  /** The mutation context; throws a usage error when no actor could be resolved. */
  ctx: () => Ctx;
  today: string;
  tz: string;
  tzSource: string;
  actor: string | undefined;
  actorSource: string;
  json: boolean;
  verbose: boolean;
  io: CliIo;
  db: DbSource;
  /** A diagnostic line on stderr, only with --verbose or LIFE_DEBUG=1. */
  trace: (line: string) => void;
  warnings: string[];
};
type Invocation = Setup & { tools: Tools };

type CommandBase = {
  group: GroupName | null;
  name: string;
  /** One line, for group help. */
  summary: string;
  /** A paragraph or two, for command help. */
  description?: string;
  positionals: Positional[];
  flags: FlagSpec;
  examples: string[];
  /** Extra sections for command help, such as the filter grammar. */
  notes?: string[];
  /** Exit codes this command can produce. */
  exits: number[];
  mutates: boolean;
};
type CommandDef = CommandBase &
  (
    | { database: "connect" | "migrate"; run(inv: Invocation): Promise<Rendered> }
    | { database: "none"; run(setup: Setup): Promise<Rendered> }
  );

/** The exit codes by command shape. */
const EXITS = {
  read: [EXIT.ok, EXIT.rejected, EXIT.database, EXIT.usage],
  write: [EXIT.ok, EXIT.rejected, EXIT.database, EXIT.usage],
  add: [EXIT.ok, EXIT.rejected, EXIT.duplicate, EXIT.database, EXIT.usage],
} as const;

const EXIT_MEANING: Record<number, string> = {
  [EXIT.ok]: "ok",
  [EXIT.rejected]: "rejected, invalid, or not found",
  [EXIT.duplicate]: "duplicate candidates (pass --allow-duplicate to add anyway)",
  [EXIT.database]: "database unavailable (run `life doctor`)",
  [EXIT.usage]: "usage error (unknown command or flag, missing argument)",
};

// ------------------------------------------------------------------ flags

class Flags {
  readonly #values = new Map<string, string | string[] | true>();

  set(name: string, kind: FlagKind, value: string | undefined): void {
    if (kind === "bool") this.#values.set(name, true);
    else if (kind === "list") this.#values.set(name, [...this.list(name), value!]);
    else this.#values.set(name, value!);
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  bool(name: string): boolean {
    return this.#values.get(name) === true;
  }

  str(name: string): string | undefined {
    const value = this.#values.get(name);
    return typeof value === "string" ? value : undefined;
  }

  list(name: string): string[] {
    const value = this.#values.get(name);
    return Array.isArray(value) ? value : [];
  }

  int(name: string): number | undefined {
    const raw = this.str(name);
    if (raw === undefined) return undefined;
    if (!/^-?\d+$/.test(raw.trim())) throw new UsageError(`--${name} expects an integer, got "${raw}"`);
    return Number(raw);
  }

  /** A clearable value: `--name x` gives x, `--no-name` gives null, neither gives undefined. */
  clearable(name: string): string | null | undefined {
    const value = this.str(name);
    const cleared = this.bool(`no-${name}`);
    if (value !== undefined && cleared) throw new UsageError(`--${name} and --no-${name} exclude each other`);
    if (cleared) return null;
    return value;
  }

  /** The same for an integer flag. */
  clearableInt(name: string): number | null | undefined {
    const value = this.clearable(name);
    return value === undefined || value === null ? value : this.int(name);
  }
}

const GLOBAL_FLAGS: FlagSpec = {
  actor: { kind: "value", type: "actor", help: "Who is acting: neel, codex, agent:<name>, or import:<provider>. Else LIFE_ACTOR; defaults to neel only on a terminal. Required for every write." },
  reason: { kind: "value", type: "text", help: "Why this change is made; logged with it. Required by `task cancel`." },
  evidence: { kind: "list", type: "ref", help: "What prompted the change (a file, a message, a command output); logged with it. Repeatable." },
  key: { kind: "value", type: "text", help: "Idempotency key: the same key replays the same receipt instead of writing twice." },
  "if-version": { kind: "value", type: "integer", help: "Only apply when the record is at this version; otherwise the change is rejected with the current record." },
  json: { kind: "bool", help: "Print the JSON envelope. Default whenever stdout is not a terminal." },
  tz: { kind: "value", type: "timezone", help: "IANA timezone for today, relative dates, and due times. Else LIFE_TZ, else the machine's." },
  db: { kind: "value", type: "url", help: "Postgres URL. Else LIFE_DATABASE_URL from the environment or the repository .env file." },
  verbose: { kind: "bool", help: "Stack traces, SQL error details, and resolved refs on stderr. Or LIFE_DEBUG=1." },
  help: { kind: "bool", help: "Print help for this layer and exit 0. Also -h, and `life help [group] [command]`." },
  version: { kind: "bool", help: "Print the package version and exit 0." },
};

// ------------------------------------------------------------------ the command table: shared pieces

const DATE_TYPE = "date";
const DATE_HELP = "YYYY-MM-DD, today, tomorrow, yesterday, +Nd, or -Nw";
const PROJECT_REF = "a project id (p_...), a slug path such as health/dental, or inbox";
const SECTION_REF = "a section name within the project, or a section id (s_...)";

/** Positionals shared by many commands. */
const POS = {
  taskId: { name: "id", help: "A task id (t_ followed by ten characters)." },
  projectRef: { name: "ref", help: `A project reference: ${PROJECT_REF}.`, ref: "project" as const },
  sectionId: { name: "id", help: "A section id (s_...). See `life project tree` or `life section list <project-ref>`." },
  labelRef: { name: "ref", help: "A label name or id (l_...). See `life label list`." },
  filterRef: { name: "ref", help: "A saved filter's name or id (f_...). See `life filter list`." },
};

const dateFlagDef = (help: string): FlagDef => ({ kind: "value", type: DATE_TYPE, help: `${help}: ${DATE_HELP}.` });

const TASK_SCHEDULE: FlagSpec = {
  due: dateFlagDef("Due date"),
  time: { kind: "value", type: "HH:MM", help: "Due time; needs --due. Stored with the effective timezone (--tz, LIFE_TZ, or the machine's)." },
  deadline: dateFlagDef("Hard deadline, independent of the due date"),
  duration: { kind: "value", type: "integer", help: "Estimated minutes." },
  repeat: { kind: "value", type: "RRULE", help: "Recurrence rule (RFC 5545), e.g. FREQ=WEEKLY;BYDAY=MO. Needs a due date." },
  priority: { kind: "value", type: "integer", values: ["1", "2", "3", "4"], help: "Priority, 1 highest." },
};

const LABEL_FLAG: FlagDef = { kind: "list", type: "name", help: "A label name (lowercase slug); created on first use. Repeatable.", ref: "label" };

const TASK_ADD_FLAGS: FlagSpec = {
  notes: { kind: "value", type: "text", help: "Notes body." },
  project: { kind: "value", type: "ref", help: `Project: ${PROJECT_REF}.`, default: "inbox", ref: "project" },
  section: { kind: "value", type: "name|id", help: `Section: ${SECTION_REF}.`, ref: "section" },
  parent: { kind: "value", type: "id", help: "Parent task id (t_...); the task becomes its sub-task, in the same project." },
  ...TASK_SCHEDULE,
  label: LABEL_FLAG,
  executor: { kind: "value", type: "executor", help: "Who will do it: neel or agent:<name>.", default: "neel" },
  bucket: { kind: "value", type: "bucket", values: ["safe", "review", "unsafe"], help: "Automation bucket for an agent executor." },
  status: { kind: "value", values: ["proposed", "accepted"], help: "Initial status.", default: "accepted for actor neel, proposed for anyone else" },
  "allow-duplicate": { kind: "bool", help: "Add even when similar open tasks exist (otherwise exit 2 lists them as candidates)." },
};

const TASK_UPDATE_FLAGS: FlagSpec = {
  title: { kind: "value", type: "text", help: "New title." },
  notes: { kind: "value", type: "text", help: "New notes body (replaces the old one)." },
  ...TASK_SCHEDULE,
  "no-priority": { kind: "bool", help: "Clear the priority." },
  "no-due": { kind: "bool", help: "Clear the due date and time." },
  "no-deadline": { kind: "bool", help: "Clear the deadline." },
  "no-duration": { kind: "bool", help: "Clear the duration." },
  "no-repeat": { kind: "bool", help: "Stop repeating." },
  label: { ...LABEL_FLAG, help: "Replace the labels with these. Repeatable." },
  "no-label": { kind: "bool", help: "Remove every label." },
};

/** The filter grammar, one line per family; quoted in hints and printed under `life help filter`. */
export const FILTER_GRAMMAR: readonly { family: string; line: string }[] = [
  { family: "dates", line: "today | tomorrow | yesterday | overdue | no date | N days (due within N days) | due: <date> | due before: <date> | due after: <date> | deadline: <date> | deadline before: <date> | deadline after: <date> | no deadline   (<date> is YYYY-MM-DD, today, tomorrow, yesterday, +Nd, or -Nw)" },
  { family: "where", line: "#<project> (that project only; a slug path such as health/dental, or an id) | ##<project> (with its sub-projects) | @<label> (carried directly or through the project)" },
  { family: "what", line: "p1 | p2 | p3 | p4 (priority, p1 highest) | no priority | subtask | recurring | assigned to: <executor> (neel or agent:<name>)" },
  { family: "status", line: "status: proposed | status: accepted | status: in_progress | status: done | status: cancelled | open | done | cancelled | all   (a query that says nothing about status sees open tasks only)" },
  { family: "text", line: 'search: <text> (title, notes, and comments, case-insensitive; quote text with spaces: search: "car registration")' },
  { family: "combine", line: "& (and) | (or) ! (not) and parentheses, e.g. today & @health   (overdue | today) & !subtask   ##health & status: proposed" },
];

const FILTER_NOTES = [
  "filter grammar (a Todoist-like subset; anything outside it is rejected, never guessed):",
  ...FILTER_GRAMMAR.map(({ family, line }) => `  ${family.padEnd(9)}${line}`),
  "  `life filter run` tries a saved filter's name or id first, then parses the argument as a query; do not name a saved filter after a grammar word such as today or overdue.",
];

// ------------------------------------------------------------------ command helpers

/** Drop undefined keys so an input carries only what was asked for. The library validates the shape. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

/** YYYY-MM-DD, today, tomorrow, yesterday, +Nd, -Nw; anything else passes through for the library to reject. */
function resolveDate(inv: Setup, value: string): string {
  return relativeDate(value, inv.today) ?? value;
}

function dateFlag(inv: Setup, name: string): string | undefined {
  const value = inv.flags.str(name);
  return value === undefined ? undefined : resolveDate(inv, value);
}

/** `--due d [--time HH:MM]` as a Due; a time carries the effective timezone. */
function dueFlag(inv: Setup): Due | undefined {
  const date = inv.flags.str("due");
  const time = inv.flags.str("time");
  if (date === undefined) {
    if (time !== undefined) throw new UsageError("--time needs --due", { hint: "pass --due <date> --time HH:MM together" });
    return undefined;
  }
  const due: Due = { date: resolveDate(inv, date) };
  if (time !== undefined) {
    due.time = time;
    due.timezone = inv.tz;
  }
  return due;
}

function attachments(inv: Setup): { name: string; url: string }[] {
  return inv.flags.list("attach").map((raw) => {
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`--attach expects name=url, got "${raw}"`, { hint: 'pass --attach "call log=https://example.com/log"' });
    return { name: raw.slice(0, eq), url: raw.slice(eq + 1) };
  });
}

function labelsFlag(inv: Setup): string[] | undefined {
  if (inv.flags.bool("no-label")) {
    if (inv.flags.list("label").length) throw new UsageError("--label and --no-label exclude each other");
    return [];
  }
  const labels = inv.flags.list("label");
  return labels.length ? labels : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ------------------------------------------------------------------ hints: every failure names what to do next

const NOT_FOUND = /^(?:[\w.]+): no (task|project|section|label|filter) "(.+)"$/;

/** The hint for a filter error: the grammar line that applies. */
function filterHint(message: string): string {
  const family = (() => {
    if (/expected today, tomorrow/.test(message)) return "dates";
    if (/status: expected/.test(message)) return "status";
    if (/Unclosed quote/.test(message)) return "text";
    if (/Unexpected|Missing closing parenthesis|Empty filter|Invalid filter/.test(message)) return "combine";
    const term = /Unknown filter term "(.+)"/.exec(message)?.[1]?.toLowerCase() ?? "";
    if (/^#|^@/.test(term)) return "where";
    if (/^(due|deadline|today|tomorrow|yesterday|overdue|no date|\d+ days?)/.test(term)) return "dates";
    if (/^(status|open|done|cancelled|all)/.test(term)) return "status";
    if (/^search/.test(term)) return "text";
    return "what";
  })();
  const line = FILTER_GRAMMAR.find((g) => g.family === family)!;
  return `filter grammar, ${line.family}: ${line.line}; run \`life help filter\` for the full grammar`;
}

/** Hints for a command's issues, one per family of problem, in the order the issues came. */
function hintsFor(command: CommandDef | null, issues: string[]): string[] {
  const hints: string[] = [];
  const add = (hint: string) => {
    if (!hints.includes(hint)) hints.push(hint);
  };
  const cmd = command ? commandName(command) : "<group> <command>";
  for (const issue of issues) {
    if (/neither a saved filter nor a valid query|Unknown filter term|filter: (Unclosed|Unexpected|Missing closing|Empty filter|Invalid filter|\w+: expected today)|query: /.test(issue)) add(filterHint(issue));
    else if (/no project "|project ".*" is deleted|no section "|section ".*" is deleted|pass project to look up section/.test(issue))
      add("run `life project tree` to see project paths, project ids, and section ids (deleted ones are in `life trash`)");
    else if (/no label "/.test(issue)) add("run `life label list` to see label names and ids");
    else if (/no filter "/.test(issue)) add("run `life filter list` to see saved filters, or pass a query (see `life help filter`)");
    else if (/no task "/.test(issue)) add("check the id with `life task list --all` or `life search <text>`; deleted tasks are in `life trash`");
    else if (/is deleted; restore it first/.test(issue)) add("restore it first: `life <group> restore <id>`; deleted records are listed by `life trash`");
    else if (/^actor: /.test(issue)) add("pass --actor neel, codex, agent:<name>, or import:<provider>, or set LIFE_ACTOR");
    else if (/^version: expected/.test(issue)) add("re-read the record (`life task get <id>`) and pass its current version to --if-version, or drop --if-version");
    else if (/^reason: /.test(issue)) add('pass --reason "why"');
    else if (/^key: .* was already used/.test(issue)) add("pass a fresh --key; a key belongs to one operation on one record kind");
    else if (/^(\w+(?:\.\w+)*): /.test(issue) || /^list: |^\w+: \w+: /.test(issue)) add(`run \`life ${cmd} --help\` for each flag's format and allowed values`);
  }
  return hints;
}

/** The `not_found` code applies when the record named by a positional argument does not exist. */
function isNotFound(issues: string[], args: string[]): boolean {
  const named = new Set(args.map((a) => a.trim().toLowerCase()));
  return issues.some((issue) => {
    const match = NOT_FOUND.exec(issue);
    return match !== null && named.has(match[2]!.toLowerCase());
  });
}

// ------------------------------------------------------------------ rendering results

const receiptCode = (receipt: Receipt<unknown>): number =>
  receipt.ok ? EXIT.ok : receipt.outcome === "duplicate" ? EXIT.duplicate : EXIT.rejected;

/** The envelope error for a failed receipt. */
function receiptError(command: CommandDef, receipt: Receipt<AnyRecord>, args: string[]): EnvelopeError | undefined {
  if (receipt.ok) return undefined;
  if (receipt.outcome === "duplicate") {
    const candidates = receipt.candidates as Task[];
    const listed = candidates.map((c) => `${c.id} "${c.title}"`).join(", ");
    return {
      code: "duplicate",
      message: receipt.issues[0] ?? "Similar open tasks exist",
      issues: receipt.issues,
      hint: `pass --allow-duplicate to add anyway, or reuse a candidate: ${listed}`,
      candidates,
    };
  }
  if (receipt.needs) {
    return {
      code: "needs",
      message: receipt.needs.message,
      issues: receipt.issues,
      hint: `pass --${receipt.needs.field} ${receipt.needs.options.join("|")}`,
      needs: receipt.needs,
    };
  }
  const hints = hintsFor(command, receipt.issues);
  return {
    code: isNotFound(receipt.issues, args) ? "not_found" : "rejected",
    message: receipt.issues.length === 1 ? receipt.issues[0]! : `${receipt.issues.length} issues: ${receipt.issues.join("; ")}`,
    issues: receipt.issues,
    ...(hints.length ? { hint: hints.join("; ") } : {}),
  };
}

/** One receipt: exit code from the outcome, the receipt as the result, one line plus issues as text. */
function rendered(inv: Invocation, command: CommandDef, receipt: Receipt<AnyRecord>): Rendered {
  const error = receiptError(command, receipt, inv.args);
  return {
    code: receiptCode(receipt),
    result: receipt,
    text: async () => receiptText(receipt, await projectIndex(inv.tools), error?.hint),
    ...(error ? { error } : {}),
    ...(!receipt.ok && receipt.outcome === "rejected" && receipt.needs ? { needs: receipt.needs } : {}),
  };
}

function renderedAll(inv: Invocation, command: CommandDef, receipts: Receipt<AnyRecord>[]): Rendered {
  const codes = receipts.map(receiptCode);
  const code = codes.includes(EXIT.rejected) ? EXIT.rejected : codes.includes(EXIT.duplicate) ? EXIT.duplicate : EXIT.ok;
  const failed = receipts.filter((r) => !r.ok);
  const issues = [...new Set(failed.flatMap((r) => r.issues))];
  const hints = hintsFor(command, issues);
  const error: EnvelopeError | undefined = failed.length
    ? {
        code: code === EXIT.duplicate ? "duplicate" : "rejected",
        message: `${failed.length} of ${receipts.length} rejected: ${issues.join("; ")}`,
        issues,
        ...(hints.length ? { hint: hints.join("; ") } : {}),
      }
    : undefined;
  return {
    code,
    result: receipts,
    text: async () => {
      const index = await projectIndex(inv.tools);
      return receipts.map((receipt) => receiptText(receipt, index)).join("\n");
    },
    ...(error ? { error } : {}),
  };
}

function renderedTasks(inv: Invocation, tasks: Task[], empty = "No tasks."): Rendered {
  return {
    code: EXIT.ok,
    result: tasks,
    text: async () => (tasks.length ? taskTable(tasks, await projectIndex(inv.tools)) : empty),
  };
}

const plain = (code: number, result: unknown, text: string): Rendered => ({ code, result, text: () => text });

/** A read that found nothing: exit 1, a `not_found` error with the hint, the sentence on a terminal. */
function notFound(command: CommandDef, issue: string, text: string): Rendered {
  const hints = hintsFor(command, [issue]);
  return {
    code: EXIT.rejected,
    result: null,
    text: () => (hints.length ? `${text}\n  ${hints.join("; ")}` : text),
    error: { code: "not_found", message: issue, issues: [issue], ...(hints.length ? { hint: hints.join("; ") } : {}) },
  };
}

// ------------------------------------------------------------------ task commands

const taskAdd: CommandDef = {
  group: "task",
  name: "add",
  summary: "Add a task (duplicates of open titles are refused unless --allow-duplicate)",
  description: "Creates one task. Without --project it lands in the Inbox. A title similar to an open task's is refused with exit 2 and the candidates, unless --allow-duplicate is passed.",
  positionals: [{ name: "title", help: "The task title." }],
  flags: TASK_ADD_FLAGS,
  examples: [
    'life task add "Book the dentist" --project health --due tomorrow --time 09:00 --priority 2 --actor codex --json',
    'life task add "Renew car registration" --evidence "mail export 2026-09-07" --reason "surfaced while processing inbox" --actor codex --json',
    'life task add "Floss" --project health/dental --section Planning --label health --repeat FREQ=DAILY --due today --actor neel',
  ],
  exits: [...EXITS.add],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const input = compact({
      title: inv.args[0]!,
      notes: f.str("notes"),
      project: f.str("project"),
      section: f.str("section"),
      parent: f.str("parent"),
      due: dueFlag(inv),
      deadline: dateFlag(inv, "deadline"),
      duration: f.int("duration"),
      repeat: f.str("repeat"),
      priority: f.int("priority"),
      labels: labelsFlag(inv),
      executor: f.str("executor"),
      bucket: f.str("bucket"),
      status: f.str("status"),
      allowDuplicate: f.bool("allow-duplicate") || undefined,
    });
    return rendered(inv, taskAdd, await inv.tools.task.add(input as TaskAdd, inv.ctx()));
  },
};

const taskGet: CommandDef = {
  group: "task",
  name: "get",
  summary: "Show one task in full (deleted included)",
  positionals: [POS.taskId],
  flags: {},
  examples: ["life task get t_abc123def0 --json", "life task get t_abc123def0"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const task = await inv.tools.task.get(inv.args[0]!);
    if (!task) return notFound(taskGet, `task: no task "${inv.args[0]}"`, `No task "${inv.args[0]}".`);
    return { code: EXIT.ok, result: task, text: async () => taskDetail(task, await projectIndex(inv.tools), inv.tools) };
  },
};

const taskList: CommandDef = {
  group: "task",
  name: "list",
  summary: "List tasks by project, section, label, status, dates, text, or a filter query",
  description: "Open tasks only unless --all, --status, or a --filter that mentions status. Sorted by due date, then priority, then order. Every criterion must hold.",
  positionals: [],
  flags: {
    filter: { kind: "value", type: "query", help: "A filter query; see the grammar below." },
    project: { kind: "value", type: "ref", help: `Only this project: ${PROJECT_REF}.`, ref: "project" },
    "with-subprojects": { kind: "bool", help: "With --project: include its sub-projects." },
    section: { kind: "value", type: "name|id", help: `Only this section: ${SECTION_REF} (a name needs --project).`, ref: "section" },
    label: { kind: "value", type: "name", help: "Only tasks carrying this label, directly or through their project.", ref: "label" },
    status: { kind: "value", type: "list", help: "Only these statuses, comma-separated: proposed, accepted, in_progress, done, cancelled.", default: "open (proposed, accepted, in_progress)" },
    all: { kind: "bool", help: "Every status, done and cancelled included." },
    due: dateFlagDef("Due on this date"),
    "due-before": dateFlagDef("Due strictly before this date"),
    "due-after": dateFlagDef("Due strictly after this date"),
    undated: { kind: "bool", help: "Only tasks without a due date." },
    text: { kind: "value", type: "text", help: "Title, notes, or a comment contains this text (case-insensitive)." },
    deleted: { kind: "bool", help: "Include deleted tasks." },
    limit: { kind: "value", type: "integer", help: "At most this many tasks (1 to 10000)." },
  },
  examples: [
    'life task list --text "car registration" --json',
    "life task list --project health --with-subprojects --status accepted,in_progress --json",
    'life task list --filter "(overdue | today) & @health" --json',
  ],
  notes: FILTER_NOTES,
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const status = f.str("status")?.split(",").map((s) => s.trim()).filter(Boolean);
    const criteria = compact({
      filter: f.str("filter"),
      project: f.str("project"),
      withSubprojects: f.bool("with-subprojects") || undefined,
      section: f.str("section"),
      label: f.str("label"),
      status: status?.length ? status : undefined,
      includeClosed: f.bool("all") || undefined,
      dueOn: dateFlag(inv, "due"),
      dueBefore: dateFlag(inv, "due-before"),
      dueAfter: dateFlag(inv, "due-after"),
      undated: f.bool("undated") || undefined,
      text: f.str("text"),
      includeDeleted: f.bool("deleted") || undefined,
      limit: f.int("limit"),
    });
    return renderedTasks(inv, await inv.tools.task.list(criteria as TaskList));
  },
};

const taskUpdate: CommandDef = {
  group: "task",
  name: "update",
  summary: "Change a task's title, notes, schedule, priority, or labels",
  description: "Pass at least one flag. A --no-<field> flag clears that field. To move a task use `task move`; to change who does it use `task assign`.",
  positionals: [POS.taskId],
  flags: TASK_UPDATE_FLAGS,
  examples: [
    'life task update t_abc123def0 --title "Book the dentist (and the hygienist)" --priority 1 --actor codex --json',
    "life task update t_abc123def0 --due +3d --time 14:00 --actor neel",
    "life task update t_abc123def0 --no-due --no-priority --label health --label urgent --actor neel",
  ],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const cleared = f.bool("no-due");
    const due = dueFlag(inv);
    if (cleared && due !== undefined) throw new UsageError("--due and --no-due exclude each other");
    const deadline = f.clearable("deadline");
    const input = compact({
      title: f.str("title"),
      notes: f.str("notes"),
      priority: f.clearableInt("priority"),
      due: cleared ? null : due,
      deadline: typeof deadline === "string" ? resolveDate(inv, deadline) : deadline,
      duration: f.clearableInt("duration"),
      repeat: f.clearable("repeat"),
      labels: labelsFlag(inv),
    });
    if (!Object.keys(input).length) throw new UsageError("life task update: nothing to change; pass at least one flag", { layer: { kind: "command", command: taskUpdate } });
    return rendered(inv, taskUpdate, await inv.tools.task.update(inv.args[0]!, input as TaskUpdate, inv.ctx()));
  },
};

const taskMove: CommandDef = {
  group: "task",
  name: "move",
  summary: "Move a task to another project, section, or parent",
  positionals: [POS.taskId],
  flags: {
    project: { kind: "value", type: "ref", help: `Target project: ${PROJECT_REF}. Sub-tasks move along.`, ref: "project" },
    section: { kind: "value", type: "name|id", help: `Target section in the (new) project: ${SECTION_REF}.`, ref: "section" },
    "no-section": { kind: "bool", help: "Take the task out of its section." },
    parent: { kind: "value", type: "id", help: "Make it a sub-task of this task (t_...)." },
    "no-parent": { kind: "bool", help: "Make it a top-level task." },
  },
  examples: ["life task move t_abc123def0 --project health/dental --section Planning --actor codex --json", "life task move t_abc123def0 --no-parent --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const input = compact({ project: inv.flags.str("project"), section: inv.flags.clearable("section"), parent: inv.flags.clearable("parent") });
    if (!Object.keys(input).length) throw new UsageError("life task move: pass --project, --section/--no-section, or --parent/--no-parent", { layer: { kind: "command", command: taskMove } });
    return rendered(inv, taskMove, await inv.tools.task.move(inv.args[0]!, input as TaskMove, inv.ctx()));
  },
};

const taskReorder: CommandDef = {
  group: "task",
  name: "reorder",
  summary: "Put these tasks in this order within their shared project, section, or parent",
  positionals: [{ name: "id", help: "Task ids, in the wanted order. All must share one scope (same project, section, and parent).", variadic: true }],
  flags: {},
  examples: ["life task reorder t_aaaaaaaaaa t_bbbbbbbbbb t_cccccccccc --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, taskReorder, await inv.tools.task.reorder(inv.args, inv.ctx())),
};

const taskDuplicate: CommandDef = {
  group: "task",
  name: "duplicate",
  summary: "Copy a task (and its sub-tasks) as a new open task",
  positionals: [POS.taskId],
  flags: { "no-subtasks": { kind: "bool", help: "Copy the task alone." } },
  examples: ["life task duplicate t_abc123def0 --actor neel --json", "life task duplicate t_abc123def0 --no-subtasks --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, taskDuplicate, await inv.tools.task.duplicate(inv.args[0]!, inv.ctx(), inv.flags.bool("no-subtasks") ? { subtasks: false } : {})),
};

const TRANSITIONS = {
  accept: "Accept a proposed task (status proposed -> accepted)",
  start: "Start a task (status -> in_progress)",
  uncomplete: "Reopen a done or cancelled task (status -> accepted)",
  restore: "Undelete a task",
  cancel: "Cancel a task; --reason is required",
} as const;

const transition = (verb: keyof typeof TRANSITIONS): CommandDef => {
  const def: CommandDef = {
    group: "task",
    name: verb,
    summary: TRANSITIONS[verb],
    positionals: [POS.taskId],
    flags: {},
    examples:
      verb === "cancel"
        ? ['life task cancel t_abc123def0 --reason "superseded by the new plan" --actor codex --json', 'life task cancel t_abc123def0 --reason "no longer needed" --evidence "vault:Areas/Admin.md" --actor neel']
        : [`life task ${verb} t_abc123def0 --actor codex --json`, `life task ${verb} t_abc123def0 --reason "asked by Neel in chat" --evidence "chat 2026-09-07" --actor codex`],
    exits: [...EXITS.write],
    mutates: true,
    database: "connect",
    run: async (inv) => rendered(inv, def, await inv.tools.task[verb](inv.args[0]!, inv.ctx())),
  };
  return def;
};

const taskComplete: CommandDef = {
  group: "task",
  name: "complete",
  summary: "Mark a task done (a repeating task rolls to its next date)",
  description: "A task with open sub-tasks needs --subtasks: without it the command is rejected with a `needs` error naming the options (on a terminal it asks).",
  positionals: [POS.taskId],
  flags: {
    date: dateFlagDef("The completion date"),
    subtasks: { kind: "value", values: ["complete", "leave"], help: "What to do with open sub-tasks: complete them too, or leave them open." },
  },
  examples: ["life task complete t_abc123def0 --actor codex --json", "life task complete t_abc123def0 --subtasks leave --actor neel", "life task complete t_abc123def0 --date yesterday --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const opts = compact({ date: dateFlag(inv, "date"), subtasks: inv.flags.str("subtasks") });
    return rendered(inv, taskComplete, await inv.tools.task.complete(inv.args[0]!, inv.ctx(), opts as CompleteOptions));
  },
};

const taskDelete: CommandDef = {
  group: "task",
  name: "delete",
  summary: "Delete a task (to the trash; `task restore` undoes it)",
  description: "A task with open sub-tasks needs --subtasks: without it the command is rejected with a `needs` error naming the options (on a terminal it asks).",
  positionals: [POS.taskId],
  flags: { subtasks: { kind: "value", values: ["delete", "leave"], help: "What to do with open sub-tasks: delete them too, or leave them (they move up a level)." } },
  examples: ["life task delete t_abc123def0 --actor neel --json", "life task delete t_abc123def0 --subtasks delete --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const opts = compact({ subtasks: inv.flags.str("subtasks") });
    return rendered(inv, taskDelete, await inv.tools.task.delete(inv.args[0]!, inv.ctx(), opts as DeleteOptions));
  },
};

const taskAssign: CommandDef = {
  group: "task",
  name: "assign",
  summary: "Set who does a task and its automation bucket",
  positionals: [POS.taskId],
  flags: {
    executor: { kind: "value", type: "executor", help: "neel or agent:<name>." },
    bucket: { kind: "value", type: "bucket", values: ["safe", "review", "unsafe"], help: "Automation bucket for an agent executor." },
    "no-bucket": { kind: "bool", help: "Clear the bucket." },
  },
  examples: ["life task assign t_abc123def0 --executor agent:codex --bucket review --actor neel --json", "life task assign t_abc123def0 --executor neel --no-bucket --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const input = compact({ executor: inv.flags.str("executor"), bucket: inv.flags.clearable("bucket") });
    if (!Object.keys(input).length) throw new UsageError("life task assign: pass --executor, --bucket, or --no-bucket", { layer: { kind: "command", command: taskAssign } });
    return rendered(inv, taskAssign, await inv.tools.task.assign(inv.args[0]!, input as TaskAssign, inv.ctx()));
  },
};

const taskReschedule: CommandDef = {
  group: "task",
  name: "reschedule",
  summary: "Set or clear a task's due date and time",
  positionals: [POS.taskId],
  flags: {
    due: dateFlagDef("The new due date"),
    time: TASK_SCHEDULE.time!,
    "no-due": { kind: "bool", help: "Clear the due date and time." },
  },
  examples: ["life task reschedule t_abc123def0 --due tomorrow --time 18:30 --actor codex --json", "life task reschedule t_abc123def0 --no-due --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const cleared = inv.flags.bool("no-due");
    const due = dueFlag(inv);
    if (cleared && due !== undefined) throw new UsageError("--due and --no-due exclude each other");
    if (!cleared && due === undefined) throw new UsageError("life task reschedule: pass --due <date> or --no-due", { layer: { kind: "command", command: taskReschedule } });
    return rendered(inv, taskReschedule, await inv.tools.task.reschedule(inv.args[0]!, cleared ? null : due!, inv.ctx()));
  },
};

const taskNote: CommandDef = {
  group: "task",
  name: "note",
  summary: "Add a comment to a task, with optional attachments",
  positionals: [POS.taskId, { name: "text", help: "The comment." }],
  flags: { attach: { kind: "list", type: "name=url", help: "An attachment as name=url. Repeatable." } },
  examples: ['life task note t_abc123def0 "Called them; they open at 9" --attach "call log=https://example.com/log" --actor agent:phone --json'],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, taskNote, await inv.tools.task.note(inv.args[0]!, inv.args[1]!, inv.ctx(), attachments(inv))),
};

const taskHistory: CommandDef = {
  group: "task",
  name: "history",
  summary: "Every logged change to a task, oldest first",
  positionals: [POS.taskId],
  flags: {},
  examples: ["life task history t_abc123def0 --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const id = inv.args[0]!;
    if (!(await inv.tools.task.get(id))) return notFound(taskHistory, `task: no task "${id}"`, `No task "${id}".`);
    const entries = await inv.tools.task.history(id);
    return plain(EXIT.ok, entries, historyText(entries));
  },
};

const taskImport: CommandDef = {
  group: "task",
  name: "import",
  summary: "Add tasks from a JSON file of task inputs",
  description: 'The file holds a JSON array of task inputs (the same fields `task add` takes, as JSON: title, notes, project, section, due: { date, time, timezone }, deadline, priority, labels, ...) or { "items": [...] }. Each item gets its own receipt.',
  positionals: [{ name: "file", help: "Path to the JSON file." }],
  flags: { "dry-run": { kind: "bool", help: "Validate and report without writing." } },
  examples: ["life task import ./tasks.json --dry-run --actor import:todoist --json", "life task import ./tasks.json --actor import:todoist --json"],
  exits: [...EXITS.add],
  mutates: true,
  database: "connect",
  async run(inv) {
    const file = inv.args[0]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`import: cannot read ${file}: ${messageOf(error)}`);
    }
    const items = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.items) ? parsed.items : null;
    if (!items) throw new Error(`import: ${file} must hold a JSON array of tasks (or { "items": [...] })`);
    const result = await inv.tools.task.import(items, inv.ctx(), { dryRun: inv.flags.bool("dry-run") });
    const code = result.rejected ? EXIT.rejected : result.duplicate ? EXIT.duplicate : EXIT.ok;
    const failed = result.items.filter((item) => item.outcome !== "created");
    const issues = [...new Set(failed.flatMap((item) => item.issues))];
    const error: EnvelopeError | undefined =
      code === EXIT.ok
        ? undefined
        : {
            code: result.rejected ? "rejected" : "duplicate",
            message: `${result.rejected} rejected, ${result.duplicate} duplicate of ${result.items.length} items${result.dryRun ? " (dry run)" : ""}`,
            issues,
            hint: result.rejected ? hintsFor(taskImport, issues).join("; ") || "fix the rejected items and import again" : "duplicates were skipped; add them one by one with `life task add --allow-duplicate`",
          };
    return { code, result, text: () => importText(result), ...(error ? { error } : {}) };
  },
};

// ------------------------------------------------------------------ project commands

const projectAdd: CommandDef = {
  group: "project",
  name: "add",
  summary: "Create a project, at the root or under a parent",
  positionals: [{ name: "name", help: "The project name; the slug is derived from it unless --slug is given." }],
  flags: {
    parent: { kind: "value", type: "ref", help: `Parent project: ${PROJECT_REF}.`, ref: "project" },
    slug: { kind: "value", type: "slug", help: "URL-safe name used in paths: lowercase letters, digits, dots, dashes." },
    color: { kind: "value", type: "text", help: "Any color name or hex." },
    layout: { kind: "value", values: ["list", "board"], help: "How the app shows it.", default: "list" },
    label: { ...LABEL_FLAG, help: "A label every task in the project carries. Repeatable." },
  },
  examples: ['life project add "Health" --label health --actor neel --json', 'life project add "Dental" --parent health --color blue --actor neel --json'],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const input = compact({ name: inv.args[0]!, parent: f.str("parent"), slug: f.str("slug"), color: f.str("color"), layout: f.str("layout"), labels: labelsFlag(inv) });
    return rendered(inv, projectAdd, await inv.tools.project.add(input as ProjectAdd, inv.ctx()));
  },
};

const projectTree: CommandDef = {
  group: "project",
  name: "tree",
  summary: "Every project with its sections, nested, with ids and slug paths",
  positionals: [],
  flags: { archived: { kind: "bool", help: "Include archived projects." } },
  examples: ["life project tree", "life project tree --archived --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const tree = await inv.tools.project.tree({ includeArchived: inv.flags.bool("archived") });
    return plain(EXIT.ok, tree, treeText(tree));
  },
};

const projectGet: CommandDef = {
  group: "project",
  name: "get",
  summary: "Show one project",
  positionals: [POS.projectRef],
  flags: {},
  examples: ["life project get health/dental --json", "life project get inbox"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const project = await inv.tools.project.get(inv.args[0]!);
    if (!project) return notFound(projectGet, `project: no project "${inv.args[0]}"`, `No project "${inv.args[0]}".`);
    return { code: EXIT.ok, result: project, text: async () => projectDetail(project, await projectIndex(inv.tools)) };
  },
};

const PROJECT_VERBS = { archive: "Archive a project (hidden from the tree, tasks kept)", unarchive: "Bring an archived project back", restore: "Undelete a project" } as const;

const projectVerb = (verb: keyof typeof PROJECT_VERBS): CommandDef => {
  const def: CommandDef = {
    group: "project",
    name: verb,
    summary: PROJECT_VERBS[verb],
    positionals: [POS.projectRef],
    flags: {},
    examples: [`life project ${verb} health/dental --actor neel --json`],
    exits: [...EXITS.write],
    mutates: true,
    database: "connect",
    run: async (inv) => rendered(inv, def, await inv.tools.project[verb](inv.args[0]!, inv.ctx())),
  };
  return def;
};

const projectUpdate: CommandDef = {
  group: "project",
  name: "update",
  summary: "Rename a project or change its slug, color, layout, or labels",
  positionals: [POS.projectRef],
  flags: {
    name: { kind: "value", type: "text", help: "New name." },
    slug: { kind: "value", type: "slug", help: "New slug (changes the project's path)." },
    color: { kind: "value", type: "text", help: "New color." },
    "no-color": { kind: "bool", help: "Clear the color." },
    layout: { kind: "value", values: ["list", "board"], help: "New layout." },
    label: { ...LABEL_FLAG, help: "Replace the project's labels with these. Repeatable." },
    "no-label": { kind: "bool", help: "Remove every label." },
  },
  examples: ['life project update health --name "Health & fitness" --actor neel --json', "life project update health/dental --no-color --layout board --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const input = compact({ name: f.str("name"), slug: f.str("slug"), color: f.clearable("color"), layout: f.str("layout"), labels: labelsFlag(inv) });
    if (!Object.keys(input).length) throw new UsageError("life project update: nothing to change; pass at least one flag", { layer: { kind: "command", command: projectUpdate } });
    return rendered(inv, projectUpdate, await inv.tools.project.update(inv.args[0]!, input as ProjectUpdate, inv.ctx()));
  },
};

const projectMove: CommandDef = {
  group: "project",
  name: "move",
  summary: "Move a project under another project or to the root",
  positionals: [POS.projectRef],
  flags: {
    parent: { kind: "value", type: "ref", help: `New parent: ${PROJECT_REF}.`, ref: "project" },
    "no-parent": { kind: "bool", help: "Move to the root." },
  },
  examples: ["life project move dental --parent health --actor neel --json", "life project move health/dental --no-parent --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const parent = inv.flags.clearable("parent");
    if (parent === undefined) throw new UsageError("life project move: pass --parent <ref> or --no-parent", { layer: { kind: "command", command: projectMove } });
    return rendered(inv, projectMove, await inv.tools.project.move(inv.args[0]!, parent, inv.ctx()));
  },
};

const projectDelete: CommandDef = {
  group: "project",
  name: "delete",
  summary: "Delete a project; its tasks are deleted or moved to the Inbox",
  description: "A project that still has tasks needs --contents: without it the command is rejected with a `needs` error naming the options (on a terminal it asks). Sub-projects go along.",
  positionals: [POS.projectRef],
  flags: { contents: { kind: "value", values: ["delete", "inbox"], help: "What to do with the project's tasks: delete them, or move them to the Inbox." } },
  examples: ["life project delete health/dental --contents inbox --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const opts = compact({ contents: inv.flags.str("contents") }) as { contents?: ProjectContents };
    return rendered(inv, projectDelete, await inv.tools.project.delete(inv.args[0]!, inv.ctx(), opts));
  },
};

const projectReorder: CommandDef = {
  group: "project",
  name: "reorder",
  summary: "Put these sibling projects in this order",
  positionals: [{ name: "id", help: "Project ids (p_...), in the wanted order; all must share one parent.", variadic: true }],
  flags: {},
  examples: ["life project reorder p_aaaaaaaaaa p_bbbbbbbbbb --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, projectReorder, await inv.tools.project.reorder(inv.args, inv.ctx())),
};

// ------------------------------------------------------------------ section commands

const sectionAdd: CommandDef = {
  group: "section",
  name: "add",
  summary: "Add a section to a project",
  positionals: [{ name: "project-ref", help: `The project: ${PROJECT_REF}.`, ref: "project" }, { name: "name", help: "The section name (unique within the project)." }],
  flags: {},
  examples: ['life section add health "Planning" --actor neel --json'],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, sectionAdd, await inv.tools.section.add({ project: inv.args[0]!, name: inv.args[1]! }, inv.ctx())),
};

const sectionList: CommandDef = {
  group: "section",
  name: "list",
  summary: "The sections of a project, in order, with ids",
  positionals: [{ name: "project-ref", help: `The project: ${PROJECT_REF}.`, ref: "project" }],
  flags: {},
  examples: ["life section list health --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const sections = await inv.tools.section.list(inv.args[0]!);
    return plain(EXIT.ok, sections, sections.length ? sectionTable(sections) : "No sections.");
  },
};

const sectionUpdate: CommandDef = {
  group: "section",
  name: "update",
  summary: "Rename a section",
  positionals: [POS.sectionId],
  flags: { name: { kind: "value", type: "text", help: "The new name." } },
  examples: ['life section update s_abc123def0 --name "Planning" --actor neel --json'],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const name = inv.flags.str("name");
    if (name === undefined) throw new UsageError("life section update: pass --name <text>", { layer: { kind: "command", command: sectionUpdate } });
    return rendered(inv, sectionUpdate, await inv.tools.section.update(inv.args[0]!, { name }, inv.ctx()));
  },
};

const SECTION_VERBS = { archive: "Archive a section", unarchive: "Bring an archived section back", restore: "Undelete a section" } as const;

const sectionVerb = (verb: keyof typeof SECTION_VERBS): CommandDef => {
  const def: CommandDef = {
    group: "section",
    name: verb,
    summary: SECTION_VERBS[verb],
    positionals: [POS.sectionId],
    flags: {},
    examples: [`life section ${verb} s_abc123def0 --actor neel --json`],
    exits: [...EXITS.write],
    mutates: true,
    database: "connect",
    run: async (inv) => rendered(inv, def, await inv.tools.section[verb](inv.args[0]!, inv.ctx())),
  };
  return def;
};

const sectionDelete: CommandDef = {
  group: "section",
  name: "delete",
  summary: "Delete a section; its tasks are deleted or left in the project without a section",
  description: "A section that still has tasks needs --tasks: without it the command is rejected with a `needs` error naming the options (on a terminal it asks).",
  positionals: [POS.sectionId],
  flags: { tasks: { kind: "value", values: ["delete", "unsection"], help: "What to do with the section's tasks." } },
  examples: ["life section delete s_abc123def0 --tasks unsection --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const opts = compact({ tasks: inv.flags.str("tasks") }) as { tasks?: SectionTasks };
    return rendered(inv, sectionDelete, await inv.tools.section.delete(inv.args[0]!, inv.ctx(), opts));
  },
};

const sectionReorder: CommandDef = {
  group: "section",
  name: "reorder",
  summary: "Put a project's sections in this order",
  positionals: [{ name: "id", help: "Section ids (s_...), in the wanted order; all in one project.", variadic: true }],
  flags: {},
  examples: ["life section reorder s_aaaaaaaaaa s_bbbbbbbbbb --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, sectionReorder, await inv.tools.section.reorder(inv.args, inv.ctx())),
};

// ------------------------------------------------------------------ label commands

const labelAdd: CommandDef = {
  group: "label",
  name: "add",
  summary: "Create a label (tasks and projects also create labels on first use)",
  positionals: [{ name: "name", help: "A slug: lowercase letters, digits, dots, dashes." }],
  flags: { color: { kind: "value", type: "text", help: "Any color name or hex." } },
  examples: ["life label add fitness --color green --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, labelAdd, await inv.tools.label.add(compact({ name: inv.args[0]!, color: inv.flags.str("color") }) as LabelAdd, inv.ctx())),
};

const labelList: CommandDef = {
  group: "label",
  name: "list",
  summary: "Every label with its id and color",
  positionals: [],
  flags: {},
  examples: ["life label list --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const labels = await inv.tools.label.list();
    return plain(EXIT.ok, labels, labels.length ? labelTable(labels) : "No labels.");
  },
};

const labelUpdate: CommandDef = {
  group: "label",
  name: "update",
  summary: "Rename a label or change its color (tasks carrying it follow)",
  positionals: [POS.labelRef],
  flags: {
    name: { kind: "value", type: "slug", help: "The new name." },
    color: { kind: "value", type: "text", help: "The new color." },
    "no-color": { kind: "bool", help: "Clear the color." },
  },
  examples: ["life label update fitness --name exercise --actor neel --json", "life label update fitness --no-color --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const input = compact({ name: inv.flags.str("name"), color: inv.flags.clearable("color") });
    if (!Object.keys(input).length) throw new UsageError("life label update: nothing to change; pass --name, --color, or --no-color", { layer: { kind: "command", command: labelUpdate } });
    return rendered(inv, labelUpdate, await inv.tools.label.update(inv.args[0]!, input as LabelUpdate, inv.ctx()));
  },
};

const LABEL_VERBS = { delete: "Delete a label (refused while a task or project carries it)", restore: "Undelete a label" } as const;

const labelVerb = (verb: keyof typeof LABEL_VERBS): CommandDef => {
  const def: CommandDef = {
    group: "label",
    name: verb,
    summary: LABEL_VERBS[verb],
    positionals: [POS.labelRef],
    flags: {},
    examples: [`life label ${verb} fitness --actor neel --json`],
    exits: [...EXITS.write],
    mutates: true,
    database: "connect",
    run: async (inv) => rendered(inv, def, await inv.tools.label[verb](inv.args[0]!, inv.ctx())),
  };
  return def;
};

const labelReorder: CommandDef = {
  group: "label",
  name: "reorder",
  summary: "Put labels in this order",
  positionals: [{ name: "id", help: "Label ids (l_...), in the wanted order.", variadic: true }],
  flags: {},
  examples: ["life label reorder l_aaaaaaaaaa l_bbbbbbbbbb --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, labelReorder, await inv.tools.label.reorder(inv.args, inv.ctx())),
};

// ------------------------------------------------------------------ filter commands

const filterAdd: CommandDef = {
  group: "filter",
  name: "add",
  summary: "Save a filter query under a name",
  positionals: [{ name: "name", help: "The filter's name (not a grammar word such as today or overdue)." }, { name: "query", help: "A filter query; see the grammar below." }],
  flags: {},
  examples: ['life filter add "Health this week" "7 days & @health" --actor neel --json'],
  notes: FILTER_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, filterAdd, await inv.tools.filter.add({ name: inv.args[0]!, query: inv.args[1]! }, inv.ctx())),
};

const filterList: CommandDef = {
  group: "filter",
  name: "list",
  summary: "Every saved filter with its id and query",
  positionals: [],
  flags: {},
  examples: ["life filter list --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const filters = await inv.tools.filter.list();
    return plain(EXIT.ok, filters, filters.length ? filterTable(filters) : "No filters.");
  },
};

const filterRun: CommandDef = {
  group: "filter",
  name: "run",
  summary: "The tasks a saved filter (by name or id) or an ad hoc query matches",
  positionals: [{ name: "ref|query", help: "A saved filter's name or id, else a query in the grammar below." }],
  flags: {},
  examples: ['life filter run "Health this week" --json', 'life filter run "(overdue | today) & !subtask" --json'],
  notes: FILTER_NOTES,
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  run: async (inv) => renderedTasks(inv, await inv.tools.views.filter(inv.args[0]!)),
};

const filterUpdate: CommandDef = {
  group: "filter",
  name: "update",
  summary: "Rename a saved filter or change its query",
  positionals: [POS.filterRef],
  flags: {
    name: { kind: "value", type: "text", help: "The new name." },
    query: { kind: "value", type: "query", help: "The new query; see the grammar below." },
  },
  examples: ['life filter update "Health this week" --query "14 days & @health" --actor neel --json'],
  notes: FILTER_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const input = compact({ name: inv.flags.str("name"), query: inv.flags.str("query") });
    if (!Object.keys(input).length) throw new UsageError("life filter update: nothing to change; pass --name or --query", { layer: { kind: "command", command: filterUpdate } });
    return rendered(inv, filterUpdate, await inv.tools.filter.update(inv.args[0]!, input as FilterUpdate, inv.ctx()));
  },
};

const FILTER_VERBS = { delete: "Delete a saved filter", restore: "Undelete a saved filter" } as const;

const filterVerb = (verb: keyof typeof FILTER_VERBS): CommandDef => {
  const def: CommandDef = {
    group: "filter",
    name: verb,
    summary: FILTER_VERBS[verb],
    positionals: [POS.filterRef],
    flags: {},
    examples: [`life filter ${verb} "Health this week" --actor neel --json`],
    exits: [...EXITS.write],
    mutates: true,
    database: "connect",
    run: async (inv) => rendered(inv, def, await inv.tools.filter[verb](inv.args[0]!, inv.ctx())),
  };
  return def;
};

const filterReorder: CommandDef = {
  group: "filter",
  name: "reorder",
  summary: "Put saved filters in this order",
  positionals: [{ name: "id", help: "Filter ids (f_...), in the wanted order.", variadic: true }],
  flags: {},
  examples: ["life filter reorder f_aaaaaaaaaa f_bbbbbbbbbb --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, filterReorder, await inv.tools.filter.reorder(inv.args, inv.ctx())),
};

// ------------------------------------------------------------------ views and maintenance

const today: CommandDef = {
  group: null,
  name: "today",
  summary: "Overdue, due today, deadlines, and the proposed queue",
  description: "Accepted and in-progress tasks that are overdue or due on the date, tasks whose deadline is the date or past, and every proposed task (the review queue).",
  positionals: [],
  flags: { date: dateFlagDef("The day to look at"), },
  examples: ["life today --json", "life today --date tomorrow"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const view = await inv.tools.views.today(compact({ date: dateFlag(inv, "date") }));
    return { code: EXIT.ok, result: view, text: async () => todayText(view, await projectIndex(inv.tools)) };
  },
};

const upcoming: CommandDef = {
  group: null,
  name: "upcoming",
  summary: "Open tasks day by day for the coming days (overdue under the first day)",
  positionals: [{ name: "days", help: "How many days, 1 to 366.", optional: true }],
  flags: { from: dateFlagDef("The first day") },
  examples: ["life upcoming --json", "life upcoming 14 --from tomorrow --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const raw = inv.args[0];
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new UsageError(`life upcoming: days must be a whole number, got "${raw}"`, { layer: { kind: "command", command: upcoming } });
    const days = raw === undefined ? undefined : Number(raw);
    const view = await inv.tools.views.upcoming(days, compact({ from: dateFlag(inv, "from") }));
    return { code: EXIT.ok, result: view, text: async () => upcomingText(view, await projectIndex(inv.tools)) };
  },
};

const search: CommandDef = {
  group: null,
  name: "search",
  summary: "Tasks of any status whose title, notes, or comments contain the text",
  positionals: [{ name: "text", help: "The text to look for, case-insensitive." }],
  flags: {},
  examples: ['life search "car registration" --json'],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  run: async (inv) => renderedTasks(inv, await inv.tools.views.search(inv.args[0]!), "No matches."),
};

const trash: CommandDef = {
  group: null,
  name: "trash",
  summary: "Every deleted task, project, section, label, and filter, newest deletion first",
  positionals: [],
  flags: {},
  examples: ["life trash --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const view = await inv.tools.views.trash();
    return { code: EXIT.ok, result: view, text: async () => trashText(view, await projectIndex(inv.tools)) };
  },
};

const exportCommand: CommandDef = {
  group: null,
  name: "export",
  summary: "Dump everything (deleted rows and the log included) as JSON, to a file or stdout",
  positionals: [{ name: "file", help: "Where to write; without it the dump goes to stdout.", optional: true }],
  flags: {},
  examples: ["life export ./life-backup.json --json", "life export > life-backup.json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const dump = await inv.tools.export();
    const file = inv.args[0];
    const body = `${JSON.stringify(dump, null, 2)}\n`;
    if (file === undefined) {
      // A dump is JSON whichever way it is asked for.
      return { code: EXIT.ok, result: dump, text: () => body.trimEnd() };
    }
    await writeFile(file, body);
    const counts = {
      projects: dump.projects.length,
      sections: dump.sections.length,
      labels: dump.labels.length,
      filters: dump.filters.length,
      tasks: dump.tasks.length,
      log: dump.log.length,
    };
    const summary = Object.entries(counts)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
    return plain(EXIT.ok, { file, exportedAt: dump.exportedAt, ...counts }, `Exported ${summary} to ${file} (${body.length} bytes).`);
  },
};

const migrate: CommandDef = {
  group: null,
  name: "migrate",
  summary: "Apply pending database migrations",
  positionals: [],
  flags: {},
  examples: ["life migrate", "life migrate --db postgres://life@localhost:5432/life --json"],
  exits: [EXIT.ok, EXIT.database, EXIT.usage],
  mutates: false,
  // The dispatcher opens Tools with migrate: true for this command; by the time run() is called the schema is current.
  database: "migrate",
  run: async () => plain(EXIT.ok, { migrated: true }, "Database migrated."),
};

// ------------------------------------------------------------------ doctor

type CheckStatus = "ok" | "warn" | "fail";
type Check = { name: string; status: CheckStatus; value: string; hint?: string };
type DoctorReport = { healthy: boolean; checks: Check[] };

/** Where the database URL came from, for doctor and for database-failure hints. */
type DbSource = {
  url: string | undefined;
  /** "--db", "LIFE_DATABASE_URL in the environment", or the .env file. */
  source: string;
  envFile: string;
  envFileExists: boolean;
  /** True when the .env file supplied the URL. */
  envFileRead: boolean;
};

function databaseSource(flags: Flags, io: CliIo): DbSource {
  const envFile = ENV_FILE;
  const envFileExists = existsSync(envFile);
  const flag = flags.str("db");
  if (flag !== undefined) return { url: flag, source: "--db", envFile, envFileExists, envFileRead: false };
  const fromEnv = io.env.LIFE_DATABASE_URL;
  if (fromEnv) return { url: fromEnv, source: "LIFE_DATABASE_URL in the environment", envFile, envFileExists, envFileRead: false };
  // The library loads the .env file when the variable is unset; ask it the same way.
  try {
    const url = databaseUrl();
    return { url, source: `LIFE_DATABASE_URL in ${envFile}`, envFile, envFileExists, envFileRead: true };
  } catch {
    return { url: undefined, source: "unset", envFile, envFileExists, envFileRead: false };
  }
}

const doctor: CommandDef = {
  group: null,
  name: "doctor",
  summary: "Check the setup: env file, database URL, connectivity, migrations, timezone, actor, Inbox",
  description: "Runs every check and reports each as ok, warn, or fail. Exit 0 when healthy, 3 when the database cannot be reached (or its URL is unset), 1 for any other failure. Never migrates.",
  positionals: [],
  flags: {},
  examples: ["life doctor", "life doctor --json", "life doctor --verbose --db postgres://life@localhost:5432/life"],
  exits: [EXIT.ok, EXIT.rejected, EXIT.database, EXIT.usage],
  mutates: false,
  database: "none",
  async run(setup) {
    const report = await runDoctor(setup);
    const failed = report.checks.filter((c) => c.status === "fail");
    const dbDown = failed.some((c) => c.name === "database url" || c.name === "connectivity");
    const code = dbDown ? EXIT.database : failed.length ? EXIT.rejected : EXIT.ok;
    const error: EnvelopeError | undefined = failed.length
      ? {
          code: dbDown ? "db_unavailable" : "rejected",
          message: `${failed.length} check${failed.length === 1 ? "" : "s"} failed: ${failed.map((c) => c.name).join(", ")}`,
          issues: failed.map((c) => `${c.name}: ${c.value}`),
          hint: failed.map((c) => c.hint).filter((h): h is string => Boolean(h)).join("; "),
        }
      : undefined;
    return { code, result: report, text: () => doctorText(report), ...(error ? { error } : {}) };
  },
};

async function runDoctor(setup: Setup): Promise<DoctorReport> {
  const checks: Check[] = [];
  const db = setup.db;

  checks.push({
    name: "env file",
    status: "ok",
    value: db.envFileRead ? `read ${db.envFile}` : db.envFileExists ? `${db.envFile} (present, not needed: ${db.source})` : `${db.envFile} not found (not needed: ${db.source})`,
  });

  if (!db.url) {
    checks[0] = { name: "env file", status: "warn", value: db.envFileExists ? `${db.envFile} read but it sets no LIFE_DATABASE_URL` : `${db.envFile} not found` };
    checks.push({
      name: "database url",
      status: "fail",
      value: "LIFE_DATABASE_URL is not set",
      hint: `set LIFE_DATABASE_URL in the environment or in ${db.envFile}, or pass --db <url>`,
    });
  } else {
    checks.push({ name: "database url", status: "ok", value: `${describeUrl(db.url)} (from ${db.source})` });
  }

  let connected = false;
  let migrated = false;
  if (db.url) {
    const pool = createPool(db.url, { connectionTimeoutMillis: 5000, max: 1 });
    try {
      try {
        const version = await pool.query<{ version: string; schema: string | null }>("select version() as version, current_schema() as schema");
        const row = version.rows[0]!;
        connected = true;
        const server = /PostgreSQL [\d.]+/.exec(row.version)?.[0] ?? row.version;
        checks.push({ name: "connectivity", status: "ok", value: `connected to ${describeUrl(db.url)}; ${server}; schema ${row.schema ?? "(none on search_path)"}` });
      } catch (error) {
        setup.trace(`doctor: connect failed: ${messageOf(error)}`);
        for (const line of sqlDetails(error)) setup.trace(`  ${line}`);
        checks.push({
          name: "connectivity",
          status: "fail",
          value: `cannot connect to ${describeUrl(db.url)}: ${messageOf(error)}`,
          hint: "check that Postgres is running and that the URL's host, port, database, user, and password are right",
        });
      }

      if (!connected) checks.push({ name: "migrations", status: "warn", value: "unknown until connected" });
      else {
        const journal = readJournal();
        try {
          const applied = await pool.query<{ n: number; latest: string | null }>('select count(*)::int as n, max(created_at)::text as latest from "__drizzle_migrations"');
          const row = applied.rows[0]!;
          const latest = row.latest === null ? 0 : Number(row.latest);
          const pending = journal.entries.filter((e) => e.when > latest);
          if (!pending.length) {
            migrated = true;
            checks.push({ name: "migrations", status: "ok", value: `current (${row.n} applied, latest ${journal.entries.at(-1)?.tag ?? "none"})` });
          } else {
            checks.push({ name: "migrations", status: "fail", value: `${pending.length} pending: ${pending.map((e) => e.tag).join(", ")}`, hint: "run `life migrate`" });
          }
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          if (code === "42P01") checks.push({ name: "migrations", status: "fail", value: "not migrated (no __drizzle_migrations table in this schema)", hint: "run `life migrate`" });
          else checks.push({ name: "migrations", status: "fail", value: `cannot read the migration journal: ${messageOf(error)}`, hint: "run `life migrate`" });
          setup.trace(`doctor: migrations check failed: ${messageOf(error)}`);
          for (const line of sqlDetails(error)) setup.trace(`  ${line}`);
        }
      }

      if (migrated) {
        try {
          const inbox = await new PgStore(pool).read((tx) => findInbox(tx));
          checks.push(inbox ? { name: "inbox", status: "ok", value: `${inbox.id} (${inbox.name})` } : { name: "inbox", status: "ok", value: "not created yet; the first task or `life project get inbox` creates it" });
        } catch (error) {
          checks.push({ name: "inbox", status: "fail", value: `cannot read projects: ${messageOf(error)}`, hint: "run `life migrate`" });
        }
      } else {
        checks.push({ name: "inbox", status: "warn", value: connected ? "unknown until migrated" : "unknown until connected" });
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  } else {
    checks.push({ name: "connectivity", status: "fail", value: "no URL to connect to", hint: "run `life doctor` again once LIFE_DATABASE_URL is set" });
    checks.push({ name: "migrations", status: "warn", value: "unknown until connected" });
    checks.push({ name: "inbox", status: "warn", value: "unknown until connected" });
  }

  const envTz = setup.io.env.LIFE_TZ;
  const badTz = envTz !== undefined && envTz !== "" && !isValidTimezone(envTz);
  checks.push(
    badTz && setup.tzSource !== "--tz"
      ? { name: "timezone", status: "fail", value: `LIFE_TZ="${envTz}" is not an IANA timezone; using ${setup.tz} (${setup.tzSource})`, hint: "set LIFE_TZ to a zone such as America/Los_Angeles, or unset it" }
      : { name: "timezone", status: "ok", value: `${setup.tz} (${setup.tzSource})` },
  );

  checks.push(
    setup.actor === undefined
      ? { name: "actor", status: "warn", value: "none: reads work, every write needs --actor or LIFE_ACTOR", hint: "pass --actor codex (or agent:<name>) or set LIFE_ACTOR" }
      : { name: "actor", status: "ok", value: `${setup.actor} (${setup.actorSource})` },
  );

  const healthy = checks.every((c) => c.status !== "fail");
  return { healthy, checks };
}

function readJournal(): { entries: { tag: string; when: number }[] } {
  try {
    const parsed = JSON.parse(readFileSync(MIGRATIONS_JOURNAL, "utf8")) as { entries?: { tag?: unknown; when?: unknown }[] };
    const entries = (parsed.entries ?? []).map((e) => ({ tag: String(e.tag ?? "?"), when: Number(e.when ?? 0) }));
    return { entries };
  } catch {
    return { entries: [] };
  }
}

function doctorText(report: DoctorReport): string {
  const rows = report.checks.map((c) => [c.name, c.status, c.value, c.hint ? `-> ${c.hint}` : ""]);
  return `${table(rows)}\n${report.healthy ? "Healthy." : "Problems found."}`;
}

// ------------------------------------------------------------------ the registry

const GROUP_INFO: Record<GroupName, string> = {
  task: "Tasks: add, list, get, change, move, schedule, complete, cancel, delete, comment, import",
  project: "Projects: the nested tree the tasks live in (the Inbox is the system project)",
  section: "Sections: named groups of tasks inside a project",
  label: "Labels: tags a task carries directly or through its project",
  filter: "Saved filters and the query grammar",
};
const GROUP_NAMES = Object.keys(GROUP_INFO) as GroupName[];

const COMMAND_LIST: CommandDef[] = [
  taskAdd,
  taskGet,
  taskList,
  taskUpdate,
  taskMove,
  taskReorder,
  taskDuplicate,
  transition("accept"),
  transition("start"),
  taskComplete,
  transition("uncomplete"),
  transition("cancel"),
  taskDelete,
  transition("restore"),
  taskAssign,
  taskReschedule,
  taskNote,
  taskHistory,
  taskImport,
  projectAdd,
  projectTree,
  projectGet,
  projectUpdate,
  projectMove,
  projectVerb("archive"),
  projectVerb("unarchive"),
  projectDelete,
  projectVerb("restore"),
  projectReorder,
  sectionAdd,
  sectionList,
  sectionUpdate,
  sectionVerb("archive"),
  sectionVerb("unarchive"),
  sectionDelete,
  sectionVerb("restore"),
  sectionReorder,
  labelAdd,
  labelList,
  labelUpdate,
  labelVerb("delete"),
  labelVerb("restore"),
  labelReorder,
  filterAdd,
  filterList,
  filterRun,
  filterUpdate,
  filterVerb("delete"),
  filterVerb("restore"),
  filterReorder,
  today,
  upcoming,
  search,
  trash,
  exportCommand,
  migrate,
  doctor,
];

const commandName = (command: CommandDef): string => (command.group ? `${command.group} ${command.name}` : command.name);

// Every command shows at least two examples: where only one was written, its other output mode is the second.
for (const command of COMMAND_LIST) {
  if (command.examples.length >= 2) continue;
  const first = command.examples[0] ?? `life ${commandName(command)}`;
  command.examples.push(first.endsWith(" --json") ? first.slice(0, -" --json".length) : `${first} --json`);
}

/** Every command by its full name ("task add", "today"). */
export const COMMANDS: ReadonlyMap<string, CommandDef> = new Map(COMMAND_LIST.map((command) => [commandName(command), command]));

const isGroup = (word: string): word is GroupName => (GROUP_NAMES as string[]).includes(word);
const commandsOf = (group: GroupName): CommandDef[] => COMMAND_LIST.filter((c) => c.group === group);
const TOP_COMMANDS = COMMAND_LIST.filter((c) => c.group === null);

// ------------------------------------------------------------------ suggestions

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[] = Array.from({ length: rows * cols }, (_, i) => (i < cols ? i : i % cols === 0 ? i / cols : 0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i * cols + j] = Math.min(d[(i - 1) * cols + j]! + 1, d[i * cols + j - 1]! + 1, d[(i - 1) * cols + j - 1]! + cost);
    }
  }
  return d[rows * cols - 1]!;
}

/** The closest known names: prefix matches first, then names containing the word, then anything within a small edit distance. */
export function suggest(word: string, known: readonly string[]): string[] {
  const lowered = word.toLowerCase();
  const scored = known
    .map((name) => {
      const candidate = name.toLowerCase();
      const prefix = candidate.startsWith(lowered) || lowered.startsWith(candidate);
      const contains = lowered.length >= 3 && candidate.includes(lowered);
      return { name, distance: editDistance(lowered, candidate), rank: prefix ? 0 : contains ? 1 : 2 };
    })
    .filter(({ rank, distance, name }) => rank < 2 || distance <= Math.max(2, Math.floor(name.length / 3)))
    .sort((a, b) => a.rank - b.rank || a.distance - b.distance || a.name.localeCompare(b.name));
  return scored.slice(0, 3).map(({ name }) => name);
}

const suggestion = (word: string, known: readonly string[], render: (name: string) => string = (n) => n): string => {
  const found = suggest(word, known);
  return found.length ? `did you mean ${found.map(render).join(", ")}?` : "";
};

// ------------------------------------------------------------------ parsing

type Parsed =
  | { kind: "help"; layer: Layer }
  | { kind: "version" }
  | { kind: "run"; command: CommandDef; args: string[]; flags: Flags };

/** The layer the words name, or a usage error naming the first unknown word with suggestions. */
function layerOf(words: string[]): Layer {
  if (!words.length) return { kind: "top" };
  const [first, second, ...rest] = words as [string, ...string[]];
  if (isGroup(first)) {
    if (second === undefined) return { kind: "group", group: first };
    const command = COMMANDS.get(`${first} ${second}`);
    if (!command) {
      const known = commandsOf(first).map((c) => c.name);
      throw new UsageError(`unknown command "${first} ${second}"; ${suggestion(second, known, (n) => `\`life ${first} ${n}\``) || `\`life help ${first}\` lists the ${first} commands`}`, { layer: { kind: "group", group: first } });
    }
    if (rest.length) throw new UsageError(`life ${first} ${second}: unexpected argument "${rest[0]}"`, { layer: { kind: "command", command } });
    return { kind: "command", command };
  }
  const top = COMMANDS.get(first);
  if (top) {
    if (second !== undefined) throw new UsageError(`life ${first}: unexpected argument "${second}"`, { layer: { kind: "command", command: top } });
    return { kind: "command", command: top };
  }
  const known = [...GROUP_NAMES, ...TOP_COMMANDS.map((c) => c.name), "help"];
  throw new UsageError(`unknown command "${first}"; ${suggestion(first, known, (n) => `\`life ${n}\``) || "`life --help` lists the groups and commands"}`, { layer: { kind: "top" } });
}

/** The group and command words on a line, skipping flag values; lenient, for help. Unknown words are kept so layerOf can name them. */
function commandWords(tokens: string[]): string[] {
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--") break;
    if (token.startsWith("--")) {
      // Only global flags can precede the command word; a value-taking one owns the next token.
      const def = token.includes("=") ? undefined : GLOBAL_FLAGS[token.slice(2)];
      if (def && def.kind !== "bool") i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    words.push(token);
    // A top-level command or an unknown word ends the scan; a group waits for its command word.
    if (words.length === 2 || !isGroup(token)) break;
  }
  return words;
}

function parseArgv(argv: string[]): Parsed {
  const beforeDashDash = argv.indexOf("--") === -1 ? argv : argv.slice(0, argv.indexOf("--"));
  if (beforeDashDash.includes("--version") || beforeDashDash.includes("-V")) return { kind: "version" };
  if (beforeDashDash.includes("--help") || beforeDashDash.includes("-h")) return { kind: "help", layer: layerOf(commandWords(beforeDashDash)) };
  if (argv[0] === "help") return { kind: "help", layer: layerOf(commandWords(argv.slice(1))) };

  const flags = new Flags();
  const args: string[] = [];
  const seen: string[] = [];
  let command: CommandDef | null = null;
  let group: GroupName | null = null;
  let onlyPositionals = false;

  const layer = (): Layer => (command ? { kind: "command", command } : group ? { kind: "group", group } : { kind: "top" });

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (onlyPositionals || !token.startsWith("--") || token === "-") {
      if (command) args.push(token);
      else {
        seen.push(token);
        const found = layerOf(seen);
        if (found.kind === "group") group = found.group;
        else if (found.kind === "command") command = found.command;
      }
      continue;
    }
    if (token === "--") {
      onlyPositionals = true;
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token : token.slice(0, eq)).slice(2);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    const def = GLOBAL_FLAGS[name] ?? command?.flags[name];
    if (!def) {
      const known = [...Object.keys(command?.flags ?? {}), ...Object.keys(GLOBAL_FLAGS)];
      const where = command ? `for \`life ${commandName(command)}\`` : group ? `before the ${group} command` : "before the command";
      const hint = command ? `run \`life ${commandName(command)} --help\` for its flags` : "flags belong after the command; run `life --help` for the global flags";
      throw new UsageError(`unknown flag --${name} ${where}; ${suggestion(name, known, (n) => `--${n}`) || hint}`, { layer: layer(), hint });
    }
    if (def.kind === "bool") {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`, { layer: layer() });
      flags.set(name, def.kind, undefined);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} needs a value${def.type ? ` (${def.type})` : ""}`, { layer: layer() });
      value = next;
      i++;
    }
    if (def.values && !def.values.includes(value)) {
      throw new UsageError(`--${name} expects one of ${def.values.join(", ")}, got "${value}"`, { layer: layer(), hint: `pass --${name} ${def.values.join("|")}` });
    }
    flags.set(name, def.kind, value);
  }

  if (!command) {
    if (group) throw new UsageError(`life ${group}: a command is required`, { layer: { kind: "group", group }, hint: `run \`life help ${group}\` to see the ${group} commands` });
    throw new UsageError("a command is required", { layer: { kind: "top" }, hint: "run `life --help`" });
  }
  const name = commandName(command);
  const required = command.positionals.filter((p) => !p.optional && !p.variadic);
  const min = required.length + (command.positionals.some((p) => p.variadic) ? 1 : 0);
  const max = command.positionals.some((p) => p.variadic) ? null : command.positionals.length;
  if (args.length < min) {
    const missing = command.positionals[args.length]!;
    throw new UsageError(`life ${name}: missing <${missing.name}>: ${missing.help}`, { layer: { kind: "command", command }, hint: `usage: ${usageLine(command)}` });
  }
  if (max !== null && args.length > max) throw new UsageError(`life ${name}: unexpected argument "${args[max]}"`, { layer: { kind: "command", command }, hint: `usage: ${usageLine(command)}` });
  return { kind: "run", command, args, flags };
}

// ------------------------------------------------------------------ help

const EXIT_LINES = Object.entries(EXIT_MEANING).map(([code, meaning]) => `  ${code.padEnd(4)}${meaning}`);

function usageLine(command: CommandDef): string {
  const positionals = command.positionals.map((p) => (p.variadic ? `<${p.name}> [<${p.name}>...]` : p.optional ? `[${p.name}]` : `<${p.name}>`));
  const flags = Object.keys(command.flags).length ? " [flags]" : "";
  return `life ${commandName(command)}${positionals.length ? ` ${positionals.join(" ")}` : ""}${flags} [global flags]`;
}

function flagLines(flags: FlagSpec): string[] {
  const rows = Object.entries(flags).map(([name, def]) => {
    const head = def.kind === "bool" ? `--${name}` : `--${name} <${def.values && !def.type ? def.values.join("|") : (def.type ?? "value")}>`;
    const tail: string[] = [def.help];
    if (def.values && def.type) tail.push(`One of ${def.values.join(", ")}.`);
    if (def.default) tail.push(`Default: ${def.default}.`);
    if (def.kind === "list" && !/Repeatable/.test(def.help)) tail.push("Repeatable.");
    return [head, tail.join(" ")];
  });
  const width = Math.max(0, ...rows.map(([head]) => head!.length));
  return rows.map(([head, tail]) => `  ${head!.padEnd(width)}  ${tail}`);
}

function positionalLines(positionals: Positional[]): string[] {
  const rows = positionals.map((p) => [p.variadic ? `<${p.name}>...` : p.optional ? `[${p.name}]` : `<${p.name}>`, `${p.help}${p.optional ? " Optional." : ""}${p.variadic ? " One or more." : ""}`]);
  const width = Math.max(0, ...rows.map(([head]) => head!.length));
  return rows.map(([head, tail]) => `  ${head!.padEnd(width)}  ${tail}`);
}

const HEADER = "life: the Life-OS todo list from a shell. One JSON envelope on stdout when --json is passed or stdout is not a terminal; diagnostics on stderr; stable exit codes.";

export function topHelp(): string {
  const groupRows = GROUP_NAMES.map((g) => [`life ${g} <command>`, GROUP_INFO[g]]);
  const topRows = [
    ...TOP_COMMANDS.map((c) => [usageLine(c).replace(/ \[flags\]| \[global flags\]/g, ""), c.summary]),
    ["life help [group] [command]", "Help for a layer (also --help or -h anywhere)"],
    ["life --version", "Print the package version"],
  ];
  const width = Math.max(...[...groupRows, ...topRows].map(([head]) => head!.length));
  const row = ([head, tail]: string[]) => `  ${head!.padEnd(width)}  ${tail}`;
  return [
    HEADER,
    "",
    "usage: life <group> <command> [args] [flags]   |   life <command> [args] [flags]",
    "",
    "groups (run `life help <group>` for the commands, `life help <group> <command>` for flags and examples):",
    ...groupRows.map(row),
    "",
    "commands:",
    ...topRows.map(row),
    "",
    "global flags (accepted by every command):",
    ...flagLines(GLOBAL_FLAGS),
    "",
    "environment:",
    "  LIFE_DATABASE_URL  Postgres URL; when unset it is read from the repository .env file. --db overrides it.",
    "  LIFE_ACTOR         The actor when --actor is not passed. Without either, a terminal defaults to neel and a program must pass --actor.",
    "  LIFE_TZ            IANA timezone when --tz is not passed; else the machine's timezone.",
    "  LIFE_DEBUG         Set to 1 for the same output as --verbose.",
    `  .env file          ${ENV_FILE}`,
    "",
    "references and formats:",
    "  ids        t_ (task), p_ (project), s_ (section), l_ (label), f_ (filter), each followed by ten [a-z0-9] characters; every list and receipt shows them",
    "  project    an id, a slug path from the root such as health/dental, or inbox; `life project tree` shows paths and ids",
    "  section    a name within the task's project, or an id; `life section list <project-ref>` shows them",
    "  label      a slug name such as health, or an id; `life label list` shows them",
    "  filter     a saved filter's name or id, or a query; `life help filter` explains the query grammar",
    `  date       ${DATE_HELP}`,
    "  time       HH:MM (24-hour), stored with the effective timezone",
    "  actor      neel, codex, agent:<name>, or import:<provider>; a task added by anyone but neel lands as proposed",
    "",
    "exit codes:",
    ...EXIT_LINES,
    "",
    "JSON envelope (stdout, one object): { ok, command, exitCode, result?, error?: { code, message, issues, hint?, needs?, candidates? }, warnings? }",
    "  error.code is one of usage, rejected, duplicate, needs, not_found, db_unavailable, internal; result is the library's return value (receipt, record, list, or view) untouched.",
    "  A `needs` error carries { field, options, message }: ask, then retry with --<field> <option>. A `duplicate` error carries the candidate tasks.",
    "",
    "next: `life doctor` checks the setup; `life help task` lists the task commands; `life help task add` shows every flag with examples.",
  ].join("\n");
}

export function groupHelp(group: GroupName): string {
  const rows = commandsOf(group).map((c) => [usageLine(c).replace(/ \[flags\]| \[global flags\]/g, ""), c.summary]);
  const width = Math.max(...rows.map(([head]) => head!.length));
  const lines = [
    `life ${group}: ${GROUP_INFO[group]}`,
    "",
    "commands (run `life help " + group + " <command>` for flags and examples):",
    ...rows.map(([head, tail]) => `  ${head!.padEnd(width)}  ${tail}`),
  ];
  if (group === "filter") lines.push("", ...FILTER_NOTES);
  if (group === "project") lines.push("", `refs: ${PROJECT_REF}. The Inbox (slug inbox) is created on first use and cannot be deleted.`);
  if (group === "section") lines.push("", `refs: ${SECTION_REF}.`);
  lines.push("", "global flags: see `life --help` (--actor is required for every write when not on a terminal).", "", "exit codes:", ...EXIT_LINES);
  return lines.join("\n");
}

export function commandHelp(command: CommandDef): string {
  const lines = [`life ${commandName(command)}: ${command.summary}`, "", `usage: ${usageLine(command)}`];
  if (command.description) lines.push("", command.description);
  if (command.positionals.length) lines.push("", "positionals:", ...positionalLines(command.positionals));
  lines.push("", Object.keys(command.flags).length ? "flags:" : "flags: none of its own", ...flagLines(command.flags));
  lines.push("", `global flags: --actor --reason --evidence --key --if-version --json --tz --db --verbose (see \`life --help\`)${command.mutates ? "; this command writes, so --actor (or LIFE_ACTOR) is required when not on a terminal" : ""}`);
  lines.push("", "examples:", ...command.examples.map((e) => `  ${e}`));
  if (command.notes?.length) lines.push("", ...command.notes);
  lines.push("", "exit codes:", ...command.exits.map((code) => `  ${String(code).padEnd(4)}${EXIT_MEANING[code]}`));
  return lines.join("\n");
}

function helpText(layer: Layer): string {
  switch (layer.kind) {
    case "top":
      return topHelp();
    case "group":
      return groupHelp(layer.group);
    case "command":
      return commandHelp(layer.command);
  }
}

/** The same help as data, for `life help ... --json`. */
function helpData(layer: Layer): unknown {
  const flagData = (flags: FlagSpec) =>
    Object.entries(flags).map(([name, def]) => compact({ name, kind: def.kind, type: def.type, values: def.values, default: def.default, repeatable: def.kind === "list", help: def.help }));
  const commandData = (command: CommandDef) =>
    compact({
      command: commandName(command),
      summary: command.summary,
      description: command.description,
      usage: usageLine(command),
      positionals: command.positionals.map((p) => compact({ name: p.name, help: p.help, optional: p.optional ?? false, variadic: p.variadic ?? false })),
      flags: flagData(command.flags),
      examples: command.examples,
      notes: command.notes,
      exitCodes: command.exits.map((code) => ({ code, meaning: EXIT_MEANING[code] })),
      mutates: command.mutates,
    });
  switch (layer.kind) {
    case "top":
      return {
        usage: "life <group> <command> [args] [flags]",
        groups: GROUP_NAMES.map((g) => ({ group: g, summary: GROUP_INFO[g], commands: commandsOf(g).map((c) => ({ command: commandName(c), summary: c.summary })) })),
        commands: TOP_COMMANDS.map((c) => ({ command: c.name, summary: c.summary })),
        globalFlags: flagData(GLOBAL_FLAGS),
        environment: ["LIFE_DATABASE_URL", "LIFE_ACTOR", "LIFE_TZ", "LIFE_DEBUG"],
        envFile: ENV_FILE,
        exitCodes: Object.entries(EXIT_MEANING).map(([code, meaning]) => ({ code: Number(code), meaning })),
        filterGrammar: FILTER_GRAMMAR,
        text: topHelp(),
      };
    case "group":
      return { group: layer.group, summary: GROUP_INFO[layer.group], commands: commandsOf(layer.group).map(commandData), ...(layer.group === "filter" ? { filterGrammar: FILTER_GRAMMAR } : {}), text: groupHelp(layer.group) };
    case "command":
      return { ...(commandData(layer.command) as object), text: commandHelp(layer.command) };
  }
}

const layerName = (layer: Layer): string => (layer.kind === "top" ? "" : layer.kind === "group" ? layer.group : commandName(layer.command));

// ------------------------------------------------------------------ the dispatcher

/** In JSON mode nothing but the envelope may reach stdout; anything a dependency logs is moved to stderr for the duration. */
function muteStdoutLogging(io: CliIo): () => void {
  const original = { log: console.log, info: console.info, debug: console.debug };
  const toStderr = (...parts: unknown[]) => io.stderr.write(`${parts.map(String).join(" ")}\n`);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  return () => {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
  };
}

class Session {
  readonly #argv: string[];
  readonly #io: CliIo;
  readonly #json: boolean;
  readonly #explicitJson: boolean;
  readonly #verbose: boolean;
  readonly #warnings: string[] = [];
  #command = "";
  #args: string[] = [];
  #commandDef: CommandDef | null = null;
  #layer: Layer = { kind: "top" };
  #db: DbSource | null = null;

  constructor(argv: string[], io: CliIo) {
    this.#argv = argv;
    this.#io = io;
    const end = argv.indexOf("--");
    const tokens = end === -1 ? argv : argv.slice(0, end);
    this.#explicitJson = tokens.includes("--json");
    this.#json = this.#explicitJson || !io.stdout.isTTY;
    this.#verbose = tokens.includes("--verbose") || /^(1|true|yes)$/i.test(io.env.LIFE_DEBUG ?? "");
  }

  trace = (line: string): void => {
    if (this.#verbose) this.#io.stderr.write(`life: ${line}\n`);
  };

  async run(): Promise<number> {
    const parsed = parseArgv(this.#argv);
    if (parsed.kind === "version") {
      this.#command = "version";
      const found = version();
      // Help and the version are documentation: text unless --json is asked for explicitly.
      if (this.#explicitJson) return this.emit({ ok: true, command: "version", exitCode: EXIT.ok, result: { name: "@life-os/tools", version: found } });
      this.#io.stdout.write(`life ${found}\n`);
      return EXIT.ok;
    }
    if (parsed.kind === "help") {
      this.#command = ["help", layerName(parsed.layer)].filter(Boolean).join(" ");
      if (this.#explicitJson) return this.emit({ ok: true, command: this.#command, exitCode: EXIT.ok, result: helpData(parsed.layer) });
      this.#io.stdout.write(`${helpText(parsed.layer)}\n`);
      return EXIT.ok;
    }

    const { command, args, flags } = parsed;
    this.#command = commandName(command);
    this.#commandDef = command;
    this.#args = args;
    this.#layer = { kind: "command", command };
    const io = this.#io;

    const [tz, tzSource] = this.timezone(flags);
    const clock: Clock = { now: io.clock ? io.clock.now : () => new Date(), timezone: tz };
    const [actor, actorSource] = this.actor(flags);
    const ctx = (): Ctx => {
      if (actor === undefined) {
        throw new UsageError("--actor is required when stdin is not a terminal (or set LIFE_ACTOR)", {
          layer: { kind: "command", command },
          hint: "pass --actor codex (or agent:<name>, neel, import:<provider>) or set LIFE_ACTOR",
        });
      }
      return contextOf(actor, flags);
    };
    // Resolve the actor before touching the database, so a missing one is a plain usage error.
    if (command.mutates) ctx();

    const db = databaseSource(flags, io);
    this.#db = db;
    const setup: Setup = { args, flags, ctx, today: todayIn(tz, clock.now()), tz, tzSource, actor, actorSource, json: this.#json, verbose: this.#verbose, io, db, trace: this.trace, warnings: this.#warnings };
    this.trace(`command: life ${this.#command}${args.length ? ` ${args.map((a) => JSON.stringify(a)).join(" ")}` : ""}`);
    this.trace(`timezone: ${tz} (${tzSource}); today: ${setup.today}; actor: ${actor ?? "none"} (${actorSource})`);

    const restore = this.#json ? muteStdoutLogging(io) : () => undefined;
    try {
      if (command.database === "none") return await this.emitRendered(await command.run(setup));

      if (!db.url) {
        throw new CliFailure(
          "db_unavailable",
          EXIT.database,
          `LIFE_DATABASE_URL is not set (checked --db, the environment, and ${db.envFileExists ? db.envFile : `${db.envFile}, which does not exist`})`,
          `set LIFE_DATABASE_URL in the environment or in ${db.envFile}, or pass --db <url>; run \`life doctor\``,
        );
      }
      this.trace(`database: ${describeUrl(db.url)} (from ${db.source})${command.database === "migrate" ? "; migrating" : ""}`);
      const tools = await Tools.open({ url: db.url, clock, migrate: command.database === "migrate" });
      try {
        const inv: Invocation = { ...setup, tools };
        if (this.#verbose) await traceRefs(inv, command);
        let result = await command.run(inv);

        // HANDS D54: a `needs` rejection is a question on a terminal, and a rejection naming the flag otherwise.
        const interactive = Boolean(io.stdin.isTTY && io.stdout.isTTY) && !this.#json;
        if (result.needs && interactive && command.flags[result.needs.field]?.kind === "value") {
          const answer = await ask(io, result.needs);
          if (answer !== null) {
            flags.set(result.needs.field, "value", answer);
            result = await command.run(inv);
          }
        }
        return await this.emitRendered(result);
      } finally {
        await tools.close();
      }
    } finally {
      restore();
    }
  }

  /** Report a thrown error: classify it, print the envelope or the message, and give the exit code. */
  fail(error: unknown): number {
    const io = this.#io;
    let code: ErrorCode;
    let exitCode: number;
    let message: string;
    let hint: string | undefined;
    let layer: Layer | null = null;

    if (error instanceof UsageError) {
      code = "usage";
      exitCode = EXIT.usage;
      message = error.message;
      layer = error.layer ?? this.#layer;
      hint = error.hint ?? `run \`life ${[layerName(layer), "--help"].filter(Boolean).join(" ")}\``;
    } else if (error instanceof CliFailure) {
      code = error.code;
      exitCode = error.exitCode;
      message = error.message;
      hint = error.hint;
    } else if (isDatabaseError(error)) {
      code = "db_unavailable";
      exitCode = EXIT.database;
      message = `database unavailable: ${messageOf(error)}`;
      const db = this.#db;
      hint = db?.url
        ? `read LIFE_DATABASE_URL from ${db.source}; tried ${describeUrl(db.url)}; run \`life doctor\``
        : `LIFE_DATABASE_URL is not set; set it in the environment or in ${ENV_FILE}, or pass --db <url>; run \`life doctor\``;
    } else if (isInternalError(error)) {
      code = "internal";
      exitCode = EXIT.rejected;
      message = `internal error: ${messageOf(error)}`;
      hint = "this is a bug in life, not in the request; run again with --verbose (or LIFE_DEBUG=1) and report the stack trace";
    } else {
      const text = messageOf(error);
      code = isNotFound([text], this.#args) ? "not_found" : "rejected";
      exitCode = EXIT.rejected;
      message = text;
      const hints = hintsFor(this.#commandDef, [text]);
      hint = hints.length ? hints.join("; ") : undefined;
    }

    if (this.#verbose) {
      if (error instanceof Error && error.stack) io.stderr.write(`${error.stack}\n`);
      for (const line of sqlDetails(error)) io.stderr.write(`life: sql: ${line}\n`);
      const cause = (error as { cause?: unknown })?.cause;
      if (cause instanceof Error && cause.stack) io.stderr.write(`caused by: ${cause.stack}\n`);
    }

    const envelope: Envelope = {
      ok: false,
      command: this.#command || (layer ? layerName(layer) : ""),
      exitCode,
      error: { code, message, issues: [message], ...(hint ? { hint } : {}) },
      ...(this.#warnings.length ? { warnings: this.#warnings } : {}),
    };
    if (this.#json) io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    io.stderr.write(`life: ${message}\n`);
    if (hint) io.stderr.write(`  hint: ${hint}\n`);
    if (layer) io.stderr.write(`\n${helpText(layer)}\n`);
    return exitCode;
  }

  /** Print a rendered result as the envelope or as text. */
  async emitRendered(result: Rendered): Promise<number> {
    const envelope: Envelope = {
      ok: result.code === EXIT.ok,
      command: this.#command,
      exitCode: result.code,
      ...(result.result !== undefined && result.result !== null ? { result: result.result } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(this.#warnings.length ? { warnings: this.#warnings } : {}),
    };
    if (this.#json) {
      this.#io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      if (result.error) {
        this.#io.stderr.write(`life: ${result.error.message}\n`);
        if (result.error.hint) this.#io.stderr.write(`  hint: ${result.error.hint}\n`);
      }
    } else {
      this.#io.stdout.write(`${await result.text()}\n`);
      for (const warning of this.#warnings) this.#io.stderr.write(`life: warning: ${warning}\n`);
    }
    return result.code;
  }

  emit(envelope: Envelope): number {
    this.#io.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return envelope.exitCode;
  }

  timezone(flags: Flags): [string, string] {
    const fromFlag = flags.str("tz");
    if (fromFlag !== undefined) {
      if (!isValidTimezone(fromFlag)) throw new UsageError(`--tz: unknown timezone "${fromFlag}"`, { layer: this.#layer, hint: "pass an IANA zone such as America/Los_Angeles or Asia/Tokyo" });
      return [fromFlag, "--tz"];
    }
    const machine = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const fromEnv = this.#io.env.LIFE_TZ;
    if (fromEnv) {
      if (isValidTimezone(fromEnv)) return [fromEnv, "LIFE_TZ"];
      this.#warnings.push(`LIFE_TZ="${fromEnv}" is not an IANA timezone; using the machine's ${machine}`);
    }
    return [machine, "the machine's timezone"];
  }

  /** `--actor`, else LIFE_ACTOR, else `neel` only on an interactive terminal. */
  actor(flags: Flags): [string | undefined, string] {
    const fromFlag = flags.str("actor");
    if (fromFlag !== undefined) return [fromFlag, "--actor"];
    const fromEnv = this.#io.env.LIFE_ACTOR;
    if (fromEnv) return [fromEnv, "LIFE_ACTOR"];
    return this.#io.stdin.isTTY ? ["neel", "terminal default"] : [undefined, "none: pass --actor or set LIFE_ACTOR"];
  }
}

function contextOf(actor: string, flags: Flags): Ctx {
  const evidence = flags.list("evidence");
  return compact({
    actor,
    reason: flags.str("reason"),
    evidence: evidence.length ? evidence : undefined,
    key: flags.str("key"),
    ifVersion: flags.int("if-version"),
  }) as Ctx;
}

/** With --verbose: how every project, section, label, and filter reference resolved, before the command runs. */
async function traceRefs(inv: Invocation, command: CommandDef): Promise<void> {
  const refs: { kind: NonNullable<FlagDef["ref"]>; source: string; value: string }[] = [];
  command.positionals.forEach((p, i) => {
    if (p.ref && inv.args[i] !== undefined) refs.push({ kind: p.ref, source: `<${p.name}>`, value: inv.args[i]! });
  });
  for (const [name, def] of Object.entries(command.flags)) {
    if (!def.ref) continue;
    for (const value of def.kind === "list" ? inv.flags.list(name) : [inv.flags.str(name)]) if (value !== undefined) refs.push({ kind: def.ref, source: `--${name}`, value });
  }
  if (command === filterRun && inv.args[0] !== undefined) refs.push({ kind: "filter", source: "<ref|query>", value: inv.args[0] });
  if (!refs.length) return;
  const projectRef = refs.find((r) => r.kind === "project")?.value ?? "inbox";
  try {
    const index = await projectIndex(inv.tools);
    for (const ref of refs) {
      let resolved = "nothing";
      if (ref.kind === "project") {
        const project = await inv.tools.project.get(ref.value);
        if (project) resolved = `${project.id} (${projectPath(project, index)}${project.deletedAt ? ", deleted" : ""})`;
      } else if (ref.kind === "section") {
        if (/^s_[a-z0-9]{10}$/.test(ref.value)) {
          const section = await inv.tools.section.get(ref.value);
          if (section) resolved = `${section.id} ("${section.name}" in ${index.get(section.projectId) ? projectPath(index.get(section.projectId)!, index) : section.projectId})`;
        } else {
          const sections = await inv.tools.section.list(projectRef).catch(() => []);
          const section = sections.find((s) => s.name === ref.value) ?? sections.find((s) => s.name.toLowerCase() === ref.value.toLowerCase());
          if (section) resolved = `${section.id} (in project ${projectRef})`;
        }
      } else if (ref.kind === "label") {
        const label = await inv.tools.label.get(ref.value);
        if (label) resolved = `${label.id} (@${label.name})`;
        else resolved = "nothing (a label named on a task or project is created on first use)";
      } else {
        const filter = await inv.tools.filter.get(ref.value);
        if (filter) resolved = `${filter.id} (${filter.name}: ${filter.query})`;
        else resolved = "no saved filter; parsed as a query";
      }
      inv.trace(`resolved ${ref.kind} ${ref.source} "${ref.value}" -> ${resolved}`);
    }
  } catch (error) {
    inv.trace(`resolving refs failed: ${messageOf(error)}`);
  }
}

/** Put the question to the terminal; null when the answer is not one of the options or the input ends first. */
async function ask(io: CliIo, needs: Needs): Promise<string | null> {
  const rl = createInterface({ input: io.stdin, terminal: false });
  try {
    io.stdout.write(`${needs.message}\n${needs.field} [${needs.options.join("/")}]: `);
    // The first line wins; an input that ends without one (Ctrl-D) is no answer.
    const answer = await new Promise<string | null>((resolve) => {
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(null));
    });
    if (answer === null) {
      io.stdout.write("\n");
      return null;
    }
    const chosen = answer.trim().toLowerCase();
    return needs.options.includes(chosen) ? chosen : null;
  } finally {
    rl.close();
  }
}

// ------------------------------------------------------------------ human output

type Projects = Map<string, Project>;

async function projectIndex(tools: Tools): Promise<Projects> {
  return indexProjects(await tools.store.read((tx) => tx.all("project", { includeDeleted: true })));
}

/** Rows into aligned columns, two spaces apart; columns empty in every row are dropped. */
function table(rows: string[][], indent = ""): string {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const keep = Array.from({ length: width }, (_, i) => rows.some((row) => (row[i] ?? "") !== ""));
  const widths = Array.from({ length: width }, (_, i) => Math.max(...rows.map((row) => (row[i] ?? "").length)));
  return rows
    .map((row) => {
      const cells: string[] = [];
      for (let i = 0; i < width; i++) if (keep[i]) cells.push((row[i] ?? "").padEnd(widths[i]!));
      return `${indent}${cells.join("  ")}`.trimEnd();
    })
    .join("\n");
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const dueText = (due: Due | null): string => (due ? `${due.date}${due.time ? ` ${due.time}` : ""}` : "");
const labelText = (labels: string[]): string => labels.map((label) => `@${label}`).join(" ");

function taskRow(task: Task, index: Projects, extra: string[] = []): string[] {
  const project = index.get(task.projectId);
  return [
    task.id,
    task.status,
    task.priority ? `p${task.priority}` : "",
    clip(oneLine(task.title), 60),
    dueText(task.due),
    task.deadline ? `by ${task.deadline}` : "",
    task.repeat ?? "",
    project ? projectPath(project, index) : task.projectId,
    labelText(effectiveLabels(task, index)),
    ...extra,
  ];
}

function taskTable(tasks: Task[], index: Projects, indent = ""): string {
  return table(
    tasks.map((task) => taskRow(task, index, [task.deletedAt ? `deleted ${task.deletedAt}` : ""])),
    indent,
  );
}

function describe(record: AnyRecord): string {
  if ("title" in record) return record.title;
  if ("query" in record) return `${record.name}  ${record.query}`;
  if ("slug" in record) return `${record.name} (${record.slug})`;
  return record.name;
}

function receiptText(receipt: Receipt<AnyRecord>, index: Projects, hint?: string): string {
  if (receipt.ok) return `${receipt.outcome} ${receipt.id} v${receipt.version}  ${describe(receipt.record)}`;
  if (receipt.outcome === "duplicate") {
    const n = receipt.candidates.length;
    return [
      `duplicate: ${n} similar open task${n === 1 ? "" : "s"}`,
      taskTable(receipt.candidates as Task[], index, "  "),
      "  pass --allow-duplicate to add anyway, or reuse one of them",
    ].join("\n");
  }
  const lines = [`rejected${receipt.id ? ` ${receipt.id}` : ""}`, ...receipt.issues.map((issue) => `  - ${issue}`)];
  if (receipt.needs) lines.push(`  pass --${receipt.needs.field} ${receipt.needs.options.join("|")}`);
  else if (hint) lines.push(`  ${hint}`);
  return lines.join("\n");
}

async function taskDetail(task: Task, index: Projects, tools: Tools): Promise<string> {
  const project = index.get(task.projectId);
  const section = task.sectionId ? await tools.section.get(task.sectionId) : null;
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(11)}${value}`] : []);
  const lines = [
    `${task.id}  ${task.status}  ${task.title}`,
    ...field("project", project ? `${projectPath(project, index)} (${project.id})` : task.projectId),
    ...field("section", section ? `${section.name} (${section.id})` : task.sectionId),
    ...field("parent", task.parentId),
    ...field("due", task.due ? `${dueText(task.due)}${task.due.timezone ? ` ${task.due.timezone}` : ""}` : null),
    ...field("deadline", task.deadline),
    ...field("repeat", task.repeat),
    ...field("duration", task.duration ? `${task.duration} min` : null),
    ...field("priority", task.priority ? `p${task.priority}` : null),
    ...field("labels", labelText(effectiveLabels(task, index))),
    ...field("executor", task.executor),
    ...field("bucket", task.bucket),
    ...field("origin", `${task.origin.actor} at ${task.origin.at}${task.origin.reason ? `: ${task.origin.reason}` : ""}`),
    ...field("evidence", task.origin.evidence.join(", ")),
    ...field("created", task.createdAt),
    ...field("updated", `${task.updatedAt} (v${task.version})`),
    ...field("completed", task.completedAt),
    ...field("deleted", task.deletedAt),
  ];
  if (task.notes.trim()) lines.push("notes", ...task.notes.trimEnd().split("\n").map((line) => `  ${line}`));
  if (task.comments.length) {
    lines.push("comments");
    for (const comment of task.comments) {
      lines.push(`  ${comment.at}  ${comment.actor}: ${comment.text}`);
      for (const attachment of comment.attachments) lines.push(`      ${attachment.name}: ${attachment.url}`);
    }
  }
  if (task.occurrences.length) lines.push(`occurrences ${task.occurrences.map((o) => `${o.date} (${o.actor})`).join(", ")}`);
  return lines.join("\n");
}

function projectDetail(project: Project, index: Projects): string {
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(11)}${value}`] : []);
  return [
    `${project.id}  ${project.name}`,
    ...field("path", projectPath(project, index)),
    ...field("parent", project.parentId),
    ...field("layout", project.layout),
    ...field("color", project.color),
    ...field("labels", labelText(project.labels)),
    ...field("archived", project.archived ? "yes" : null),
    ...field("system", project.system ? "yes (Inbox)" : null),
    ...field("created", `${project.createdAt} by ${project.origin.actor}`),
    ...field("updated", `${project.updatedAt} (v${project.version})`),
    ...field("deleted", project.deletedAt),
  ].join("\n");
}

function treeText(tree: ProjectNode[]): string {
  const rows: string[][] = [];
  const visit = (nodes: ProjectNode[], depth: number) => {
    for (const node of nodes) {
      const p = node.project;
      rows.push([`${"  ".repeat(depth)}${p.name}`, p.slug, p.id, p.archived ? "archived" : "", labelText(p.labels)]);
      for (const section of node.sections) rows.push([`${"  ".repeat(depth + 1)}- ${section.name}`, "", section.id, section.archived ? "archived" : "", ""]);
      visit(node.children, depth + 1);
    }
  };
  visit(tree, 0);
  return rows.length ? table(rows) : "No projects.";
}

const sectionTable = (sections: Section[]): string => table(sections.map((s) => [s.id, s.name, s.archived ? "archived" : "", s.deletedAt ? `deleted ${s.deletedAt}` : ""]));
const labelTable = (labels: Label[]): string => table(labels.map((l) => [l.id, `@${l.name}`, l.color ?? "", l.deletedAt ? `deleted ${l.deletedAt}` : ""]));
const filterTable = (filters: Filter[]): string => table(filters.map((f) => [f.id, f.name, f.query, f.deletedAt ? `deleted ${f.deletedAt}` : ""]));

function patchText(patch: LogEntry["patch"]): string {
  const show = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "null" : JSON.stringify(value));
  const changes = Object.entries(patch);
  // A creation diffs every field from null; name the record instead of listing them all.
  if (changes.length && changes.every(([, change]) => change.from === null)) {
    const named = patch.title ?? patch.name;
    return `created${named ? `: ${show(named.to)}` : ""}`;
  }
  return changes.map(([key, change]) => `${key}: ${clip(show(change.from), 40)} -> ${clip(show(change.to), 40)}`).join("; ");
}

function historyText(entries: LogEntry[]): string {
  if (!entries.length) return "No history.";
  return table(entries.map((e) => [`#${e.seq}`, e.at, e.actor, e.op, clip(patchText(e.patch), 120), e.reason ? `(${e.reason})` : ""]));
}

function importText(result: ImportResult): string {
  const head = `${result.dryRun ? "Dry run: " : ""}${result.created} created, ${result.duplicate} duplicate, ${result.rejected} rejected of ${result.items.length}.`;
  const rows = result.items.map((item) => [`#${item.index}`, item.outcome, item.id ?? "", item.issues.join("; ")]);
  return rows.length ? `${head}\n${table(rows, "  ")}` : head;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (date: string): string => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

function section(title: string, tasks: Task[], index: Projects): string[] {
  if (!tasks.length) return [];
  return [`${title} (${tasks.length})`, taskTable(tasks, index, "  "), ""];
}

function todayText(view: TodayView, index: Projects): string {
  const lines = [
    `Today ${view.date} ${weekday(view.date)} (${view.timezone})`,
    "",
    ...section("Overdue", view.overdue, index),
    ...section("Due today", view.due, index),
    ...section("Deadlines", view.deadlines, index),
    ...section("Proposed", view.proposed, index),
  ];
  if (lines.length === 2) lines.push("Nothing due, no deadlines, nothing proposed.");
  return lines.join("\n").trimEnd();
}

function upcomingText(view: UpcomingView, index: Projects): string {
  const lines = [`Upcoming ${view.from} to ${view.to}`, ""];
  for (const day of view.days) {
    lines.push(`${day.date} ${weekday(day.date)}${day.tasks.length ? ` (${day.tasks.length})` : ""}`);
    lines.push(day.tasks.length ? taskTable(day.tasks, index, "  ") : "  (nothing)");
  }
  return lines.join("\n");
}

function trashText(view: TrashView, index: Projects): string {
  const lines: string[] = [];
  const deleted = (record: { deletedAt: string | null }) => `deleted ${record.deletedAt ?? ""}`;
  if (view.tasks.length) lines.push(`Tasks (${view.tasks.length})`, taskTable(view.tasks, index, "  "), "");
  if (view.projects.length) lines.push(`Projects (${view.projects.length})`, table(view.projects.map((p) => [p.id, p.name, p.slug, deleted(p)]), "  "), "");
  if (view.sections.length) lines.push(`Sections (${view.sections.length})`, table(view.sections.map((s) => [s.id, s.name, deleted(s)]), "  "), "");
  if (view.labels.length) lines.push(`Labels (${view.labels.length})`, table(view.labels.map((l) => [l.id, `@${l.name}`, deleted(l)]), "  "), "");
  if (view.filters.length) lines.push(`Filters (${view.filters.length})`, table(view.filters.map((f) => [f.id, f.name, f.query, deleted(f)]), "  "), "");
  return lines.length ? lines.join("\n").trimEnd() : "The trash is empty.";
}
