// The `life` CLI: an HTTP client of the Life-OS API for a shell, usable by a
// program. Every command maps onto one library call; the CLI adds argument
// parsing, the actor rule, relative dates, the sub-task, scope, and catalog
// questions on a terminal, human or JSON output, and stable exit codes.
// Nothing here writes a record; the API server performs database and provider
// operations. This process handles arguments, questions, local files and output.
//
// One declarative command table (COMMANDS) drives parsing, validation, and
// help at every layer, so the three cannot drift. The four medium groups
// (movie, show, game, book) are generated from one table with the flags that
// do not apply to a medium left out. An agent's contract is the JSON envelope:
// with --json, or whenever stdout is not a terminal, stdout carries exactly one
// JSON object and everything else goes to stderr.
//
//   life <group> <command> [args] [flags]
//   exit codes: 0 ok, 1 rejected or invalid, 2 duplicate candidates,
//               3 database, provider, or catalog unavailable, 64 usage

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { AccountAddReceipt } from "./calendar/accounts.ts";
import { PROVIDER_REJECTED, PROVIDER_UNAVAILABLE, SCOPES, type EventReceipt, type EventResponse, type Scope } from "./calendar/events.ts";
import { isOccurrenceRef, type Occurrence } from "./calendar/expand.ts";
import { maxAgeFromEnv, type Day, type Freshness, type ScheduleEntry, type SlotsView, type WeekView } from "./calendar/schedule.ts";
import {
  RATINGS,
  isTimedWhen,
  type Account,
  type AnyRecord,
  type Availability,
  type Calendar,
  type CalendarRecord,
  type CalendarUpdate,
  type Ctx,
  type Due,
  type Entry,
  type EntryInput,
  type EntryPatch,
  type Event,
  type EventAdd,
  type EventUpdate,
  type Filter,
  type FilterUpdate,
  type Label,
  type LabelAdd,
  type LabelUpdate,
  type LogEntry,
  type Medium,
  type Needs,
  type On,
  type Project,
  type ProjectAdd,
  type ProjectUpdate,
  type Rating,
  type Receipt,
  type Section,
  type Task,
  type TaskAdd,
  type TaskList,
  type TaskMove,
  type TaskUpdate,
  type Title,
  type TitleAdd,
  type TitleList,
  type TitleSummary,
  type TitleUpdate,
  type When,
} from "./contract.ts";
import type { Clock } from "./core.ts";
import { SOURCE_BY_MEDIUM, type Candidate } from "./media/catalog/adapter.ts";
import { SOURCE_NAMES } from "./media/catalog/links.ts";
import { lastEntry, orderEntries } from "./media/derive.ts";
import { ON_FORMS, parseOn } from "./media/on.ts";
import { CATALOG_UNAVAILABLE, type AvailabilityReport, type CandidateKind, type NextInSeries, type NextView, type SearchCandidate, type SeriesView, type TitleOps, type TitleReceipt } from "./media/titles.ts";
import type { BuyItem, DiaryView, ShelfView, TimeView, ViewTitle, YearView } from "./media/views.ts";
import { effectiveLabels, indexProjects, projectPath, type ProjectContents, type ProjectNode, type SectionTasks } from "./organize.ts";
import type { CompleteOptions, DeleteOptions, ImportResult, TaskAssign } from "./tasks.ts";
import { addDays, isValidDate, isValidTimezone, localDate, localTime, localWall, parseInstant, relativeDate, toInstant, todayIn, zonedToInstant } from "./time.ts";
import type { SyncReport } from "./calendar/sync.ts";
import { createClient, ApiError, type ToolsClient } from "./api/client.ts";
import { clientConfig } from "./api/config.ts";
import type { DoctorReport } from "./api/diagnostics.ts";
import { messageOf, isInternalError } from "./api/errors.ts";
export { describeUrl } from "./api/errors.ts";
import type { TodayView, TrashView, UpcomingView } from "./views.ts";

// ------------------------------------------------------------------ public surface

/** Exit codes. `provider` and `catalog` share 3 with `database`: in every case the thing behind the command could not be reached and nothing was done. */
export const EXIT = { ok: 0, rejected: 1, duplicate: 2, database: 3, provider: 3, catalog: 3, usage: 64 } as const;

/** The error codes an envelope can carry; each maps onto one exit code. */
export type ErrorCode = "api_unavailable" | "unauthorized" | "usage" | "rejected" | "duplicate" | "needs" | "not_found" | "db_unavailable" | "provider_unavailable" | "provider_rejected" | "catalog_unavailable" | "internal";

/** What a `duplicate` or `needs` error's `candidates` hold: tasks, library titles, or catalog hits (LEISURE D94). */
export type EnvelopeCandidateKind = "task" | CandidateKind;

export type EnvelopeError = {
  code: ErrorCode;
  message: string;
  issues: string[];
  hint?: string;
  needs?: Needs;
  candidates?: Task[] | Title[] | Candidate[];
  candidateKind?: EnvelopeCandidateKind;
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
  /** Opens the consent URL received from the API. */
  openUrl?: (url: string) => void;

};

/** Backend configuration location named in help; the CLI never loads it. */
export const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
/** Mirrors db/migrate.ts: the journal of the migrations `life migrate` applies. */
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
  ref?: RefKind;
  /** A value flag whose value may be left out (`--seen-before` alone): the next token is its value only when `accepts` says so; without one the flag reads as a bare `true`. */
  accepts?: (next: string) => boolean;
};
type FlagSpec = Readonly<Record<string, FlagDef>>;

type RefKind = "project" | "section" | "label" | "filter" | "account" | "calendar" | "event" | "title";

type Positional = {
  name: string;
  help: string;
  optional?: boolean;
  /** Takes every remaining argument. */
  variadic?: boolean;
  ref?: RefKind;
};

type GroupName = "task" | "project" | "section" | "label" | "filter" | "account" | "calendar" | "event" | Medium | "media";

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
  /** With a catalog `needs`: the candidates the question lists as a numbered table. */
  candidates?: Candidate[];
  /** Diagnostics for a terminal (copy freshness, view warnings): stderr in human mode, never printed in JSON mode. */
  stderr?: string[];
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
  region: string;
  /** A diagnostic line on stderr, only with --verbose or LIFE_DEBUG=1. */
  trace: (line: string) => void;
  warnings: string[];
};
type Invocation = Setup & { tools: ToolsClient };

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
  [EXIT.database]: "database, calendar provider, or catalog unavailable (run `life doctor`)",
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
  "api-url": { kind: "value", type: "url", help: "Life-OS API URL. Else LIFE_API_URL, default http://127.0.0.1:4319. Set LIFE_API_TOKEN for authentication." },
  verbose: { kind: "bool", help: "Client stack traces, API errors, and resolved refs on stderr. Or LIFE_DEBUG=1." },
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
  titleId: { name: "id", help: "A title id (m_ followed by ten characters); a deleted title is only found by id. See `life trash`." },
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

const NOT_FOUND = /^(?:[\w.]+): no (task|project|section|label|filter|account|calendar|event|title|movie|show|game|book) "(.+?)"(?:;.*)?$/;

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
  const group = command?.group && isMedium(command.group) ? command.group : "<medium>";
  for (const issue of issues) {
    if (/neither a saved filter nor a valid query|Unknown filter term|filter: (Unclosed|Unexpected|Missing closing|Empty filter|Invalid filter|\w+: expected today)|query: /.test(issue)) add(filterHint(issue));
    else if (/^(?:title|ref|into|to|\w+): no (?:title|movie|show|game|book) "/.test(issue))
      add(`a ref is a title id (m_...) or a name; run \`life ${group} list --text "<part of the name>"\` to find it (deleted titles are in \`life trash\`; another medium's titles are under its own group)`);
    else if (/^(?:ref|into|to): ".*" names \d+ /.test(issue)) add("several titles match the name; pass the id (m_...) of the one meant, listed in error.candidates");
    else if (issue.startsWith(`${CATALOG_UNAVAILABLE}:`)) add("the catalog source could not be reached and nothing was stored; retry later (with the same --key for a write), or run `life doctor`");
    else if (/^catalog: .*is not set in the root \.env/.test(issue)) add(`put the key in ${ENV_FILE}; \`add --no-lookup\` creates the title without a catalog and \`refresh\` links it once the key exists`);
    else if (/^catalog: .*already linked to/.test(issue)) add("the work is in the library already; use that title, or `merge` the two");
    else if (/^catalog: \d+ .* candidates for/.test(issue)) add(command?.flags.catalog ? "pass --catalog <id> with one of the ids in error.candidates, or --year to narrow the search" : `run \`life ${group} link <ref> <id>\` with one of the ids in error.candidates`);
    else if (/^catalog: /.test(issue)) add(`pass --catalog <id> from \`life ${group} lookup "<name>"\`, or --no-lookup to create the title without a catalog`);
    else if (/^entry: no entry "/.test(issue)) add(`entry ids (n_...) are listed by \`life ${group} get <ref>\` and \`life ${group} history <ref>\``);
    else if (/^(?:rating|review): nothing to/.test(issue)) add("finish or drop the title first (`finish --rating 4.5`), or name a closing entry with --entry n_...");
    else if (/^\w+: title is \w+; /.test(issue)) add(`the hint after the semicolon names the command that fits; \`life ${group} get <ref>\` shows the status and the diary`);
    else if (/^return: ownership is none/.test(issue)) add("nothing is owned, borrowed, or on a service for this title; record `buy`, `borrow`, or `service` first");
    else if (/no project "|project ".*" is deleted|no section "|section ".*" is deleted|pass project to look up section/.test(issue))
      add("run `life project tree` to see project paths, project ids, and section ids (deleted ones are in `life trash`)");
    else if (/no label "/.test(issue)) add("run `life label list` to see label names and ids");
    else if (/no filter "/.test(issue)) add("run `life filter list` to see saved filters, or pass a query (see `life help filter`)");
    else if (/no task "/.test(issue)) add("check the id with `life task list --all` or `life search <text>`; deleted tasks are in `life trash`");
    else if (/no account "|account ".*" was removed/.test(issue)) add("run `life account list` to see connected accounts (an id, the identity email, or the label is a ref); `life account add google` connects one");
    else if (/no calendar "|names \d+ calendars|calendar ".*" is deleted|no main calendar yet|no account is connected/.test(issue)) add("run `life calendar list --hidden` to see calendar ids and names; a ref is an id, <identity>/<name>, or a unique name");
    else if (/no event "|no occurrence of "/.test(issue)) add("run `life event list --from <date> --to <date>` to see event ids and occurrence refs (e_...@<originalStart>); deleted events are in `life trash`");
    else if (issue.startsWith(`${PROVIDER_UNAVAILABLE}:`)) add("the calendar provider could not be reached and nothing was stored; retry (with the same --key for a write), or run `life doctor`");
    else if (issue.startsWith(`${PROVIDER_REJECTED}:`)) add("the calendar provider refused the request and nothing was stored; the message is the provider's");
    else if (/needs re-authorization|needs to be granted again|no longer accepts the refresh token|No Google credential on file|is needs_reauth|run life account add google/.test(issue)) add("run `life account add google` and pick the same Google account to sign in again");
    else if (/is read-only; pick a writable calendar/.test(issue)) add("run `life calendar list` (read-only calendars are marked) and pass --calendar <ref>");
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

/** A provider or catalog failure among a rejected receipt's issues: unreachable (exit 3) or refused (exit 1). */
function providerCode(issues: string[]): "provider_unavailable" | "provider_rejected" | "catalog_unavailable" | null {
  if (issues.some((issue) => issue.startsWith(`${PROVIDER_UNAVAILABLE}:`))) return "provider_unavailable";
  if (issues.some((issue) => issue.startsWith(`${CATALOG_UNAVAILABLE}:`))) return "catalog_unavailable";
  if (issues.some((issue) => issue.startsWith(`${PROVIDER_REJECTED}:`))) return "provider_rejected";
  return null;
}

const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["provider_unavailable", "catalog_unavailable"]);

const receiptCode = (receipt: Receipt<unknown>): number =>
  receipt.ok ? EXIT.ok : receipt.outcome === "duplicate" ? EXIT.duplicate : UNAVAILABLE_CODES.has(providerCode(receipt.issues) ?? "") ? EXIT.provider : EXIT.rejected;

/** What a title receipt adds to the receipt shape (titles.ts `TitleReceipt`); every other receipt leaves these unset. */
type ReceiptExtras = { warnings?: string[]; candidateKind?: CandidateKind; next?: NextInSeries; removed?: Entry };
type AnyReceipt = (Receipt<AnyRecord | CalendarRecord | Title> | TitleReceipt) & ReceiptExtras;

/** The candidates a failed receipt carries: tasks or titles on a duplicate, titles on a `needs` on ref, catalog hits on a `needs` on catalog. */
const candidatesOf = (receipt: AnyReceipt): (Task | Title | Candidate)[] => ((receipt as { candidates?: (Task | Title | Candidate)[] }).candidates ?? []);

/** The `candidateKind` of a failed receipt: the receipt's own, else `task`, the only kind before the library. */
const candidateKindOf = (receipt: AnyReceipt): EnvelopeCandidateKind => receipt.candidateKind ?? "task";

const isTitle = (record: object): record is Title => "medium" in record && "entries" in record;
const isCandidate = (record: object): record is Candidate => "externalId" in record && "inLibrary" in record;

/** One candidate named for a hint: `t_x "Title"`, `m_x "Name" (2018, backlog)`, or `438631 "Dune" (2021)`. */
function candidateLabel(candidate: Task | Title | Candidate): string {
  if (isCandidate(candidate)) return `${candidate.externalId} "${candidate.name}"${candidate.year ? ` (${candidate.year})` : ""}${candidate.inLibrary ? ` [in the library as ${candidate.inLibrary}]` : ""}`;
  if (isTitle(candidate)) return `${candidate.id} "${candidate.name}" (${[candidate.year, candidate.status].filter((v) => v !== null).join(", ")})`;
  return `${candidate.id} "${candidate.title}"`;
}

/** The hint for a `needs` rejection: the exact flag and values to pass, or for a catalog or ref question the ids to choose among. */
function needsHint(command: CommandDef, needs: Needs, candidates: (Task | Title | Candidate)[]): string {
  const listed = candidates.length ? candidates.map(candidateLabel).join(", ") : needs.options.join(", ");
  if (needs.field === "catalog") {
    const narrow = /year differs|several exact matches/.test(needs.message) ? "; or --year <n> to narrow the search" : "";
    if (command.flags.catalog) return `pass --catalog <id> with one of: ${listed}${narrow}`;
    return `run \`life ${command.group ?? "<medium>"} link <ref> <id>\` with one of: ${listed}`;
  }
  if (needs.field === "ref") return `pass the title's id as the ref, one of: ${listed}`;
  return `pass --${needs.field} ${needs.options.join("|")}`;
}

/** The envelope error for a failed receipt. */
function receiptError(command: CommandDef, receipt: AnyReceipt, args: string[]): EnvelopeError | undefined {
  if (receipt.ok) return undefined;
  const kind = candidateKindOf(receipt);
  if (receipt.outcome === "duplicate") {
    const candidates = candidatesOf(receipt);
    const listed = candidates.map(candidateLabel).join(", ");
    return {
      code: "duplicate",
      message: receipt.issues[0] ?? (kind === "title" ? "A title with this name exists" : "Similar open tasks exist"),
      issues: receipt.issues,
      hint: `pass --allow-duplicate to add anyway, or reuse a candidate: ${listed}`,
      candidates: candidates as Task[] | Title[] | Candidate[],
      candidateKind: kind,
    };
  }
  if (receipt.needs) {
    const candidates = candidatesOf(receipt);
    return {
      code: "needs",
      message: receipt.needs.message,
      issues: receipt.issues,
      hint: needsHint(command, receipt.needs, candidates),
      needs: receipt.needs,
      ...(candidates.length ? { candidates: candidates as Task[] | Title[] | Candidate[], candidateKind: kind } : {}),
    };
  }
  const hints = hintsFor(command, receipt.issues);
  return {
    code: providerCode(receipt.issues) ?? (isNotFound(receipt.issues, args) ? "not_found" : "rejected"),
    message: receipt.issues.length === 1 ? receipt.issues[0]! : `${receipt.issues.length} issues: ${receipt.issues.join("; ")}`,
    issues: receipt.issues,
    ...(hints.length ? { hint: hints.join("; ") } : {}),
  };
}

/**
 * One receipt: exit code from the outcome, the receipt as the result, one line
 * plus issues as text. A receipt's own `warnings` (an event split, a first
 * sync, a lookup that failed) join the envelope's; a title receipt's are lifted
 * there and nowhere else, so `result` carries it without them.
 */
function rendered(inv: Invocation, command: CommandDef, receipt: AnyReceipt): Rendered {
  const error = receiptError(command, receipt, inv.args);
  if (receipt.warnings) for (const warning of receipt.warnings) if (!inv.warnings.includes(warning)) inv.warnings.push(warning);
  const { warnings: _lifted, ...result } = receipt;
  const isTitleReceipt = receipt.candidateKind !== undefined || (receipt.ok && isTitle(receipt.record)) || (!receipt.ok && receipt.outcome === "rejected" && receipt.record !== undefined && isTitle(receipt.record));
  const needs = !receipt.ok && receipt.outcome === "rejected" ? receipt.needs : undefined;
  return {
    code: receiptCode(receipt),
    result: isTitleReceipt ? result : receipt,
    text: async () => receiptText(receipt, await projectIndex(inv.tools), inv.tz, error?.hint),
    ...(error ? { error } : {}),
    ...(needs ? { needs } : {}),
    ...(needs?.field === "catalog" && receipt.candidateKind === "catalog" ? { candidates: candidatesOf(receipt) as Candidate[] } : {}),
  };
}

function renderedAll(inv: Invocation, command: CommandDef, receipts: AnyReceipt[]): Rendered {
  const codes = receipts.map(receiptCode);
  const code = codes.includes(EXIT.rejected) ? EXIT.rejected : codes.includes(EXIT.provider) ? EXIT.provider : codes.includes(EXIT.duplicate) ? EXIT.duplicate : EXIT.ok;
  const failed = receipts.filter((r) => !r.ok);
  const issues = [...new Set(failed.flatMap((r) => r.issues))];
  const hints = hintsFor(command, issues);
  const error: EnvelopeError | undefined = failed.length
    ? {
        code: code === EXIT.duplicate ? "duplicate" : (providerCode(issues) ?? "rejected"),
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
      return receipts.map((receipt) => receiptText(receipt, index, inv.tz)).join("\n");
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

// ------------------------------------------------------------------ calendar helpers

const ACCOUNT_REF = "an account id (a_...), the identity email, or the label";
const CALENDAR_REF = "a calendar id (c_...), <identity>/<name>, or a name unique among the calendars";
const EVENT_REF = "an event id (e_...) for a single event or a whole series, or an occurrence ref e_xxxxxxxxxx@<originalStart> for one occurrence of a repeating event";
const WHEN_HELP = '"YYYY-MM-DD HH:MM" (the date may be today, tomorrow, +Nd) read in the display zone (--tz, else LIFE_TZ, else the machine\'s), or an instant such as 2026-09-10T16:00:00Z';

const POS_CAL = {
  accountRef: { name: "ref", help: `An account reference: ${ACCOUNT_REF}. See \`life account list\`.`, ref: "account" as const },
  calendarRef: { name: "ref", help: `A calendar reference: ${CALENDAR_REF}. See \`life calendar list --hidden\`.`, ref: "calendar" as const },
  calendarId: { name: "id", help: "A calendar id (c_...). See `life calendar list --hidden`." },
  eventRef: { name: "ref", help: `An event reference: ${EVENT_REF}. Every list prints occurrence refs.`, ref: "event" as const },
  eventId: { name: "id", help: "An event id (e_ followed by ten characters): a single event or a series, never one occurrence.", ref: "event" as const },
};

const SCOPE_FLAG: FlagDef = { kind: "value", values: [...SCOPES], help: "On a repeating event: this occurrence only, this and every later one, or the whole series. Required for a repeating event (a terminal asks)." };
const CALENDAR_FLAG: FlagDef = { kind: "value", type: "ref", help: `Calendar: ${CALENDAR_REF}.`, ref: "calendar" };
const START_FLAG: FlagDef = { kind: "value", type: "when", help: `Start of a timed event: ${WHEN_HELP}.` };
const END_FLAG: FlagDef = { kind: "value", type: "when", help: "End of a timed event, same format as --start." };
const FLOATING_FLAG: FlagDef = { kind: "bool", help: "With --start: store no timezone; the event happens at that wall-clock time wherever Neel is." };
const DATE_FLAG: FlagDef = { kind: "value", type: DATE_TYPE, help: `Start date of an all-day event: ${DATE_HELP}.` };
const END_DATE_FLAG: FlagDef = { kind: "value", type: DATE_TYPE, help: "End date of an all-day event, exclusive (a two-day event on the 10th and 11th ends on the 12th)." };
const STALE_FLAG: FlagDef = { kind: "bool", help: `Answer from the copy without refreshing calendars older than LIFE_CAL_MAX_AGE seconds (default ${String(maxAgeFromEnv({}))}).` };
const HIDDEN_FLAG: FlagDef = { kind: "bool", help: "Include hidden calendars." };

/** The When formats and the scope rules; printed under `life help event` and on the commands that take them. */
const EVENT_NOTES = [
  "when formats:",
  `  --start, --end        ${WHEN_HELP}. --floating stores no zone. An omitted --end is one hour after --start (or --duration minutes).`,
  "  --date, --end-date    YYYY-MM-DD (or today, tomorrow, +Nd) for an all-day event; the end date is exclusive, so a one-day event has no --end-date (or --days 1).",
  "  refs                  an event id (e_...) names a single event or a whole series; an occurrence ref e_xxxxxxxxxx@2026-09-10T16:00:00Z (the id, @, the occurrence's original start: an instant, or a date for all-day) names one occurrence. Every list prints occurrence refs; copy them into update, reschedule, respond, cancel, delete.",
  "scope rules (repeating events):",
  "  --scope this          this occurrence only (an exception at the provider)",
  "  --scope following     this and every later occurrence: the series is cut before this one and a new series with a new id continues from it (the receipt's record; a warning names the truncated original)",
  "  --scope all           the whole series; a time change given against an occurrence shifts every occurrence by the same delta",
  "  A repeating event with no --scope is rejected with a `needs` error naming the options (a terminal asks). respond takes this or all. move, restore, and duplicate take the series or a single event; delete on one occurrence cancels it.",
  "writes go through the provider first (HANDS D59): an unreachable provider is provider_unavailable (exit 3) and a refusal is provider_rejected (exit 1); nothing is stored either way, and the same --key retries safely.",
];

/**
 * `--start`/`--end`: "<date> HH:MM" in the display zone (the date may be
 * relative), or an instant. With `floating` the wall clock itself is stored,
 * spelled as UTC with no zone (time.ts), so 08:00 stays 08:00 wherever Neel is;
 * an instant given with an offset becomes the wall clock it reads as in the
 * display zone.
 */
function whenFlag(inv: Setup, name: string, floating: boolean): When | undefined {
  const value = inv.flags.str(name);
  if (value === undefined) return undefined;
  const raw = value.trim();
  const wall = /^(\S+)[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(raw);
  if (wall) {
    const date = relativeDate(wall[1]!, inv.today);
    const instant = date ? zonedToInstant(`${date}T${wall[2]}`, floating ? "UTC" : inv.tz) : null;
    if (instant) return { at: toInstant(instant), timezone: floating ? null : inv.tz };
  }
  const instant = parseInstant(raw, inv.tz);
  if (instant && !isValidDate(raw)) {
    if (!floating) return { at: instant, timezone: inv.tz };
    return { at: toInstant(zonedToInstant(localWall(instant, inv.tz), "UTC")!), timezone: null };
  }
  throw new UsageError(`--${name} expects "YYYY-MM-DD HH:MM" (read in ${inv.tz}) or an instant, got "${value}"`, {
    hint: `pass --${name} "2026-09-10 16:00" (or "tomorrow 09:00"); for an all-day event pass --date YYYY-MM-DD instead`,
  });
}

/** `--date`/`--end-date` as an all-day When. */
function dateWhen(inv: Setup, name: string): When | undefined {
  const value = dateFlag(inv, name);
  return value === undefined ? undefined : { date: value };
}

/** The timed or all-day span the event flags describe; `null` when none was given. */
function spanFlags(inv: Setup, command: CommandDef): { start?: When; end?: When; duration?: number } | null {
  const f = inv.flags;
  const timed = f.has("start") || f.has("end") || f.has("duration") || f.bool("floating");
  const allDay = f.has("date") || f.has("end-date") || f.has("days");
  const layer: Layer = { kind: "command", command };
  if (timed && allDay) throw new UsageError(`life ${commandName(command)}: --start/--end/--duration (timed) and --date/--end-date/--days (all-day) exclude each other`, { layer });
  if (!timed && !allDay) return null;
  if (f.has("end") && f.has("duration")) throw new UsageError("--end and --duration exclude each other", { layer });
  if (f.has("end-date") && f.has("days")) throw new UsageError("--end-date and --days exclude each other", { layer });
  if (f.bool("floating") && !f.has("start")) throw new UsageError("--floating needs --start", { layer });
  if (timed) return compact({ start: whenFlag(inv, "start", f.bool("floating")), end: whenFlag(inv, "end", f.bool("floating")), duration: f.int("duration") });
  return compact({ start: dateWhen(inv, "date"), end: dateWhen(inv, "end-date"), duration: f.int("days") });
}

const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** `mon-fri`, `mon,wed,fri`, `sat-sun` (a range may wrap) as JavaScript weekday numbers, 0 Sunday to 6 Saturday. */
function weekdaysFlag(value: string): number[] {
  const index = (word: string): number => {
    const found = WEEKDAY_NAMES.indexOf(word.trim().toLowerCase().slice(0, 3));
    if (found < 0 || word.trim().length < 3) throw new UsageError(`--days: unknown weekday "${word}"`, { hint: "pass --days mon-fri, --days mon,wed,fri, or --days sat-sun" });
    return found;
  };
  const days: number[] = [];
  for (const part of value.split(",")) {
    const range = /^([^-]+)(?:-([^-]+))?$/.exec(part.trim());
    if (!range) throw new UsageError(`--days: cannot read "${part}"`, { hint: "pass --days mon-fri, --days mon,wed,fri, or --days sat-sun" });
    const from = index(range[1]!);
    const to = range[2] === undefined ? from : index(range[2]);
    for (let day = from; ; day = (day + 1) % 7) {
      if (!days.includes(day)) days.push(day);
      if (day === to) break;
    }
  }
  return days;
}

function hoursFlag(value: string): { start: string; end: string } {
  const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value.trim());
  if (!match) throw new UsageError(`--hours expects HH:MM-HH:MM, got "${value}"`, { hint: "pass --hours 09:00-18:00" });
  return { start: match[1]!, end: match[2]! };
}

/** The consent URL: printed on stderr always (the fallback), and handed to the browser on macOS unless the caller replaced `openUrl`. */
function showSignInUrl(io: CliIo, url: string): void {
  io.stderr.write(`life: sign in with Google in the browser; if it did not open, visit:\n  ${url}\n`);
  if (io.openUrl) {
    io.openUrl(url);
    return;
  }
  if (process.platform !== "darwin") return;
  try {
    const child = spawn("open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is on stderr; opening the browser is a convenience.
  }
}

/** Sync reports as a result: exit 1 when a calendar failed (3 when the provider could not be reached), the reports as the result either way. */
function renderedSync(inv: Invocation, reports: SyncReport[]): Rendered {
  const failures = reports.flatMap((report) => report.calendars.filter((entry) => entry.outcome === "failed").map((entry) => `${entry.calendarId}: ${entry.error ?? "failed"}`));
  const unreachable = failures.length > 0 && failures.every((failure) => /ProviderUnavailable/.test(failure));
  const code = failures.length === 0 ? EXIT.ok : unreachable ? EXIT.provider : EXIT.rejected;
  const error: EnvelopeError | undefined = failures.length
    ? {
        code: unreachable ? "provider_unavailable" : "rejected",
        message: `${failures.length} calendar${failures.length === 1 ? "" : "s"} failed to sync: ${failures.join("; ")}`,
        issues: failures,
        hint: unreachable ? "the calendar provider could not be reached; the copy is unchanged, retry later or run `life doctor`" : "run `life doctor` for each account's state; `life account add google` reconnects an account that needs re-authorization",
      }
    : undefined;
  return { code, result: reports, text: async () => syncText(reports, await calendarIndex(inv.tools), await accountIndex(inv.tools)), ...(error ? { error } : {}) };
}

/** The stderr lines for a view: one per stale or failed calendar, plus the view's own warnings that are not about a refresh. */
function freshnessLines(inv: Setup, freshness: Freshness, warnings: string[]): string[] {
  const maxAge = maxAgeFromEnv(inv.io.env);
  const lines: string[] = [];
  for (const entry of freshness) {
    const copy = entry.syncedAt === null ? "never synced" : `synced ${entry.ageSeconds}s ago`;
    if (entry.error !== null) lines.push(`calendar "${entry.name}" (${entry.calendarId}) could not be refreshed: ${entry.error}; answering from the copy, ${copy}`);
    else if (!entry.refreshed && (entry.ageSeconds === null || entry.ageSeconds > maxAge)) lines.push(`calendar "${entry.name}" (${entry.calendarId}) answered from a stale copy, ${copy}`);
  }
  for (const warning of warnings) if (!warning.startsWith('Calendar "')) lines.push(`warning: ${warning}`);
  return lines;
}

// ------------------------------------------------------------------ account commands

const accountAdd: CommandDef = {
  group: "account",
  name: "add",
  summary: "Connect a Google account: opens the browser to sign in, then syncs its calendars",
  description: "Runs Life-OS's own OAuth desktop flow: the browser opens on macOS (the URL is also printed on stderr), Neel picks the account, and the refresh token lands in .local/google/<accountId>.json, never in the database. The first account becomes primary. The account is then synced once; the sync report is in the receipt and any calendar that failed is a warning. Needs LIFE_GOOGLE_CLIENT_ID and LIFE_GOOGLE_CLIENT_SECRET in the repository .env.",
  positionals: [{ name: "provider", help: "The provider: google." }],
  flags: { label: { kind: "value", type: "text", help: "A label for the account, usable as a ref (e.g. work)." } },
  examples: ["life account add google --actor neel", "life account add google --label work --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const provider = inv.args[0]!;
    if (provider !== "google") throw new UsageError(`life account add: unknown provider "${provider}"; google is the only provider in this cut`, { layer: { kind: "command", command: accountAdd } });
    const label = inv.flags.str("label");
    const receipt: AccountAddReceipt = await inv.tools.account.add({ provider, ...(label !== undefined ? { label } : {}), open: (url) => showSignInUrl(inv.io, url) }, inv.ctx());
    const base = rendered(inv, accountAdd, receipt);
    return {
      ...base,
      text: async () => {
        const head = await base.text();
        if (!receipt.ok || !receipt.sync) return head;
        return `${head}\n${syncText([receipt.sync], await calendarIndex(inv.tools), await accountIndex(inv.tools))}`;
      },
    };
  },
};

const accountList: CommandDef = {
  group: "account",
  name: "list",
  summary: "Every connected account with its id, identity, status, and last sync",
  positionals: [],
  flags: {},
  examples: ["life account list --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const accounts = await inv.tools.account.list();
    return plain(EXIT.ok, accounts, accounts.length ? accountTable(accounts) : "No accounts. Connect one with `life account add google`.");
  },
};

const accountGet: CommandDef = {
  group: "account",
  name: "get",
  summary: "Show one account",
  positionals: [POS_CAL.accountRef],
  flags: {},
  examples: ["life account get neel@gmail.com --json", "life account get work"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const account = await inv.tools.account.get(inv.args[0]!);
    if (!account) return notFound(accountGet, `account: no account "${inv.args[0]}"`, `No account "${inv.args[0]}".`);
    return { code: EXIT.ok, result: account, text: async () => accountDetail(account, await calendarIndex(inv.tools)) };
  },
};

const accountRemove: CommandDef = {
  group: "account",
  name: "remove",
  summary: "Disconnect an account: its calendars and events go to the trash and its credential file is deleted",
  description: "Rejected while the account is primary and another account exists; make another one primary first.",
  positionals: [POS_CAL.accountRef],
  flags: {},
  examples: ["life account remove work --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, accountRemove, await inv.tools.account.remove(inv.args[0]!, inv.ctx())),
};

const accountPrimary: CommandDef = {
  group: "account",
  name: "primary",
  summary: "Make an account the primary one (the default target for `event add`)",
  positionals: [POS_CAL.accountRef],
  flags: {},
  examples: ["life account primary work --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, accountPrimary, await inv.tools.account.primary(inv.args[0]!, inv.ctx())),
};

const accountSync: CommandDef = {
  group: "account",
  name: "sync",
  summary: "Pull one account's calendars and events from the provider, or every connected account's",
  description: "Incremental with the provider's sync tokens; --full discards them and lists everything again from LIFE_CAL_HISTORY_MONTHS months back. Not a mutation in itself: its writes are the *.sync log entries under actor import:google. A calendar that fails is reported and does not stop the others.",
  positionals: [{ name: "ref", help: `An account reference: ${ACCOUNT_REF}. Without it, every connected account.`, optional: true, ref: "account" }],
  flags: { full: { kind: "bool", help: "Discard the stored cursors and list everything again." } },
  examples: ["life account sync --json", "life account sync work --full --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  run: async (inv) => renderedSync(inv, await inv.tools.account.sync(inv.args[0], { full: inv.flags.bool("full") })),
};

// ------------------------------------------------------------------ calendar commands

const calendarList: CommandDef = {
  group: "calendar",
  name: "list",
  summary: "The calendars of every account, by account then order, with ids, access, labels, and copy age",
  positionals: [],
  flags: { hidden: HIDDEN_FLAG },
  examples: ["life calendar list --json", "life calendar list --hidden"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const calendars = await inv.tools.calendar.list({ includeHidden: inv.flags.bool("hidden") });
    return plain(EXIT.ok, calendars, calendars.length ? calendarTable(calendars, await accountIndex(inv.tools)) : "No calendars. Connect an account with `life account add google`, or pass --hidden.");
  },
};

const calendarGet: CommandDef = {
  group: "calendar",
  name: "get",
  summary: "Show one calendar",
  positionals: [POS_CAL.calendarRef],
  flags: {},
  examples: ["life calendar get neel@gmail.com/Personal --json", "life calendar get c_abc123def0"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const calendar = await inv.tools.calendar.get(inv.args[0]!);
    if (!calendar) return notFound(calendarGet, `calendar: no calendar "${inv.args[0]}"`, `No calendar "${inv.args[0]}".`);
    return { code: EXIT.ok, result: calendar, text: async () => calendarDetail(calendar, await accountIndex(inv.tools)) };
  },
};

const calendarSync: CommandDef = {
  group: "calendar",
  name: "sync",
  summary: "Pull one calendar's events from the provider",
  positionals: [POS_CAL.calendarRef],
  flags: {},
  examples: ["life calendar sync neel@gmail.com/Personal --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  run: async (inv) => renderedSync(inv, [await inv.tools.calendar.sync(inv.args[0]!)]),
};

const calendarUpdate: CommandDef = {
  group: "calendar",
  name: "update",
  summary: "Change what is Life-OS's about a calendar: its labels (life areas), whether it is hidden, its colour",
  description: "Name, timezone, and access come from the provider on sync and cannot be changed here. Labels named but not registered are created. A hidden calendar stays out of today, week, and slots unless asked for.",
  positionals: [POS_CAL.calendarRef],
  flags: {
    label: { ...LABEL_FLAG, help: "Replace the calendar's labels (life areas) with these. Repeatable." },
    "no-label": { kind: "bool", help: "Remove every label." },
    hidden: { kind: "bool", help: "Hide the calendar from the views." },
    visible: { kind: "bool", help: "Show the calendar in the views again." },
    color: { kind: "value", type: "text", help: "Life-OS's colour for the calendar (the provider's is read on sync)." },
    "no-color": { kind: "bool", help: "Clear the colour." },
  },
  examples: ["life calendar update neel@gmail.com/Personal --label health --label family --actor neel --json", "life calendar update Holidays --hidden --actor neel"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    if (f.bool("hidden") && f.bool("visible")) throw new UsageError("--hidden and --visible exclude each other");
    const input = compact({ labels: labelsFlag(inv), hidden: f.bool("hidden") ? true : f.bool("visible") ? false : undefined, color: f.clearable("color") });
    if (!Object.keys(input).length) throw new UsageError("life calendar update: nothing to change; pass --label/--no-label, --hidden/--visible, or --color/--no-color", { layer: { kind: "command", command: calendarUpdate } });
    return rendered(inv, calendarUpdate, await inv.tools.calendar.update(inv.args[0]!, input as CalendarUpdate, inv.ctx()));
  },
};

const calendarReorder: CommandDef = {
  group: "calendar",
  name: "reorder",
  summary: "Put one account's calendars in this order",
  positionals: [{ name: "id", help: "Calendar ids (c_...), in the wanted order; all in one account.", variadic: true }],
  flags: {},
  examples: ["life calendar reorder c_aaaaaaaaaa c_bbbbbbbbbb --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => renderedAll(inv, calendarReorder, await inv.tools.calendar.reorder(inv.args, inv.ctx())),
};

// ------------------------------------------------------------------ event commands

const eventAdd: CommandDef = {
  group: "event",
  name: "add",
  summary: "Add an event to a calendar (through the provider; the readback is stored)",
  description: "A timed event takes --start (and --end or --duration; default one hour); an all-day event takes --date (and --end-date or --days; default one day). Without --calendar it lands on the primary account's main calendar. `event add` and `task add` are different things: a commitment at a time with a place or people is an event, a thing to do is a task.",
  positionals: [{ name: "title", help: "The event title." }],
  flags: {
    start: START_FLAG,
    end: END_FLAG,
    duration: { kind: "value", type: "integer", help: "Minutes; with --start instead of --end.", default: "60" },
    floating: FLOATING_FLAG,
    date: DATE_FLAG,
    "end-date": END_DATE_FLAG,
    days: { kind: "value", type: "integer", help: "Days; with --date instead of --end-date.", default: "1" },
    calendar: { ...CALENDAR_FLAG, default: "the primary account's main calendar" },
    notes: { kind: "value", type: "text", help: "Description." },
    location: { kind: "value", type: "text", help: "Location, as text." },
    repeat: { kind: "value", type: "RRULE", help: "Recurrence rule (RFC 5545), e.g. FREQ=WEEKLY;BYDAY=MO." },
    free: { kind: "bool", help: "Mark the time free (transparent); timed events default to busy, all-day ones to free." },
  },
  examples: [
    'life event add "Dentist" --start "2026-09-10 16:00" --duration 45 --location "12 Main St" --actor codex --json',
    'life event add "Team offsite" --date 2026-09-14 --days 2 --calendar work@example.com/Work --actor neel --json',
    'life event add "Yoga" --start "tomorrow 07:00" --end "tomorrow 08:00" --repeat FREQ=WEEKLY;BYDAY=WE --actor neel',
  ],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const span = spanFlags(inv, eventAdd);
    if (!span || !span.start) throw new UsageError('life event add: pass --start "YYYY-MM-DD HH:MM" for a timed event or --date YYYY-MM-DD for an all-day one', { layer: { kind: "command", command: eventAdd } });
    const input = compact({
      title: inv.args[0]!,
      calendar: f.str("calendar"),
      ...span,
      notes: f.str("notes"),
      location: f.str("location"),
      repeat: f.str("repeat"),
      busy: f.bool("free") ? false : undefined,
    });
    return rendered(inv, eventAdd, await inv.tools.event.add(input as EventAdd, inv.ctx()));
  },
};

const eventGet: CommandDef = {
  group: "event",
  name: "get",
  summary: "Show one event or one occurrence in full (deleted included)",
  positionals: [POS_CAL.eventRef],
  flags: {},
  examples: ["life event get e_abc123def0 --json", "life event get e_abc123def0@2026-09-10T16:00:00Z"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const ref = inv.args[0]!;
    const found = await inv.tools.event.get(ref);
    if (!found) return notFound(eventGet, isOccurrenceRef(ref) ? `event: no occurrence "${ref}"` : `event: no event "${ref}"`, `No event "${ref}".`);
    return { code: EXIT.ok, result: found, text: async () => eventDetail(found, await calendarIndex(inv.tools), inv.tz) };
  },
};

const eventList: CommandDef = {
  group: "event",
  name: "list",
  summary: "The occurrences in a window, expanded, with their occurrence refs (from the copy; no refresh)",
  description: "Repeating events are laid out as occurrences; each line carries the occurrence ref (e_...@<originalStart>) to pass to update, reschedule, respond, cancel, or delete. Reads the copy as it is; `life sync` or a view refreshes it.",
  positionals: [],
  flags: {
    from: { kind: "value", type: DATE_TYPE, help: `First day (inclusive): ${DATE_HELP}; or an instant.` },
    to: { kind: "value", type: DATE_TYPE, help: `Last day (inclusive): ${DATE_HELP}; or an instant (exclusive).` },
    calendar: { ...CALENDAR_FLAG, kind: "list", help: `Only these calendars: ${CALENDAR_REF}. A hidden calendar named here is included. Repeatable.` },
    hidden: HIDDEN_FLAG,
    deleted: { kind: "bool", help: "Include deleted events." },
  },
  examples: ["life event list --from today --to +7d --json", "life event list --from 2026-09-01 --to 2026-09-30 --calendar neel@gmail.com/Personal --json"],
  notes: EVENT_NOTES,
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const from = dateFlag(inv, "from");
    const to = dateFlag(inv, "to");
    if (from === undefined || to === undefined) throw new UsageError("life event list: pass --from <date> and --to <date>", { layer: { kind: "command", command: eventList } });
    const calendars = f.list("calendar");
    const occurrences = await inv.tools.event.list(compact({ from, to, calendars: calendars.length ? calendars : undefined, includeHidden: f.bool("hidden") || undefined, includeDeleted: f.bool("deleted") || undefined }) as { from: string; to: string });
    return { code: EXIT.ok, result: occurrences, text: async () => (occurrences.length ? occurrenceTable(occurrences, await calendarIndex(inv.tools), inv.tz) : "No events.") };
  },
};

/** The flags every scoped write shares. */
const scopeOpts = (inv: Setup): { scope?: Scope } => compact({ scope: inv.flags.str("scope") }) as { scope?: Scope };

const eventUpdate: CommandDef = {
  group: "event",
  name: "update",
  summary: "Change an event's title, notes, location, time, rule, or busy flag (through the provider)",
  description: "Pass at least one flag; a --no-<field> flag clears it. A repeating event needs --scope. Times: --start/--end (with --floating for no zone) for a timed event, --date/--end-date for an all-day one; an omitted end keeps the duration.",
  positionals: [POS_CAL.eventRef],
  flags: {
    title: { kind: "value", type: "text", help: "New title." },
    notes: { kind: "value", type: "text", help: "New description (replaces the old one)." },
    "no-notes": { kind: "bool", help: "Clear the description." },
    location: { kind: "value", type: "text", help: "New location." },
    "no-location": { kind: "bool", help: "Clear the location." },
    start: START_FLAG,
    end: END_FLAG,
    floating: FLOATING_FLAG,
    date: DATE_FLAG,
    "end-date": END_DATE_FLAG,
    repeat: { kind: "value", type: "RRULE", help: "New recurrence rule (needs --scope all on a series)." },
    "no-repeat": { kind: "bool", help: "Stop repeating." },
    busy: { kind: "bool", help: "Mark the time busy." },
    free: { kind: "bool", help: "Mark the time free." },
    scope: SCOPE_FLAG,
  },
  examples: [
    'life event update e_abc123def0 --title "Dentist (and hygienist)" --location "14 Main St" --actor codex --json',
    'life event update e_abc123def0@2026-09-10T16:00:00Z --start "2026-09-10 17:00" --scope this --actor neel --json',
    "life event update e_abc123def0 --no-repeat --scope all --actor neel",
  ],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    if (f.bool("busy") && f.bool("free")) throw new UsageError("--busy and --free exclude each other");
    const span = spanFlags(inv, eventUpdate) ?? {};
    const input = compact({
      title: f.str("title"),
      notes: f.clearable("notes"),
      location: f.clearable("location"),
      ...span,
      repeat: f.clearable("repeat"),
      busy: f.bool("busy") ? true : f.bool("free") ? false : undefined,
    });
    if (!Object.keys(input).length) throw new UsageError("life event update: nothing to change; pass at least one flag", { layer: { kind: "command", command: eventUpdate } });
    return rendered(inv, eventUpdate, await inv.tools.event.update(inv.args[0]!, input as EventUpdate, inv.ctx(), scopeOpts(inv)));
  },
};

const eventReschedule: CommandDef = {
  group: "event",
  name: "reschedule",
  summary: "Move an event or one occurrence to a new time (the duration is kept unless --end is given)",
  positionals: [POS_CAL.eventRef],
  flags: {
    start: { ...START_FLAG, help: `New start: ${WHEN_HELP}.` },
    end: { ...END_FLAG, help: "New end; without it the event keeps its duration." },
    floating: FLOATING_FLAG,
    date: { ...DATE_FLAG, help: `New start date for an all-day event: ${DATE_HELP}.` },
    "end-date": END_DATE_FLAG,
    scope: SCOPE_FLAG,
  },
  examples: ['life event reschedule e_abc123def0 --start "2026-09-11 10:00" --actor codex --json', 'life event reschedule e_abc123def0@2026-09-10T16:00:00Z --start "+1d 16:00" --scope this --actor neel --json'],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const span = spanFlags(inv, eventReschedule);
    if (!span || !span.start) throw new UsageError('life event reschedule: pass --start "YYYY-MM-DD HH:MM" (or --date YYYY-MM-DD for an all-day event)', { layer: { kind: "command", command: eventReschedule } });
    if (span.duration !== undefined) throw new UsageError("life event reschedule: pass --end, not --duration", { layer: { kind: "command", command: eventReschedule } });
    return rendered(inv, eventReschedule, await inv.tools.event.reschedule(inv.args[0]!, compact({ start: span.start, end: span.end }) as { start: When; end?: When }, inv.ctx(), scopeOpts(inv)));
  },
};

const eventMove: CommandDef = {
  group: "event",
  name: "move",
  summary: "Move a single event or a whole series to another calendar of the same account",
  description: "The provider cannot move an event between accounts; for that, duplicate it onto the other account's calendar and delete the original.",
  positionals: [POS_CAL.eventRef],
  flags: { calendar: { ...CALENDAR_FLAG, help: `Target calendar: ${CALENDAR_REF}.` } },
  examples: ["life event move e_abc123def0 --calendar neel@gmail.com/Family --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const calendar = inv.flags.str("calendar");
    if (calendar === undefined) throw new UsageError("life event move: pass --calendar <ref>", { layer: { kind: "command", command: eventMove } });
    return rendered(inv, eventMove, await inv.tools.event.move(inv.args[0]!, calendar, inv.ctx()));
  },
};

const RESPONSES = ["accepted", "declined", "tentative"] as const;

const eventRespond: CommandDef = {
  group: "event",
  name: "respond",
  summary: "Answer an invitation: accepted, declined, or tentative (only when Neel is an attendee)",
  positionals: [POS_CAL.eventRef, { name: "response", help: "accepted, declined, or tentative." }],
  flags: { scope: { ...SCOPE_FLAG, values: ["this", "all"], help: "On a repeating invitation: this occurrence only, or the whole series." } },
  examples: ["life event respond e_abc123def0 accepted --actor neel --json", "life event respond e_abc123def0@2026-09-10T16:00:00Z declined --scope this --actor neel --json"],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  async run(inv) {
    const response = inv.args[1]!;
    if (!(RESPONSES as readonly string[]).includes(response)) {
      throw new UsageError(`life event respond: <response> must be one of ${RESPONSES.join(", ")}, got "${response}"`, { layer: { kind: "command", command: eventRespond }, hint: `pass ${RESPONSES.join("|")}` });
    }
    return rendered(inv, eventRespond, await inv.tools.event.respond(inv.args[0]!, response as EventResponse, inv.ctx(), scopeOpts(inv)));
  },
};

const eventCancel: CommandDef = {
  group: "event",
  name: "cancel",
  summary: "Cancel an event Neel organises (attendees are told by the provider); --reason is required",
  description: "The event stays visible with status cancelled, not deleted. Only the organizer can cancel; decline an invitation with `event respond declined` instead.",
  positionals: [POS_CAL.eventRef],
  flags: { scope: SCOPE_FLAG },
  examples: ['life event cancel e_abc123def0 --reason "moved to next quarter" --actor neel --json', 'life event cancel e_abc123def0@2026-09-10T16:00:00Z --scope this --reason "away that day" --actor neel'],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, eventCancel, await inv.tools.event.cancel(inv.args[0]!, inv.ctx(), scopeOpts(inv))),
};

const eventDelete: CommandDef = {
  group: "event",
  name: "delete",
  summary: "Delete an event at the provider; the copy goes to the trash (`event restore` recreates it)",
  description: "On one occurrence (--scope this) the provider cancels that instance. --scope following cuts the series before the occurrence; --scope all deletes the series and its exceptions.",
  positionals: [POS_CAL.eventRef],
  flags: { scope: SCOPE_FLAG },
  examples: ["life event delete e_abc123def0 --actor neel --json", "life event delete e_abc123def0@2026-09-17T16:00:00Z --scope following --actor neel --json"],
  notes: EVENT_NOTES,
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, eventDelete, await inv.tools.event.delete(inv.args[0]!, inv.ctx(), scopeOpts(inv))),
};

const eventRestore: CommandDef = {
  group: "event",
  name: "restore",
  summary: "Recreate a deleted event (or series) at the provider under the same Life-OS id",
  positionals: [POS_CAL.eventId],
  flags: {},
  examples: ["life event restore e_abc123def0 --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, eventRestore, await inv.tools.event.restore(inv.args[0]!, inv.ctx())),
};

const eventDuplicate: CommandDef = {
  group: "event",
  name: "duplicate",
  summary: "Copy an event (or one occurrence, or a series) as a new event without its attendees",
  positionals: [POS_CAL.eventRef],
  flags: { calendar: { ...CALENDAR_FLAG, help: `Put the copy on this calendar (any account): ${CALENDAR_REF}.`, default: "the original's calendar" } },
  examples: ["life event duplicate e_abc123def0 --actor neel --json", "life event duplicate e_abc123def0 --calendar work@example.com/Work --actor neel --json"],
  exits: [...EXITS.write],
  mutates: true,
  database: "connect",
  run: async (inv) => rendered(inv, eventDuplicate, await inv.tools.event.duplicate(inv.args[0]!, inv.ctx(), compact({ calendar: inv.flags.str("calendar") }))),
};

const eventHistory: CommandDef = {
  group: "event",
  name: "history",
  summary: "Every logged change to an event, oldest first, sync entries included (actor import:google)",
  positionals: [POS_CAL.eventId],
  flags: {},
  examples: ["life event history e_abc123def0 --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const id = inv.args[0]!;
    if (!(await inv.tools.event.get(id))) return notFound(eventHistory, `event: no event "${id}"`, `No event "${id}".`);
    const entries = await inv.tools.event.history(id);
    return plain(EXIT.ok, entries, historyText(entries));
  },
};

// ------------------------------------------------------------------ library: shared pieces

/** The four media, each a CLI group of its own (LEISURE D82); `media` holds the cross-media views. */
const MEDIA: readonly Medium[] = ["movie", "show", "game", "book"];
const isMedium = (word: string): word is Medium => (MEDIA as readonly string[]).includes(word);

const TITLE_REF = "a title id (m_...) or a name: exact (case-insensitive), an alias, or a part of the name unique among the group's titles";
const RATING_HELP = "half stars from 0.5 to 5, written 4.5 or 4½";
const PROGRESS_VALUES = ["curious", "backlog", "active", "paused", "done", "dropped"] as const;
const OWNERSHIP_VALUES = ["none", "owned", "service", "borrowed"] as const;
const PRIORITY_VALUES = ["now", "soon", "later"] as const;
const MOOD_VALUES = ["comfort", "immersive", "social", "learning", "low-energy"] as const;
const FIT_VALUES = ["short", "medium", "long"] as const;
const FORMAT_VALUES = ["audiobook", "physical", "kindle"] as const;
const SPEND_KINDS = ["purchase", "iap", "rental"] as const;
const ENTRY_TYPES = ["want", "start", "progress", "finish", "pause", "resume", "drop", "again", "note", "buy", "borrow", "return", "service"] as const;

/** Sample names for each medium's examples. */
const SAMPLE: Record<Medium, { one: string; two: string; series: string }> = {
  movie: { one: "Arrival", two: "Dune: Part Two", series: "Dune" },
  show: { one: "Severance", two: "The Bear", series: "Severance" },
  game: { one: "Hollow Knight", two: "Fire Emblem: Fortune's Weave", series: "Hollow Knight" },
  book: { one: "Skyward", two: "Project Hail Mary", series: "Skyward" },
};

const onFlagDef = (help: string, extra: Partial<FlagDef> = {}): FlagDef => ({ kind: "value", type: "date", help: `${help}: ${ON_FORMS}.`, ...extra });

/** A flag that applies to some media only; `mediumFlags` drops it elsewhere, so `--platform` on `book` is a usage error. */
type MediumFlagDef = FlagDef & { media?: readonly Medium[] };
type MediumFlagSpec = Readonly<Record<string, MediumFlagDef>>;

const BOOK: readonly Medium[] = ["book"];
const GAME: readonly Medium[] = ["game"];
const SCREEN: readonly Medium[] = ["movie", "show"];

/** The flags of `spec` that apply to `medium`, with the marker stripped. */
function mediumFlags(medium: Medium, spec: MediumFlagSpec): FlagSpec {
  const out: Record<string, FlagDef> = {};
  for (const [name, { media, ...def }] of Object.entries(spec)) if (!media || media.includes(medium)) out[name] = def;
  return out;
}

const ON_FLAG = onFlagDef("When it happened", { default: "today" });
const TEXT_FLAG: FlagDef = { kind: "value", type: "text", help: "A note recorded on the entry." };
const MINUTES_FLAG: FlagDef = { kind: "value", type: "integer", help: "Minutes spent in this sitting (never cumulative)." };
const PROGRESS_FLAG: FlagDef = { kind: "value", type: "text", help: 'Where he is, as free text ("S2E4", "ch. 12", "10 hours in").' };
const RATING_FLAG: FlagDef = { kind: "value", type: "rating", help: `Rating: ${RATING_HELP}.` };
const LIKED_FLAG: FlagDef = { kind: "bool", help: "Mark the title liked (a title field, kept across cycles)." };
const REVIEW_FLAG: FlagDef = { kind: "value", type: "text", help: "The review, in his words; it becomes the title's current review." };
const ENTRY_FLAG: FlagDef = { kind: "value", type: "id", help: "The entry (n_...) to act on; default the latest finish or drop. Ids are in `get` and `history`." };
const MEDIUM_FLAG: FlagDef = { kind: "value", values: MEDIA, help: "Only this medium." };
const FULL_FLAG: FlagDef = { kind: "bool", help: "Full records with entries and facts instead of the compact summaries." };
const MOOD_LIST_FLAG: FlagDef = { kind: "list", values: MOOD_VALUES, help: "A mood the title fits. Repeatable." };
const MOOD_FLAG: FlagDef = { kind: "value", values: MOOD_VALUES, help: "Only titles fitting this mood." };
const FIT_FLAG: FlagDef = { kind: "value", values: FIT_VALUES, help: "How long a sitting it wants." };
const FORMAT_FLAG: MediumFlagDef = { kind: "value", values: FORMAT_VALUES, help: "The book's format for this entry (an audiobook is a book with this format).", media: BOOK };
const FORMAT_FILTER_FLAG: MediumFlagDef = { kind: "value", values: FORMAT_VALUES, help: "Only books wanted in this format.", media: BOOK };
const PLATFORM_FLAG: MediumFlagDef = { kind: "value", type: "text", help: "The platform the game is on (Switch 2, PS5, iOS...).", media: GAME };
const WATCHED_ON_FLAG: MediumFlagDef = { kind: "value", type: "text", help: "Where it is or was watched (Netflix, the cinema...).", media: SCREEN };
const WHERE_FLAG: FlagDef = { kind: "value", type: "text", help: "The store, lender, or service." };
const STATUS_LIST_FLAG: FlagDef = { kind: "value", type: "list", help: `Only these statuses, comma-separated: ${PROGRESS_VALUES.join(", ")}. Dropped titles are hidden unless named here.`, default: "every status but dropped" };
const OWNERSHIP_LIST_FLAG: FlagDef = { kind: "value", type: "list", help: `Only these ownerships, comma-separated: ${OWNERSHIP_VALUES.join(", ")}.` };
const PRIORITY_FLAG: FlagDef = { kind: "value", values: PRIORITY_VALUES, help: "How soon he means to get to it." };
const TEXT_FILTER_FLAG: FlagDef = { kind: "value", type: "text", help: "Name, an alias, or a creator contains this text (case-insensitive); `life media search` looks wider." };
const SINCE_FLAG = onFlagDef("First date of the range (inclusive), at any precision but ?");
const UNTIL_FLAG = onFlagDef("Last date of the range (inclusive), at any precision but ?");

const BACKLOG_FLAGS: MediumFlagSpec = {
  mood: MOOD_FLAG,
  fit: FIT_FLAG,
  format: FORMAT_FILTER_FLAG,
  service: { kind: "value", type: "text", help: "Only titles a service of this name streams, rents, or sells (from the catalog's availability)." },
  "wanted-again": { kind: "bool", help: "Also done titles with a priority (a replay or reread he wants)." },
  full: FULL_FLAG,
};

/** The notes every medium group prints (the group-help hook) and every date-taking command repeats. */
function mediumNotes(medium: Medium): string[] {
  const lines = [
    `refs: ${TITLE_REF}; a name resolves among ${medium}s only (\`life media\` takes any medium). Several matches are a \`needs\` on ref with the titles in error.candidates: pass the id. A name found in another medium is named in the message (\`use life book\`).`,
    `dates: every date flag (--on, --started-on, --finished-on, --since, --until) carries its precision inside the value: ${ON_FORMS}. --on defaults to today; nothing is guessed and nothing is rejected for lacking a day.`,
    `ratings: ${RATING_HELP}; only a finish or a drop carries one, and the title shows the latest closing entry's. --liked is a title field and goes anywhere.`,
    "entry types and the states they are allowed from (status is derived from the diary, never set):",
    "  want              curious -> backlog",
    "  start             curious, backlog, paused, dropped -> active",
    "  again             done -> active (a new cycle; again --finished closes it in the same call)",
    "  resume            paused -> active",
    "  pause             active -> paused",
    "  finish            anything but done -> done (rating, review, format, minutes)",
    "  drop              backlog, active, paused -> dropped; the text is the reason and doubles as the review",
    "  progress, note    any state (a warning when the title is not active)",
    "  buy, borrow, service   any state; return needs owned, borrowed, or service. Ownership never changes progress.",
    "minutes: --minutes is one sitting's time, never cumulative (\"10 hours in\" is progress text).",
    "list hides dropped titles unless --status names them; deleted titles are in `life trash`.",
    `entry ids (n_...) come from \`life ${medium} get <ref>\` and \`life ${medium} history <ref>\`; amend, unlog, rate --entry, and relog take them.`,
    `catalog: ${SOURCE_NAMES[SOURCE_BY_MEDIUM[medium]]}. A lookup that cannot decide is a needs on catalog with error.candidates (candidateKind catalog): retry with --year when the message says year differs or several exact matches, else --catalog <id>. A missing key or a source that is down never blocks add: the title is created with a warning and refresh links it later.`,
  ];
  if (medium === "book") lines.push("audiobooks are books: pass --format audiobook on add (the wanted format), start, again, or finish; Audible, Libby, and Kindle links are constructed from the catalog and marked * by where.");
  return lines;
}

const MEDIA_NOTES = [
  `refs: ${TITLE_REF}, resolved across every medium here; the four groups (\`life movie\`, \`life show\`, \`life game\`, \`life book\`) resolve within their medium and hold every write.`,
  `dates: --since and --until carry their precision inside the value: ${ON_FORMS}; ? cannot bound a range. Entries dated ? appear only in a title's own diary.`,
  "output: lists and views return compact summaries { id, medium, name, year, status, ownership, priority, rating, liked, timeFit, moodFit, lastEntry } unless --full; get always returns the full record with entries and facts.",
  "time places entries by their --on at day and week precision over ISO weeks; month, year, and ? entries count in unplaced. year places a finish by its year at any precision but ?.",
];

/** A date with its precision inside the value (LEISURE D92), through on.ts; a bad one is a usage error naming the forms. */
function parseOnArg(value: string, what: string): On {
  const parsed = parseOn(value);
  if (!parsed.ok) throw new UsageError(`${what}: ${parsed.error}`, { hint: `pass ${what} 2026-09-07, 2026-09-07~w, 2026-09, 2026, or ?` });
  return parsed.on;
}

function onFlag(inv: Setup, name: string): On | undefined {
  const value = inv.flags.str(name);
  return value === undefined ? undefined : parseOnArg(value, `--${name}`);
}

/** A range bound: any precision but unknown. */
function boundFlag(inv: Setup, name: string): On | undefined {
  const on = onFlag(inv, name);
  if (on && on.precision === "unknown") throw new UsageError(`--${name}: ? cannot bound a range`, { hint: `pass --${name} 2026-09-01, 2026-09-07~w, 2026-09, or 2026` });
  return on;
}

/** `4.5` or `4½` as a Rating; anything off the half-star scale is a usage error. */
function parseRating(value: string, what: string): Rating {
  const text = value.trim().replace(/^½$/, "0.5").replace(/½$/, ".5");
  const found = /^\d+(\.\d+)?$/.test(text) ? RATINGS.find((r) => r === Number(text)) : undefined;
  if (found === undefined) throw new UsageError(`${what} expects a rating (${RATING_HELP}), got "${value}"`, { hint: `pass ${what} 4.5 (or 4½)` });
  return found;
}

function ratingFlag(inv: Setup, name = "rating"): Rating | undefined {
  const value = inv.flags.str(name);
  return value === undefined ? undefined : parseRating(value, `--${name}`);
}

/** Comma-separated values (`--status active,paused`), trimmed, empties dropped; undefined when the flag is absent. */
function csvFlag(inv: Setup, name: string): string[] | undefined {
  const raw = inv.flags.str(name);
  if (raw === undefined) return undefined;
  const values = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!values.length) throw new UsageError(`--${name} expects at least one value`);
  return values;
}

/** The currency LIFE_REGION implies when --currency is not passed; USD for any region not listed. */
const REGION_CURRENCY: Readonly<Record<string, string>> = {
  US: "USD", GB: "GBP", IN: "INR", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", KR: "KRW", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", BR: "BRL", MX: "MXN", SG: "SGD",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", AT: "EUR", BE: "EUR", FI: "EUR",
};
const defaultCurrency = (inv: Setup): string => REGION_CURRENCY[inv.region] ?? "USD";

/** `--price n [--currency XXX] [--kind purchase|iap|rental]` as a spend; the two options need the price. */
function spendFlags(inv: Setup): EntryInput["spend"] | undefined {
  const f = inv.flags;
  const price = f.str("price");
  if (price === undefined) {
    if (f.has("currency") || f.has("kind")) throw new UsageError("--currency and --kind need --price", { hint: "pass --price 59.99 --currency USD --kind purchase" });
    return undefined;
  }
  if (!/^\d+(\.\d+)?$/.test(price.trim())) throw new UsageError(`--price expects a number, got "${price}"`, { hint: "pass --price 59.99" });
  const kind = (f.str("kind") ?? "purchase") as (typeof SPEND_KINDS)[number];
  return { amount: Number(price), currency: (f.str("currency") ?? defaultCurrency(inv)).toUpperCase(), kind };
}

/** The entry input the entry flags describe; `text` may come from a positional or --review (the review is the entry's text). */
function entryInput(inv: Setup, extra: { text?: string } = {}): EntryInput {
  const f = inv.flags;
  const review = f.str("review");
  const text = f.str("text");
  if (review !== undefined && text !== undefined) throw new UsageError("--review and --text exclude each other; the review is the entry's text");
  return compact({
    on: onFlag(inv, "on"),
    text: extra.text ?? review ?? text,
    progress: f.str("progress"),
    format: f.str("format"),
    rating: ratingFlag(inv),
    liked: f.bool("liked") || undefined,
    minutes: f.int("minutes"),
    spend: spendFlags(inv),
    where: f.str("where"),
  }) as EntryInput;
}

/** The medium block from --format, --platform, --watched-on (and their --no- forms when `clearable`); undefined when none was passed. */
function detailFlags(inv: Setup, clearable: boolean): TitleAdd["detail"] | undefined {
  const f = inv.flags;
  const pick = (name: string) => (clearable ? f.clearable(name) : f.str(name));
  const detail = compact({ format: pick("format"), platform: pick("platform"), where: pick("watched-on") });
  return Object.keys(detail).length ? (detail as TitleAdd["detail"]) : undefined;
}

/** A --mood list or --no-mood as the moodFit input. */
function moodFlags(inv: Setup): string[] | undefined {
  const moods = inv.flags.list("mood");
  if (inv.flags.bool("no-mood")) {
    if (moods.length) throw new UsageError("--mood and --no-mood exclude each other");
    return [];
  }
  return moods.length ? moods : undefined;
}

const renderedTitles = (rows: ViewTitle[], showMedium: boolean, empty: string): Rendered => ({ code: EXIT.ok, result: rows, text: () => (rows.length ? titleTable(rows, showMedium) : empty) });

/** A resolved ref, or the rendering of why not: a `needs` on ref with the titles, or not_found. */
function unresolved(command: CommandDef, found: Exclude<Awaited<ReturnType<TitleOps["resolve"]>>, { ok: true }>, ref: string): Rendered {
  const what = command.group && isMedium(command.group) ? command.group : "title";
  if (found.kind === "ambiguous") {
    const hint = needsHint(command, found.needs, found.candidates);
    return {
      code: EXIT.rejected,
      result: null,
      text: () => [`rejected`, ...found.issues.map((issue) => `  - ${issue}`), titleTable(found.candidates, what === "title", "  "), `  ${hint}`].join("\n"),
      error: { code: "needs", message: found.needs.message, issues: found.issues, hint, needs: found.needs, candidates: found.candidates, candidateKind: "title" },
      needs: found.needs,
    };
  }
  if (found.kind === "deleted") return notFound(command, found.issues[0]!, `${what} ${found.title.id} is deleted.`);
  return notFound(command, found.issues[0]!, `No ${what} "${ref}".`);
}

// ------------------------------------------------------------------ library: the medium groups

const define = (group: GroupName, def: Omit<CommandBase, "group"> & { run(inv: Invocation): Promise<Rendered> }): CommandDef => ({ group, database: "connect", ...def });

const titleAddFlags = (medium: Medium): FlagSpec =>
  mediumFlags(medium, {
    year: { kind: "value", type: "integer", help: "The release year; narrows the catalog search and the confidence rule." },
    catalog: { kind: "value", type: "id", help: `The ${SOURCE_NAMES[SOURCE_BY_MEDIUM[medium]]} id to link, skipping the search (the answer to a catalog needs; \`lookup\` lists ids).` },
    "no-lookup": { kind: "bool", help: "Create the title without asking the catalog; `refresh` links it later." },
    want: { kind: "bool", help: "He wants it: a want entry lands it in the backlog." },
    started: { kind: "bool", help: "He has started it: a start entry (dated --started-on, else --on)." },
    finished: { kind: "bool", help: "He has finished it: a finish entry (dated --finished-on, else --on); alone it is a cycle of one." },
    "started-on": onFlagDef("When it was started, with its own precision; needs --started", { default: "--on" }),
    "finished-on": onFlagDef("When it was finished, with its own precision; needs --finished", { default: "--on" }),
    on: onFlagDef("When it happened: the date for --started and --finished when they have none of their own", { default: "today" }),
    "seen-before": { kind: "value", type: "date", accepts: (next) => parseOn(next).ok, help: `He finished it before: an earlier finish dated as given (${ON_FORMS}), or ? when no date follows. A rewatch he just made is --seen-before --finished.`, default: "? when the flag stands alone" },
    rating: { ...RATING_FLAG, help: `Rating on the finish; needs --finished. ${RATING_HELP}.` },
    liked: LIKED_FLAG,
    review: { ...REVIEW_FLAG, help: "The review on the finish; needs --finished." },
    progress: { ...PROGRESS_FLAG, help: "Where he is, on the start entry; needs --started." },
    minutes: { ...MINUTES_FLAG, help: "Minutes of the first sitting, on the start entry; needs --started." },
    priority: PRIORITY_FLAG,
    mood: MOOD_LIST_FLAG,
    fit: FIT_FLAG,
    format: { ...FORMAT_FLAG, help: "The wanted format; also the format of the entry created here (an audiobook is a book with this format)." },
    platform: PLATFORM_FLAG,
    "watched-on": WATCHED_ON_FLAG,
    notes: { kind: "value", type: "text", help: "Standing notes (markdown), such as where he means to buy it." },
    "allow-duplicate": { kind: "bool", help: `Add even when a ${medium} with this name exists (otherwise exit 2 lists it as a candidate).` },
  });

const titleUpdateFlags = (medium: Medium): FlagSpec =>
  mediumFlags(medium, {
    name: { kind: "value", type: "text", help: "New name (a factual field: listed in edited, so refresh keeps it)." },
    alias: { kind: "list", type: "text", help: "Replace the aliases (other names he uses) with these. Repeatable." },
    "no-alias": { kind: "bool", help: "Remove every alias." },
    year: { kind: "value", type: "integer", help: "New release year (edited)." },
    "no-year": { kind: "bool", help: "Clear the year." },
    creators: { kind: "value", type: "list", help: "Replace the creators, comma-separated (edited)." },
    cover: { kind: "value", type: "url", help: "New cover URL (edited)." },
    "no-cover": { kind: "bool", help: "Clear the cover." },
    series: { kind: "value", type: "text", help: "The series name, set by hand (wins over the catalog's); --position gives the position." },
    position: { kind: "value", type: "integer", help: "The position in the series; needs --series." },
    "no-series": { kind: "bool", help: "Clear the hand-set series." },
    priority: PRIORITY_FLAG,
    "no-priority": { kind: "bool", help: "Clear the priority." },
    mood: { ...MOOD_LIST_FLAG, help: "Replace the moods with these. Repeatable." },
    "no-mood": { kind: "bool", help: "Remove every mood." },
    fit: FIT_FLAG,
    "no-fit": { kind: "bool", help: "Clear the time fit." },
    format: { ...FORMAT_FLAG, help: "The wanted format (an audiobook is a book with this format)." },
    "no-format": { kind: "bool", help: "Clear the wanted format.", media: BOOK },
    platform: PLATFORM_FLAG,
    "no-platform": { kind: "bool", help: "Clear the platform.", media: GAME },
    "watched-on": WATCHED_ON_FLAG,
    "no-watched-on": { kind: "bool", help: "Clear where it is watched.", media: SCREEN },
    notes: { kind: "value", type: "text", help: "New standing notes (replace the old ones)." },
    "no-notes": { kind: "bool", help: "Clear the notes." },
  });

const AMEND_FLAGS: MediumFlagSpec = {
  type: { kind: "value", values: ENTRY_TYPES, help: "Change the entry's type (the diary is re-derived; any sequence is legal after a correction)." },
  on: onFlagDef("Change when it happened"),
  text: { kind: "value", type: "text", help: "New text (note, review, or drop reason)." },
  "no-text": { kind: "bool", help: "Clear the text." },
  progress: PROGRESS_FLAG,
  "no-progress": { kind: "bool", help: "Clear the progress text." },
  rating: RATING_FLAG,
  "no-rating": { kind: "bool", help: "Clear the rating." },
  minutes: MINUTES_FLAG,
  "no-minutes": { kind: "bool", help: "Clear the minutes." },
  format: FORMAT_FLAG,
  "no-format": { kind: "bool", help: "Clear the entry's format.", media: BOOK },
  where: WHERE_FLAG,
  "no-where": { kind: "bool", help: "Clear the store, lender, or service." },
};

/** One medium's commands, generated from the shared table with the flags that do not apply to it left out. */
function mediumCommands(medium: Medium): CommandDef[] {
  const ops = (inv: Invocation): TitleOps => inv.tools.title.scoped(medium);
  const media = (inv: Invocation) => inv.tools.media;
  const source = SOURCE_NAMES[SOURCE_BY_MEDIUM[medium]];
  const s = SAMPLE[medium];
  const ref: Positional = { name: "ref", help: `The ${medium}: ${TITLE_REF}.`, ref: "title" };
  const entryId: Positional = { name: "entryId", help: "The entry id (n_...), from `get` or `history`." };
  const ex = (rest: string): string => `life ${medium} ${rest}`;
  const notes = mediumNotes(medium);
  const layerOf = (command: CommandDef): Layer => ({ kind: "command", command });
  const formatExample = medium === "book" ? " --format audiobook" : "";

  const add: CommandDef = define(medium, {
    name: "add",
    summary: `Add a ${medium} (curious; --want for the backlog, --started or --finished for the diary), looked up at ${source}`,
    description: `Creates one title. The name is checked against the ${medium}s in the library (a match is exit 2 with the candidates unless --allow-duplicate), then looked up at ${source} unless --no-lookup or --catalog: one confident match links it and fills its facts and availability; several candidates are a needs on catalog with error.candidates (a terminal asks, a program retries with --catalog <id> or --year); no key, a source that is down, or the lookup budget running out create the title without a catalog and warn. --want, --started (with --progress, --minutes), --finished (with --rating, --review), and --seen-before compose the diary in one call.`,
    positionals: [{ name: "name", help: `The ${medium}'s name as he said it; the catalog's name replaces it when it contains every word of his, and his stays as an alias.` }],
    flags: titleAddFlags(medium),
    examples: [
      ex(`add "${s.one}" --actor codex --json`),
      ex(`add "${s.two}" --want --priority soon --actor codex --evidence "chat:2026-09-12 \\"wants to ${medium === "book" ? "read" : medium === "game" ? "play" : "watch"} it\\"" --json`),
      ex(`add "${s.one}" --finished --on 2026-09-07~w --rating 4.5 --liked${formatExample} --actor codex --json`),
      ex(`add "${s.one}" --year 2016 --catalog 329865 --seen-before 2019 --finished --review "still a 5" --actor neel`),
    ],
    notes,
    exits: [...EXITS.add],
    mutates: true,
    async run(inv) {
      const f = inv.flags;
      const layer = layerOf(add);
      const started = f.bool("started");
      const finished = f.bool("finished");
      if ((f.has("rating") || f.has("review")) && !finished) throw new UsageError(`life ${medium} add: --rating and --review need --finished (a rated rewatch is --seen-before --finished; on a title already in the library use \`life ${medium} again --finished\`)`, { layer });
      if ((f.has("progress") || f.has("minutes")) && !started) throw new UsageError(`life ${medium} add: --progress and --minutes need --started`, { layer });
      if (f.has("started-on") && !started) throw new UsageError(`life ${medium} add: --started-on needs --started`, { layer });
      if (f.has("finished-on") && !finished) throw new UsageError(`life ${medium} add: --finished-on needs --finished`, { layer });
      if (f.has("catalog") && f.bool("no-lookup")) throw new UsageError("--catalog and --no-lookup exclude each other", { layer });
      const on = onFlag(inv, "on");
      const startedOn = onFlag(inv, "started-on") ?? on;
      const finishedOn = onFlag(inv, "finished-on") ?? on;
      const seenBefore = f.has("seen-before") ? (f.str("seen-before") === undefined ? true : onFlag(inv, "seen-before")) : undefined;
      const input = compact({
        medium,
        name: inv.args[0]!,
        year: f.int("year"),
        catalog: f.str("catalog"),
        lookup: f.bool("no-lookup") ? false : undefined,
        want: f.bool("want") || undefined,
        started: started ? compact({ on: startedOn, progress: f.str("progress"), minutes: f.int("minutes") }) : undefined,
        finished: finished ? compact({ on: finishedOn, rating: ratingFlag(inv), text: f.str("review") }) : undefined,
        seenBefore,
        liked: f.bool("liked") || undefined,
        priority: f.str("priority"),
        moodFit: moodFlags(inv),
        timeFit: f.str("fit"),
        notes: f.str("notes"),
        detail: detailFlags(inv, false),
        allowDuplicate: f.bool("allow-duplicate") || undefined,
      });
      return rendered(inv, add, await ops(inv).add(input as TitleAdd, inv.ctx()));
    },
  });

  const get: CommandDef = define(medium, {
    name: "get",
    summary: `Show one ${medium} in full: facts, the take, the diary (deleted included by id)`,
    positionals: [ref],
    flags: {},
    examples: [ex(`get "${s.one}" --json`), ex("get m_abc123def0")],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const found = await ops(inv).resolve(inv.args[0]!, { includeDeleted: true });
      if (!found.ok) return unresolved(get, found, inv.args[0]!);
      return { code: EXIT.ok, result: found.title, text: () => titleDetail(found.title) };
    },
  });

  const list: CommandDef = define(medium, {
    name: "list",
    summary: `List ${medium}s as compact summaries, by status, ownership, priority, mood, fit, or text (dropped hidden by default)`,
    description: "Sorted by status (active, paused, backlog, curious, done, dropped), then priority (now, soon, later, none), then name. Every criterion must hold.",
    positionals: [],
    flags: mediumFlags(medium, { status: STATUS_LIST_FLAG, ownership: OWNERSHIP_LIST_FLAG, priority: PRIORITY_FLAG, mood: MOOD_FLAG, fit: FIT_FLAG, format: FORMAT_FILTER_FLAG, text: TEXT_FILTER_FLAG, deleted: { kind: "bool", help: "Include deleted titles." }, full: FULL_FLAG }),
    examples: [ex("list --json"), ex("list --status active,paused --json"), ex(`list --text "${s.one.split(" ")[0]}" --full --json`)],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const f = inv.flags;
      const criteria = compact({
        medium,
        status: csvFlag(inv, "status"),
        ownership: csvFlag(inv, "ownership"),
        priority: f.str("priority"),
        moodFit: f.str("mood"),
        timeFit: f.str("fit"),
        format: f.str("format"),
        text: f.str("text"),
        includeDeleted: f.bool("deleted") || undefined,
        full: f.bool("full") || undefined,
      });
      return renderedTitles(await ops(inv).list(criteria as TitleList), false, `No ${medium}s.`);
    },
  });

  const update: CommandDef = define(medium, {
    name: "update",
    summary: `Change a ${medium}'s name, aliases, year, creators, cover, series, priority, moods, fit, detail, or notes`,
    description: "Pass at least one flag; a --no-<field> flag clears it. Name, year, creators, and cover are factual: changing one lists it in edited, so refresh leaves it alone. Status, ownership, rating, and review are derived from the diary and cannot be set here.",
    positionals: [ref],
    flags: titleUpdateFlags(medium),
    examples: [ex(`update "${s.one}" --priority now --mood comfort --fit ${medium === "movie" ? "medium" : "long"} --actor codex --json`), ex(`update "${s.series}" --series "${s.series}" --position 1 --actor neel`), ex(`update "${s.one}" --no-priority --notes "buy on sale" --actor neel --json`)],
    exits: [...EXITS.write],
    mutates: true,
    async run(inv) {
      const f = inv.flags;
      const layer = layerOf(update);
      const aliasList = f.list("alias");
      if (f.bool("no-alias") && aliasList.length) throw new UsageError("--alias and --no-alias exclude each other", { layer });
      if (f.has("series") && f.bool("no-series")) throw new UsageError("--series and --no-series exclude each other", { layer });
      if (f.has("position") && !f.has("series")) throw new UsageError("--position needs --series", { layer, hint: 'pass --series "Name" --position 2' });
      const seriesName = f.str("series");
      const input = compact({
        name: f.str("name"),
        aliases: f.bool("no-alias") ? [] : aliasList.length ? aliasList : undefined,
        year: f.clearableInt("year"),
        creators: csvFlag(inv, "creators"),
        cover: f.clearable("cover"),
        series: f.bool("no-series") ? null : seriesName !== undefined ? { name: seriesName, position: f.int("position") ?? null } : undefined,
        priority: f.clearable("priority"),
        moodFit: moodFlags(inv),
        timeFit: f.clearable("fit"),
        notes: f.clearable("notes"),
        detail: detailFlags(inv, true),
      });
      if (!Object.keys(input).length) throw new UsageError(`life ${medium} update: nothing to change; pass at least one flag`, { layer });
      return rendered(inv, update, await ops(inv).update(inv.args[0]!, input as TitleUpdate, inv.ctx()));
    },
  });

  /** The entry commands that take the ref alone: one entry of that type, judged by `allowed`. */
  const entryVerb = (name: "want" | "pause" | "start" | "resume" | "buy" | "borrow" | "return" | "service", summary: string, flags: MediumFlagSpec, examples: string[], description?: string): CommandDef => {
    const def: CommandDef = define(medium, {
      name,
      summary,
      ...(description ? { description } : {}),
      positionals: [ref],
      flags: mediumFlags(medium, flags),
      examples,
      notes,
      exits: [...EXITS.write],
      mutates: true,
      async run(inv) {
        if ((name === "borrow" || name === "service") && !inv.flags.has("where")) throw new UsageError(`life ${medium} ${name}: pass --where <${name === "borrow" ? "lender" : "service"}>`, { layer: layerOf(def) });
        return rendered(inv, def, await ops(inv)[name](inv.args[0]!, entryInput(inv), inv.ctx()));
      },
    });
    return def;
  };

  const want = entryVerb("want", "He wants it: backlog (from curious)", { on: ON_FLAG, text: TEXT_FLAG }, [ex(`want "${s.two}" --actor codex --evidence "chat:2026-09-12 \\"want to get to it\\"" --json`)]);
  const pause = entryVerb("pause", "He set it aside for now: paused (from active)", { on: ON_FLAG, text: TEXT_FLAG }, [ex(`pause "${s.one}" --text "waiting for the next season" --actor codex --json`)]);
  const START_FLAGS: MediumFlagSpec = { on: ON_FLAG, progress: PROGRESS_FLAG, minutes: MINUTES_FLAG, format: FORMAT_FLAG, text: TEXT_FLAG };
  const start = entryVerb("start", "He started it: active (from curious, backlog, paused, or dropped); --progress says where he is", START_FLAGS, [ex(`start "${s.one}"${formatExample} --actor codex --json`), ex(`start "${s.two}" --progress "2 hours in" --minutes 120 --on 2026-09-11 --actor codex --json`)]);
  const resume = entryVerb("resume", "He picked it up again: active (from paused)", START_FLAGS, [ex(`resume "${s.one}" --actor codex --json`)]);
  const buy = entryVerb(
    "buy",
    "He bought it: owned; --where names the store, --price the spend",
    { where: { ...WHERE_FLAG, help: "The store." }, price: { kind: "value", type: "number", help: "What it cost." }, currency: { kind: "value", type: "code", help: "Three-letter currency code; needs --price.", default: "from LIFE_REGION (USD for US)" }, kind: { kind: "value", values: SPEND_KINDS, help: "What kind of spend; needs --price.", default: "purchase" }, on: ON_FLAG },
    [ex(`buy "${s.two}" --where "${medium === "game" ? "Nintendo eShop" : medium === "book" ? "Audible" : "Apple TV"}" --price 59.99 --actor codex --json`), ex(`buy "${s.one}" --on 2026-08 --actor neel`)],
    "Ownership is independent of progress (LEISURE D88): buying changes nothing about whether he is on it.",
  );
  const borrow = entryVerb("borrow", "He borrowed it: borrowed; --where names the lender", { where: { ...WHERE_FLAG, help: "The lender (a library, a friend). Required." }, on: ON_FLAG }, [ex(`borrow "${s.one}" --where Libby --actor codex --json`)]);
  const returnCmd = entryVerb("return", "He returned or let go of it: ownership none (from owned, borrowed, or service)", { on: ON_FLAG }, [ex(`return "${s.one}" --actor codex --json`)]);
  const service = entryVerb("service", "It is on a service he has: ownership service; --where names it", { where: { ...WHERE_FLAG, help: "The service he has it on (Game Pass, Netflix, Audible). Required." }, on: ON_FLAG }, [ex(`service "${s.two}" --where "${medium === "game" ? "Game Pass" : medium === "book" ? "Audible" : "Netflix"}" --actor codex --json`)], "Only when he says he has it there; availability at a service he does not have is `where`, not an entry.");

  const again: CommandDef = define(medium, {
    name: "again",
    summary: "He is on it again: a new cycle (from done); --finished closes it in the same call for a one-sitting rewatch",
    positionals: [ref],
    flags: mediumFlags(medium, { on: ON_FLAG, finished: { kind: "bool", help: "Also finish it now, in the same transaction, with --rating, --review, --minutes." }, rating: { ...RATING_FLAG, help: `Rating on the finish; needs --finished. ${RATING_HELP}.` }, liked: LIKED_FLAG, review: { ...REVIEW_FLAG, help: "The review on the finish; needs --finished." }, minutes: MINUTES_FLAG, format: FORMAT_FLAG, text: TEXT_FLAG }),
    examples: [ex(`again "${s.one}" --finished --rating 5 --actor codex --json`), ex(`again "${s.one}"${formatExample} --actor neel`)],
    notes,
    exits: [...EXITS.write],
    mutates: true,
    async run(inv) {
      const finished = inv.flags.bool("finished");
      if ((inv.flags.has("rating") || inv.flags.has("review")) && !finished) throw new UsageError(`life ${medium} again: --rating and --review need --finished`, { layer: layerOf(again) });
      return rendered(inv, again, await ops(inv).again(inv.args[0]!, entryInput(inv), inv.ctx(), finished ? { finished: true } : {}));
    },
  });

  const progress: CommandDef = define(medium, {
    name: "progress",
    summary: "Where he is, as free text (S2E4, ch. 12, 10 hours in); --minutes for this sitting",
    positionals: [ref, { name: "text", help: "The progress, in his words." }],
    flags: { on: ON_FLAG, minutes: MINUTES_FLAG },
    examples: [ex(`progress "${s.one}" "${medium === "show" ? "S2E4" : medium === "book" ? "ch. 12" : medium === "game" ? "10 hours in" : "halfway"}" --minutes 45 --actor codex --json`)],
    notes,
    exits: [...EXITS.write],
    mutates: true,
    async run(inv) {
      const input = compact({ progress: inv.args[1]!, on: onFlag(inv, "on"), minutes: inv.flags.int("minutes") }) as EntryInput;
      return rendered(inv, progress, await ops(inv).progress(inv.args[0]!, input, inv.ctx()));
    },
  });

  const note: CommandDef = define(medium, {
    name: "note",
    summary: "A dated reflection about the title, in full (it stays here, not in the vault)",
    positionals: [ref, { name: "text", help: "The note, in his words." }],
    flags: { on: ON_FLAG },
    examples: [ex(`note "${s.one}" "the second act drags but the ending lands" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, note, await ops(inv).note(inv.args[0]!, compact({ text: inv.args[1]!, on: onFlag(inv, "on") }) as EntryInput, inv.ctx())),
  });

  const finish: CommandDef = define(medium, {
    name: "finish",
    summary: "He finished it: done (from anything but done), with a rating and a review; names the next in a series",
    description: "A finish on a done title is refused with the hint to use `again`. When the title is in a series the receipt carries `next` and a warning names it; --queue-next adds that entry to the backlog in the same call.",
    positionals: [ref],
    flags: mediumFlags(medium, { on: ON_FLAG, rating: RATING_FLAG, liked: LIKED_FLAG, review: REVIEW_FLAG, format: FORMAT_FLAG, minutes: MINUTES_FLAG, "queue-next": { kind: "bool", help: "Add the next work in the series to the backlog (want) in the same transaction." } }),
    examples: [ex(`finish "${s.one}" --on 2026-08-31~w --rating 4.5 --liked --actor codex --json`), ex(`finish "${s.series}" --review "a very bad ${medium} that delivered neither horror nor comedy" --queue-next --actor codex --json`)],
    notes,
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, finish, await ops(inv).finish(inv.args[0]!, entryInput(inv), inv.ctx(), inv.flags.bool("queue-next") ? { queueNext: true } : {})),
  });

  const drop: CommandDef = define(medium, {
    name: "drop",
    summary: "He gave up on it: dropped (from backlog, active, or paused); the text is his reason and the review",
    positionals: [ref, { name: "text", help: "Why, in his words; quote him fully, it doubles as the review." }],
    flags: { on: ON_FLAG, rating: RATING_FLAG, liked: LIKED_FLAG },
    examples: [ex(`drop "${s.one}" "not fun anymore, the difficulty spikes are the problem" --actor codex --json`)],
    notes,
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, drop, await ops(inv).drop(inv.args[0]!, entryInput(inv, { text: inv.args[1]! }), inv.ctx())),
  });

  const rate: CommandDef = define(medium, {
    name: "rate",
    summary: "Set the rating on the latest finish or drop (or on --entry)",
    positionals: [ref, { name: "rating", help: `The rating: ${RATING_HELP}.` }],
    flags: { entry: ENTRY_FLAG },
    examples: [ex(`rate "${s.one}" 4.5 --actor codex --json`), ex(`rate "${s.one}" 4½ --entry n_abc123def0 --actor neel`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, rate, await ops(inv).rate(inv.args[0]!, parseRating(inv.args[1]!, "<rating>"), inv.ctx(), compact({ entry: inv.flags.str("entry") }))),
  });

  const unrate: CommandDef = define(medium, {
    name: "unrate",
    summary: "Clear the rating on the latest finish or drop (or on --entry)",
    positionals: [ref],
    flags: { entry: ENTRY_FLAG },
    examples: [ex(`unrate "${s.one}" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, unrate, await ops(inv).unrate(inv.args[0]!, inv.ctx(), compact({ entry: inv.flags.str("entry") }))),
  });

  const review: CommandDef = define(medium, {
    name: "review",
    summary: "Set the review on the latest finish or drop (or on --entry)",
    positionals: [ref, { name: "text", help: "The review, in his words." }],
    flags: { entry: ENTRY_FLAG },
    examples: [ex(`review "${s.one}" "comfy listen, nothing more" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, review, await ops(inv).review(inv.args[0]!, inv.args[1]!, inv.ctx(), compact({ entry: inv.flags.str("entry") }))),
  });

  const likeVerb = (name: "like" | "unlike"): CommandDef => {
    const def: CommandDef = define(medium, {
      name,
      summary: name === "like" ? "Mark the title liked (a title field; fine on an unfinished title he is loving)" : "Take the liked mark off",
      positionals: [ref],
      flags: {},
      examples: [ex(`${name} "${s.one}" --actor codex --json`)],
      exits: [...EXITS.write],
      mutates: true,
      run: async (inv) => rendered(inv, def, await ops(inv)[name](inv.args[0]!, inv.ctx())),
    });
    return def;
  };

  const where: CommandDef = define(medium, {
    name: "where",
    summary: `Where to get it: the title's availability from ${source} (every service alike), or a catalog id's live`,
    positionals: [{ ...ref, optional: true, help: `The ${medium}: ${TITLE_REF}. Or pass --catalog instead.` }],
    flags: { catalog: { kind: "value", type: "id", help: `A ${source} id to ask live, without a title (from \`lookup\`).` } },
    examples: [ex(`where "${s.one}"`), ex("where --catalog 329865 --json")],
    exits: [EXIT.ok, EXIT.rejected, EXIT.catalog, EXIT.usage],
    mutates: false,
    async run(inv) {
      const target = inv.args[0];
      const catalog = inv.flags.str("catalog");
      if (target !== undefined && catalog !== undefined) throw new UsageError(`life ${medium} where: pass a ref or --catalog, not both`, { layer: layerOf(where) });
      if (target === undefined && catalog === undefined) throw new UsageError(`life ${medium} where: pass a ref or --catalog <id>`, { layer: layerOf(where) });
      if (catalog !== undefined) {
        const rows = await ops(inv).where({ catalog, medium });
        return { code: EXIT.ok, result: rows, text: () => (rows.length ? availabilityText(rows) : `No availability for ${source} ${catalog} in ${inv.region}.`) };
      }
      const found = await ops(inv).resolve(target!, { includeDeleted: true });
      if (!found.ok) return unresolved(where, found, target!);
      const rows = found.title.facts?.availability ?? [];
      const empty = found.title.catalog ? `No availability on record for ${found.title.name} in ${inv.region}; \`life media availability ${found.title.id}\` re-pulls it.` : `${found.title.name} has no catalog; \`life ${medium} refresh ${found.title.id}\` links one.`;
      return { code: EXIT.ok, result: rows, text: () => (rows.length ? availabilityText(rows) : empty) };
    },
  });

  const next: CommandDef = define(medium, {
    name: "next",
    summary: "The next work in the title's series and whether it is in the library; --queue adds it to the backlog",
    positionals: [ref],
    flags: { queue: { kind: "bool", help: "Add the next work as a backlog title (want), with the series as evidence; a write, so --actor applies." } },
    examples: [ex(`next "${s.series}" --json`), ex(`next "${s.series}" --queue --actor codex --json`)],
    exits: [...EXITS.add],
    mutates: false,
    async run(inv) {
      const found = await ops(inv).resolve(inv.args[0]!);
      if (!found.ok) return unresolved(next, found, inv.args[0]!);
      const view = await ops(inv).next(found.title.id);
      if (!view) return plain(EXIT.ok, null, `${found.title.name} is not in a series, or is its last entry.`);
      if (!inv.flags.bool("queue")) return { code: EXIT.ok, result: view, text: () => nextText(found.title, view) };
      if (view.title) {
        inv.warnings.push(`"${view.seriesEntry.name}" is already in the library as ${view.title.id} (${view.title.status}); nothing queued`);
        return { code: EXIT.ok, result: view, text: () => nextText(found.title, view) };
      }
      const ctx = inv.ctx();
      const queued = await ops(inv).add(
        compact({ medium, name: view.seriesEntry.name, catalog: view.seriesEntry.externalId ?? undefined, want: true }) as TitleAdd,
        { ...ctx, evidence: [...(ctx.evidence ?? []), `series:${found.title.id}`] },
      );
      return rendered(inv, next, queued);
    },
  });

  const series: CommandDef = define(medium, {
    name: "series",
    summary: "The title's series in order, with his status on each entry",
    positionals: [ref],
    flags: {},
    examples: [ex(`series "${s.series}" --json`)],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const found = await ops(inv).resolve(inv.args[0]!, { includeDeleted: true });
      if (!found.ok) return unresolved(series, found, inv.args[0]!);
      const view = await ops(inv).series(found.title.id);
      if (!view) return plain(EXIT.ok, null, `${found.title.name} is not in a series (set one with \`life ${medium} update ${found.title.id} --series "Name" --position n\`).`);
      return { code: EXIT.ok, result: view, text: () => seriesText(view) };
    },
  });

  const lookup: CommandDef = define(medium, {
    name: "lookup",
    summary: `Search ${source} without creating a title; --where adds where each hit is available`,
    description: `The candidates with their ids, years, creators, and category (a DLC, edition, or remake never auto-links), and \`inLibrary\` when a title is already linked to one. "Where can I watch X" is \`lookup "X" --where\`. Exit 3 when ${source} cannot be reached; exit 1 when its key is not set.`,
    positionals: [{ name: "text", help: "The name to search." }],
    flags: { year: { kind: "value", type: "integer", help: "Narrow the search to this release year." }, where: { kind: "bool", help: "Add availability: on the one confident match, else on up to three candidates." } },
    examples: [ex(`lookup "${s.two}" --where --json`), ex(`lookup "${s.one}" --year 2016 --json`)],
    exits: [EXIT.ok, EXIT.rejected, EXIT.catalog, EXIT.usage],
    mutates: false,
    async run(inv) {
      const candidates = await ops(inv).catalog.search(medium, inv.args[0]!, compact({ year: inv.flags.int("year"), availability: inv.flags.bool("where") || undefined }));
      return { code: EXIT.ok, result: candidates, text: () => (candidates.length ? candidateTable(candidates) : `No ${source} candidates for "${inv.args[0]}".`) };
    },
  });

  const link: CommandDef = define(medium, {
    name: "link",
    summary: `Link the title to a ${source} id and fill its facts (fields he edited are kept)`,
    positionals: [ref, { name: "externalId", help: `The ${source} id, from \`lookup\` or a catalog needs.` }],
    flags: {},
    examples: [ex(`link "${s.one}" 329865 --actor codex --json`)],
    exits: [EXIT.ok, EXIT.rejected, EXIT.duplicate, EXIT.catalog, EXIT.database, EXIT.usage],
    mutates: true,
    run: async (inv) => rendered(inv, link, await ops(inv).catalog.link(inv.args[0]!, inv.args[1]!, inv.ctx())),
  });

  const unlink: CommandDef = define(medium, {
    name: "unlink",
    summary: "Drop the catalog link and facts; name, year, creators, cover, and length stay",
    positionals: [ref],
    flags: {},
    examples: [ex(`unlink "${s.one}" --actor neel --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, unlink, await ops(inv).catalog.unlink(inv.args[0]!, inv.ctx())),
  });

  const refresh: CommandDef = define(medium, {
    name: "refresh",
    summary: `Re-pull facts and availability from ${source}; on a title without a catalog, look it up now`,
    description: "Fields he edited and a hand-set series are left alone. When nothing changed the outcome is unchanged. On a title with no catalog this is the same lookup add runs, with the same needs on catalog: answer it with `link <ref> <id>`.",
    positionals: [ref],
    flags: {},
    examples: [ex(`refresh "${s.one}" --actor codex --json`)],
    exits: [EXIT.ok, EXIT.rejected, EXIT.catalog, EXIT.usage],
    mutates: true,
    run: async (inv) => rendered(inv, refresh, await ops(inv).catalog.refresh(inv.args[0]!, inv.ctx())),
  });

  const merge: CommandDef = define(medium, {
    name: "merge",
    summary: "Fold one title into another of the same medium: its entries move, moods union, and it goes to the trash",
    positionals: [ref, { name: "into", help: `The surviving title: ${TITLE_REF}.`, ref: "title" }],
    flags: {},
    examples: [ex(`merge m_abc123def0 "${s.one}" --reason "added twice" --actor neel --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, merge, await ops(inv).merge(inv.args[0]!, inv.args[1]!, inv.ctx())),
  });

  const amend: CommandDef = define(medium, {
    name: "amend",
    summary: "Correct an entry: its type, date, text, progress, rating, minutes, format, or where",
    description: "No allowed check: the diary is re-derived from what remains, and any sequence is legal after a correction. Fix a wrong title with `relog`, never by re-adding.",
    positionals: [ref, entryId],
    flags: mediumFlags(medium, AMEND_FLAGS),
    examples: [ex(`amend "${s.one}" n_abc123def0 --on 2026-09-05 --reason "he named the day" --actor codex --json`), ex(`amend "${s.one}" n_abc123def0 --type finish --rating 4 --actor neel`)],
    notes,
    exits: [...EXITS.write],
    mutates: true,
    async run(inv) {
      const f = inv.flags;
      const rating = f.bool("no-rating") ? (f.has("rating") ? (() => { throw new UsageError("--rating and --no-rating exclude each other"); })() : null) : ratingFlag(inv);
      const patch = compact({
        type: f.str("type"),
        on: onFlag(inv, "on"),
        text: f.clearable("text"),
        progress: f.clearable("progress"),
        rating,
        minutes: f.clearableInt("minutes"),
        format: f.clearable("format"),
        where: f.clearable("where"),
      });
      if (!Object.keys(patch).length) throw new UsageError(`life ${medium} amend: nothing to change; pass at least one flag`, { layer: layerOf(amend) });
      return rendered(inv, amend, await ops(inv).amend(inv.args[0]!, inv.args[1]!, patch as EntryPatch, inv.ctx()));
    },
  });

  const unlog: CommandDef = define(medium, {
    name: "unlog",
    summary: "Remove an entry from the diary (the receipt returns it as `removed`); status re-derives",
    positionals: [ref, entryId],
    flags: {},
    examples: [ex(`unlog "${s.one}" n_abc123def0 --reason "logged twice" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, unlog, await ops(inv).unlog(inv.args[0]!, inv.args[1]!, inv.ctx())),
  });

  const relog: CommandDef = define(medium, {
    name: "relog",
    summary: `Move an entry to another ${medium} (the finish went on the wrong title); both re-derive in one transaction`,
    positionals: [ref, entryId],
    flags: { to: { kind: "value", type: "ref", help: `The title the entry belongs to: ${TITLE_REF}.`, ref: "title" } },
    examples: [ex(`relog "${s.one}" n_abc123def0 --to "${s.two}" --reason "wrong title" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    async run(inv) {
      const to = inv.flags.str("to");
      if (to === undefined) throw new UsageError(`life ${medium} relog: pass --to <ref>`, { layer: layerOf(relog) });
      return rendered(inv, relog, await ops(inv).relog(inv.args[0]!, inv.args[1]!, to, inv.ctx()));
    },
  });

  const viewCommand = (name: "now" | "curious" | "backlog" | "buy-list" | "shelf", summary: string, flags: MediumFlagSpec, examples: string[]): CommandDef => {
    const def: CommandDef = define(medium, {
      name,
      summary,
      positionals: [],
      flags: mediumFlags(medium, flags),
      examples,
      exits: [...EXITS.read],
      mutates: false,
      async run(inv) {
        const f = inv.flags;
        const opts = { full: f.bool("full") || undefined };
        switch (name) {
          case "now":
            return renderedTitles(await media(inv).now(medium, opts), false, `Nothing active or paused among ${medium}s.`);
          case "curious":
            return renderedTitles(await media(inv).curious(medium, opts), false, `No curious ${medium}s.`);
          case "backlog":
            return renderedTitles(await media(inv).backlog(medium, compact({ ...opts, mood: f.str("mood"), fit: f.str("fit"), format: f.str("format"), service: f.str("service"), wantedAgain: f.bool("wanted-again") || undefined })), false, `Nothing in the ${medium} backlog he can start now.`);
          case "buy-list": {
            const items = await media(inv).buy(medium, opts);
            return { code: EXIT.ok, result: items, text: () => (items.length ? buyText(items, false) : `Nothing to buy: every backlog ${medium} is owned, borrowed, or on a service.`) };
          }
          case "shelf": {
            const view = await media(inv).shelf(medium, opts);
            return { code: EXIT.ok, result: view, text: () => shelfText(view, false) };
          }
        }
      },
    });
    return def;
  };

  const now = viewCommand("now", `The ${medium}s he is on: active first, then paused, by last entry`, { full: FULL_FLAG }, [ex("now --json")]);
  const curious = viewCommand("curious", `${medium[0]!.toUpperCase()}${medium.slice(1)}s noticed but not wanted, newest first`, { full: FULL_FLAG }, [ex("curious --json")]);
  const backlog = viewCommand("backlog", `Backlog ${medium}s he can start now (owned, borrowed, or on a service), by priority; --wanted-again adds replays`, BACKLOG_FLAGS, [ex("backlog --json"), ex(`backlog --fit short --mood low-energy --json`)]);
  const buyList = viewCommand("buy-list", `Backlog ${medium}s he does not have yet, with where to get each and the lowest price`, { full: FULL_FLAG }, [ex("buy-list --json")]);
  const shelf = viewCommand("shelf", `Owned ${medium}s in four buckets: done, in progress, untouched, dropped`, { full: FULL_FLAG }, [ex("shelf --json")]);

  const deleteCmd: CommandDef = define(medium, {
    name: "delete",
    summary: "Delete a title (to the trash; `restore` undoes it); the way to dismiss a curious mention",
    positionals: [ref],
    flags: {},
    examples: [ex(`delete "${s.one}" --reason "not interested after all" --actor codex --json`)],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, deleteCmd, await ops(inv).delete(inv.args[0]!, inv.ctx())),
  });

  const restore: CommandDef = define(medium, {
    name: "restore",
    summary: "Undelete a title (by id; deleted titles are in `life trash`)",
    positionals: [POS.titleId],
    flags: {},
    examples: [ex("restore m_abc123def0 --actor neel --json")],
    exits: [...EXITS.write],
    mutates: true,
    run: async (inv) => rendered(inv, restore, await ops(inv).restore(inv.args[0]!, inv.ctx())),
  });

  const history: CommandDef = define(medium, {
    name: "history",
    summary: "Every logged change to a title, oldest first (entry ids are in the patches)",
    positionals: [ref],
    flags: {},
    examples: [ex(`history "${s.one}" --json`)],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const found = await ops(inv).resolve(inv.args[0]!, { includeDeleted: true });
      if (!found.ok) return unresolved(history, found, inv.args[0]!);
      const entries = await ops(inv).history(found.title.id);
      return plain(EXIT.ok, entries, historyText(entries));
    },
  });

  return [add, get, list, update, want, start, resume, pause, progress, note, again, finish, drop, buy, borrow, returnCmd, service, rate, unrate, review, likeVerb("like"), likeVerb("unlike"), where, next, series, lookup, link, unlink, refresh, merge, amend, unlog, relog, now, curious, backlog, buyList, shelf, deleteCmd, restore, history];
}

// ------------------------------------------------------------------ library: life media

function mediaCommands(): CommandDef[] {
  const mediumOf = (inv: Setup): Medium | undefined => inv.flags.str("medium") as Medium | undefined;
  const ref: Positional = { name: "ref", help: `The title, in any medium: ${TITLE_REF}.`, ref: "title" };

  const list: CommandDef = define("media", {
    name: "list",
    summary: "List titles across media as compact summaries, by medium, status, ownership, priority, mood, fit, or text",
    description: "Sorted by status (active, paused, backlog, curious, done, dropped), then priority, then name. Dropped titles are hidden unless --status names them.",
    positionals: [],
    flags: { medium: MEDIUM_FLAG, status: STATUS_LIST_FLAG, ownership: OWNERSHIP_LIST_FLAG, priority: PRIORITY_FLAG, mood: MOOD_FLAG, fit: FIT_FLAG, text: TEXT_FILTER_FLAG, deleted: { kind: "bool", help: "Include deleted titles." }, full: FULL_FLAG },
    examples: ["life media list --json", "life media list --medium book --status active,paused --json", 'life media list --text "dune" --json'],
    notes: MEDIA_NOTES,
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const f = inv.flags;
      const criteria = compact({
        medium: mediumOf(inv),
        status: csvFlag(inv, "status"),
        ownership: csvFlag(inv, "ownership"),
        priority: f.str("priority"),
        moodFit: f.str("mood"),
        timeFit: f.str("fit"),
        text: f.str("text"),
        includeDeleted: f.bool("deleted") || undefined,
        full: f.bool("full") || undefined,
      });
      return renderedTitles(await inv.tools.title.list(criteria as TitleList), true, "No titles.");
    },
  });

  const get: CommandDef = define("media", {
    name: "get",
    summary: "Show one title of any medium in full (deleted included by id)",
    positionals: [ref],
    flags: {},
    examples: ['life media get "Skyward" --json', "life media get m_abc123def0"],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const found = await inv.tools.title.resolve(inv.args[0]!, { includeDeleted: true });
      if (!found.ok) return unresolved(get, found, inv.args[0]!);
      return { code: EXIT.ok, result: found.title, text: () => titleDetail(found.title) };
    },
  });

  const viewCommand = (name: "now" | "curious" | "backlog" | "buy-list" | "shelf", summary: string, flags: FlagSpec, examples: string[]): CommandDef => {
    const def: CommandDef = define("media", {
      name,
      summary,
      positionals: [],
      flags: { medium: MEDIUM_FLAG, ...flags },
      examples,
      exits: [...EXITS.read],
      mutates: false,
      async run(inv) {
        const f = inv.flags;
        const medium = mediumOf(inv);
        const opts = { full: f.bool("full") || undefined };
        switch (name) {
          case "now":
            return renderedTitles(await inv.tools.media.now(medium, opts), true, "Nothing active or paused.");
          case "curious":
            return renderedTitles(await inv.tools.media.curious(medium, opts), true, "No curious titles.");
          case "backlog":
            return renderedTitles(await inv.tools.media.backlog(medium, compact({ ...opts, mood: f.str("mood"), fit: f.str("fit"), format: f.str("format"), service: f.str("service"), wantedAgain: f.bool("wanted-again") || undefined })), true, "Nothing in the backlog he can start now.");
          case "buy-list": {
            const items = await inv.tools.media.buy(medium, opts);
            return { code: EXIT.ok, result: items, text: () => (items.length ? buyText(items, true) : "Nothing to buy: every backlog title is owned, borrowed, or on a service.") };
          }
          case "shelf": {
            const view = await inv.tools.media.shelf(medium, opts);
            return { code: EXIT.ok, result: view, text: () => shelfText(view, true) };
          }
        }
      },
    });
    return def;
  };

  const now = viewCommand("now", "What he is on across media: active first, then paused, by last entry (the current queue)", { full: FULL_FLAG }, ["life media now --json", "life media now --medium game"]);
  const curious = viewCommand("curious", "Titles noticed but not wanted, newest first", { full: FULL_FLAG }, ["life media curious --json"]);
  const backlog = viewCommand("backlog", "Backlog titles he can start now (owned, borrowed, or on a service), by priority", mediumFlags("book", BACKLOG_FLAGS), ["life media backlog --json", "life media backlog --fit short --mood low-energy --json"]);
  const buyList = viewCommand("buy-list", "Backlog titles he does not have yet, with where to get each and the lowest price", { full: FULL_FLAG }, ["life media buy-list --json"]);
  const shelf = viewCommand("shelf", "Owned titles in four buckets: done, in progress, untouched, dropped", { full: FULL_FLAG }, ["life media shelf --json", "life media shelf --medium book"]);

  const diary: CommandDef = define("media", {
    name: "diary",
    summary: "Entries across titles, newest first, in a date range (entries dated ? are left out)",
    positionals: [],
    flags: { since: SINCE_FLAG, until: UNTIL_FLAG, medium: MEDIUM_FLAG, limit: { kind: "value", type: "integer", help: "At most this many entries." } },
    examples: ["life media diary --since 2026-09 --json", "life media diary --since 2026-09-07~w --until 2026-09-07~w --medium book --limit 20 --json"],
    notes: MEDIA_NOTES,
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const view = await inv.tools.media.diary(compact({ medium: mediumOf(inv), since: boundFlag(inv, "since"), until: boundFlag(inv, "until"), limit: inv.flags.int("limit") }));
      return { code: EXIT.ok, result: view, text: () => diaryText(view) };
    },
  });

  const time: CommandDef = define("media", {
    name: "time",
    summary: "Minutes and spend by ISO week and by title, over the last weeks or a date range",
    positionals: [],
    flags: { since: SINCE_FLAG, until: UNTIL_FLAG, weeks: { kind: "value", type: "integer", help: "How many weeks back from today, 1 to 520, when no range is given.", default: "8" }, medium: MEDIUM_FLAG },
    examples: ["life media time --json", "life media time --since 2026-09 --json", "life media time --weeks 12 --medium game --json"],
    notes: MEDIA_NOTES,
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const view = await inv.tools.media.time(compact({ medium: mediumOf(inv), since: boundFlag(inv, "since"), until: boundFlag(inv, "until"), weeks: inv.flags.int("weeks") }));
      return { code: EXIT.ok, result: view, text: () => timeText(view) };
    },
  });

  const year: CommandDef = define("media", {
    name: "year",
    summary: "Finishes and drops in a calendar year by medium, with ratings; again finishes counted",
    positionals: [{ name: "yyyy", help: "The calendar year." }],
    flags: { medium: MEDIUM_FLAG, full: FULL_FLAG },
    examples: ["life media year 2026 --json", "life media year 2025 --medium movie"],
    exits: [...EXITS.read],
    mutates: false,
    async run(inv) {
      const raw = inv.args[0]!;
      if (!/^\d{4}$/.test(raw)) throw new UsageError(`life media year: <yyyy> must be a four-digit year, got "${raw}"`, { layer: { kind: "command", command: year } });
      const view = await inv.tools.media.year(Number(raw), mediumOf(inv), { full: inv.flags.bool("full") || undefined });
      return { code: EXIT.ok, result: view, text: () => yearText(view) };
    },
  });

  const search: CommandDef = define("media", {
    name: "search",
    summary: "Titles of any medium and status whose name, aliases, creators, notes, review, or any entry text contains the text",
    positionals: [{ name: "text", help: "The text to look for, case-insensitive." }],
    flags: { full: FULL_FLAG },
    examples: ['life media search "difficulty" --json'],
    exits: [...EXITS.read],
    mutates: false,
    run: async (inv) => renderedTitles(await inv.tools.media.search(inv.args[0]!, { full: inv.flags.bool("full") || undefined }), true, "No matches."),
  });

  const availability: CommandDef = define("media", {
    name: "availability",
    summary: "Re-pull availability from the catalogs for one title, or for every backlog title (--backlog), one transaction each",
    description: "Over the backlog a source that fails stops nothing else: the result lists refreshed and failed titles, and the exit is 3 when every failure was a source that could not be reached, 1 otherwise.",
    positionals: [{ ...ref, optional: true, help: `One title: ${TITLE_REF}. Or --backlog for every backlog title.` }],
    flags: { backlog: { kind: "bool", help: "Every backlog title (with --medium, of that medium)." }, medium: MEDIUM_FLAG },
    examples: ['life media availability "Skyward" --actor codex --json', "life media availability --backlog --medium movie --actor codex --json"],
    exits: [EXIT.ok, EXIT.rejected, EXIT.catalog, EXIT.usage],
    mutates: true,
    async run(inv) {
      const target = inv.args[0];
      const backlog = inv.flags.bool("backlog");
      if (target !== undefined && backlog) throw new UsageError("life media availability: pass a ref or --backlog, not both", { layer: { kind: "command", command: availability } });
      if (target === undefined && !backlog) throw new UsageError("life media availability: pass a ref or --backlog", { layer: { kind: "command", command: availability } });
      if (target !== undefined) return rendered(inv, availability, await inv.tools.title.catalog.availability(target, inv.ctx()));
      const report = await inv.tools.title.catalog.availability(compact({ status: "backlog", medium: mediumOf(inv) }) as { status: "backlog"; medium?: Medium }, inv.ctx());
      const issues = report.failed.flatMap((entry) => entry.issues.map((issue) => `${entry.id} (${entry.name}): ${issue}`));
      const unreachable = report.failed.length > 0 && report.failed.every((entry) => entry.issues.some((issue) => issue.startsWith(`${CATALOG_UNAVAILABLE}:`)));
      const code = report.failed.length === 0 ? EXIT.ok : unreachable ? EXIT.catalog : EXIT.rejected;
      const error: EnvelopeError | undefined = report.failed.length
        ? {
            code: unreachable ? "catalog_unavailable" : "rejected",
            message: `${report.failed.length} of ${report.failed.length + report.refreshed.length} titles failed: ${issues.join("; ")}`,
            issues,
            hint: unreachable ? "the catalog source could not be reached; the refreshed titles are stored, retry later or run `life doctor`" : "the refreshed titles are stored; the failed ones name their problem",
          }
        : undefined;
      return { code, result: report, text: () => availabilityReportText(report), ...(error ? { error } : {}) };
    },
  });

  return [list, get, now, curious, backlog, buyList, shelf, diary, time, year, search, availability];
}

// ------------------------------------------------------------------ views and maintenance

const today: CommandDef = {
  group: null,
  name: "today",
  summary: "The day's schedule (events and dated tasks), then overdue, due today, deadlines, and the proposed queue",
  description: "The schedule: the day's all-day events and date-only tasks, then timed events and timed tasks by start (an event awaiting Neel's answer is marked ?; declined ones are dropped, cancelled ones kept). Then the todo lists: accepted and in-progress tasks that are overdue or due on the date, tasks whose deadline is the date or past, and every proposed task. Calendars whose copy is older than LIFE_CAL_MAX_AGE are refreshed first unless --stale; `freshness` in the result says how old each copy is and whether a refresh failed (the view still answers from the copy).",
  positionals: [],
  flags: { date: dateFlagDef("The day to look at"), stale: STALE_FLAG, hidden: HIDDEN_FLAG },
  examples: ["life today --json", "life today --date tomorrow", "life today --stale --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const view = await inv.tools.views.today(compact({ date: dateFlag(inv, "date"), fresh: f.bool("stale") ? false : undefined, includeHidden: f.bool("hidden") || undefined }));
    return {
      code: EXIT.ok,
      result: view,
      text: async () => todayText(view, await projectIndex(inv.tools), await calendarIndex(inv.tools), inv.tz),
      stderr: freshnessLines(inv, view.freshness, view.warnings),
    };
  },
};

const week: CommandDef = {
  group: null,
  name: "week",
  summary: "Events and dated tasks day by day for the coming days",
  description: "One entry per day, empty days included; a multi-day event appears on each day it covers. Overdue tasks are not carried in (that is `today`'s job). Same refresh and freshness rules as `today`.",
  positionals: [],
  flags: {
    from: dateFlagDef("The first day"),
    days: { kind: "value", type: "integer", help: "How many days, 1 to 366.", default: "7" },
    stale: STALE_FLAG,
    hidden: HIDDEN_FLAG,
  },
  examples: ["life week --json", "life week --from 2026-09-14 --days 5", "life week --from tomorrow --days 3 --stale --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const view = await inv.tools.views.week(compact({ from: dateFlag(inv, "from"), days: f.int("days"), fresh: f.bool("stale") ? false : undefined, includeHidden: f.bool("hidden") || undefined }));
    return {
      code: EXIT.ok,
      result: view,
      text: async () => weekText(view, await projectIndex(inv.tools), await calendarIndex(inv.tools), inv.tz),
      stderr: freshnessLines(inv, view.freshness, view.warnings),
    };
  },
};

const slots: CommandDef = {
  group: null,
  name: "slots",
  summary: "Free windows of at least a duration inside working hours, across the connected calendars",
  description: "Busy time is every non-cancelled, non-declined busy occurrence on every non-hidden calendar of every connected account (a hidden calendar named with --calendar counts too). Slots are the maximal free windows at least --duration long, clipped to the hours, from now or --from, whichever is later. Quote them as given; never a booking page.",
  positionals: [],
  flags: {
    duration: { kind: "value", type: "integer", help: "The slot length in minutes." },
    from: { kind: "value", type: DATE_TYPE, help: `First day (from its start, or from now if later): ${DATE_HELP}; or "YYYY-MM-DD HH:MM".`, default: "today" },
    to: { kind: "value", type: DATE_TYPE, help: `Last day (to its end): ${DATE_HELP}; or "YYYY-MM-DD HH:MM".`, default: "six days after --from" },
    hours: { kind: "value", type: "HH:MM-HH:MM", help: "Working hours in the display zone.", default: "09:00-18:00" },
    days: { kind: "value", type: "weekdays", help: "Working days: a range such as mon-fri or sat-sun, or a list such as mon,wed,fri.", default: "mon-fri" },
    calendar: { ...CALENDAR_FLAG, kind: "list", help: `Only these calendars count as busy: ${CALENDAR_REF}. Repeatable.` },
    stale: STALE_FLAG,
  },
  examples: ["life slots --duration 30 --json", "life slots --duration 60 --from tomorrow --to +5d --hours 10:00-16:00 --days mon,wed,fri --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const f = inv.flags;
    const duration = f.int("duration");
    if (duration === undefined) throw new UsageError("life slots: pass --duration <minutes>", { layer: { kind: "command", command: slots } });
    const hours = f.str("hours");
    const days = f.str("days");
    const calendars = f.list("calendar");
    const view = await inv.tools.views.slots(
      compact({
        duration,
        from: dateFlag(inv, "from"),
        to: dateFlag(inv, "to"),
        hours: hours !== undefined || days !== undefined ? { ...hoursFlag(hours ?? "09:00-18:00"), ...(days !== undefined ? { days: weekdaysFlag(days) } : {}) } : undefined,
        calendars: calendars.length ? calendars : undefined,
        fresh: f.bool("stale") ? false : undefined,
      }) as { duration: number },
    );
    return { code: EXIT.ok, result: view, text: () => slotsText(view, inv.tz), stderr: freshnessLines(inv, view.freshness, view.warnings) };
  },
};

const syncCommand: CommandDef = {
  group: null,
  name: "sync",
  summary: "Pull every connected account's calendars and events from the provider",
  description: "The same as `life account sync` with no ref. Run it from a scheduled job on the Mac every few minutes so the views rarely have to refresh; run it by hand when Neel says something just changed. Incremental unless --full.",
  positionals: [],
  flags: { full: { kind: "bool", help: "Discard the stored cursors and list everything again." } },
  examples: ["life sync --json", "life sync --full"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  run: async (inv) => renderedSync(inv, await inv.tools.account.sync(undefined, { full: inv.flags.bool("full") })),
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
  summary: "Every deleted task, project, section, label, filter, event, calendar, account, and title, newest deletion first",
  positionals: [],
  flags: {},
  examples: ["life trash --json"],
  exits: [...EXITS.read],
  mutates: false,
  database: "connect",
  async run(inv) {
    const view = await inv.tools.views.trash();
    return { code: EXIT.ok, result: view, text: async () => trashText(view, await projectIndex(inv.tools), await calendarIndex(inv.tools), await accountIndex(inv.tools), inv.tz) };
  },
};

const exportCommand: CommandDef = {
  group: null,
  name: "export",
  summary: "Dump everything (deleted rows and the log included; never a credential) as JSON, to a file or stdout",
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
      accounts: dump.accounts.length,
      calendars: dump.calendars.length,
      events: dump.events.length,
      titles: dump.titles.length,
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
  examples: ["life migrate", "life migrate --api-url http://127.0.0.1:4319 --json"],
  exits: [EXIT.ok, EXIT.database, EXIT.usage],
  mutates: false,
  // Migration runs on the API server using its configured database.
  database: "migrate",
  run: async (inv) => plain(EXIT.ok, await inv.tools.migrate(), "Database migrated."),
};

// ------------------------------------------------------------------ doctor

const doctor: CommandDef = {
  group: null,
  name: "doctor",
  summary: "Check the setup: env file, database, migrations, Inbox, Google client, accounts and credentials, calendars, catalog keys, region, timezone, actor",
  description: "Runs every check and reports each as ok, warn, or fail. Exit 0 when healthy, 3 when the database cannot be reached (or its URL is unset), 1 for any other failure. For the calendar: whether LIFE_GOOGLE_CLIENT_ID is set (the secret is never shown), each account's status and credential file, whether its token still refreshes (one request to Google per connected account), each calendar's copy age, the primary account, and any credential file that belongs to no live account. For the library: whether each catalog's variables are set (LIFE_TMDB_KEY; LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET; Open Library needs none), whether the IGDB token file is present and not expired, and LIFE_REGION; --online runs one live search per configured source. Never migrates.",
  positionals: [],
  flags: { online: { kind: "bool", help: "Also run one live search per configured catalog source (TMDB, Open Library, IGDB); off by default so doctor stays offline." } },
  examples: ["life doctor", "life doctor --json", "life doctor --online", "life doctor --verbose"],
  exits: [EXIT.ok, EXIT.rejected, EXIT.database, EXIT.usage],
  mutates: false,
  database: "connect",
  async run(setup) {
    const report = await setup.tools.doctor({ online: setup.flags.bool("online"), actor: setup.actor });
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

function doctorText(report: DoctorReport): string {
  const rows = report.checks.map((c) => [c.name, c.status, c.value, c.hint ? `-> ${c.hint}` : ""]);
  return `${table(rows)}\n${report.healthy ? "Healthy." : "Problems found."}`;
}

// ------------------------------------------------------------------ the registry

const GROUP_INFO: Record<GroupName, string> = {
  task: "Tasks: add, list, get, change, move, schedule, complete, cancel, delete, comment, import",
  project: "Projects: the nested tree the tasks live in (the Inbox is the system project)",
  section: "Sections: named groups of tasks inside a project",
  label: "Labels: tags a task or a calendar carries (a task also through its project)",
  filter: "Saved filters and the query grammar",
  account: "Calendar accounts: connect a Google account, list, pick the primary, sync, remove",
  calendar: "Calendars of the connected accounts: list, labels, hidden, colour, order, sync",
  event: "Events: add, list, change, reschedule, move, answer invitations, cancel, delete, restore; every write goes through the provider",
  movie: "Movies: the library and diary for films (TMDB); add, diary entries, take, catalog, series, views",
  show: "Shows: the library and diary for TV (TMDB); the same commands as movie",
  game: "Games: the library and diary for games (IGDB); the same commands, plus --platform",
  book: "Books: the library and diary for books and audiobooks (Open Library); the same commands, plus --format",
  media: "Across media: list, get, now, curious, backlog, buy-list, shelf, diary, time, year, search, availability",
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
  accountAdd,
  accountList,
  accountGet,
  accountRemove,
  accountPrimary,
  accountSync,
  calendarList,
  calendarGet,
  calendarSync,
  calendarUpdate,
  calendarReorder,
  eventAdd,
  eventGet,
  eventList,
  eventUpdate,
  eventReschedule,
  eventMove,
  eventRespond,
  eventCancel,
  eventDelete,
  eventRestore,
  eventDuplicate,
  eventHistory,
  ...MEDIA.flatMap(mediumCommands),
  ...mediaCommands(),
  today,
  week,
  slots,
  syncCommand,
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
      if (def.accepts) {
        // An optional value: taken only when the next token reads as one, else the flag stands alone as a bare `true`.
        if (next !== undefined && !next.startsWith("--") && def.accepts(next)) {
          flags.set(name, "value", next);
          i++;
        } else flags.set(name, "bool", undefined);
        continue;
      }
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
    const shape = def.values && !def.type ? def.values.join("|") : (def.type ?? "value");
    const head = def.kind === "bool" ? `--${name}` : def.accepts ? `--${name} [${shape}]` : `--${name} <${shape}>`;
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

const HEADER = "life: the Life-OS todo list, calendar, and leisure library from a shell. One JSON envelope on stdout when --json is passed or stdout is not a terminal; diagnostics on stderr; stable exit codes.";

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
    "  LIFE_API_URL       API base URL (default http://127.0.0.1:4319); --api-url overrides it.",
    "  LIFE_API_TOKEN     API bearer token; the default local API uses .local/api/token when unset.",
    "  LIFE_ACTOR         The actor when --actor is not passed. Without either, a terminal defaults to neel and a program must pass --actor.",
    "  LIFE_TZ            IANA timezone when --tz is not passed; else the machine's timezone.",
    "  LIFE_DEBUG         Set to 1 for the same output as --verbose.",
    "",
    "API server environment (the CLI never reads backend credentials):",
    "  LIFE_DATABASE_URL  Postgres URL on the API server; loaded from its root .env when unset.",
    "  LIFE_GOOGLE_CLIENT_ID, LIFE_GOOGLE_CLIENT_SECRET  Life-OS's own Google OAuth desktop client, needed for `life account add google` and every sync; in the .env file.",
    "  LIFE_CAL_MAX_AGE   Seconds a calendar copy may be old before a view refreshes it first (default 300). --stale skips the refresh.",
    "  LIFE_CAL_HISTORY_MONTHS  How far back a first or --full sync reaches (default 12).",
    "  LIFE_TMDB_KEY      A TMDB v4 read access token, for movie and show lookups; unset, those titles are created without a catalog (add warns, lookup is rejected).",
    "  LIFE_IGDB_CLIENT_ID, LIFE_IGDB_CLIENT_SECRET  A Twitch developer app, for game lookups at IGDB; same rule when unset. Open Library (books) needs no key.",
    "  LIFE_REGION        Two-letter region for availability and the default currency (default US).",
    `  .env file          ${ENV_FILE}`,
    "  credentials        .local/google/<accountId>.json and .local/igdb/token.json at the repository root; never in the database, a receipt, or the log",
    "",
    "references and formats:",
    "  ids        t_ (task), p_ (project), s_ (section), l_ (label), f_ (filter), a_ (account), c_ (calendar), e_ (event), m_ (title), each followed by ten [a-z0-9] characters; n_ (a diary entry inside a title); every list and receipt shows them",
    `  title      ${TITLE_REF}; \`life <medium> list --text\` and \`life media search\` find them`,
    `  on         ${ON_FORMS}: the date-with-precision every library date flag takes (--on, --started-on, --finished-on, --since, --until)`,
    `  rating     ${RATING_HELP}`,
    "  project    an id, a slug path from the root such as health/dental, or inbox; `life project tree` shows paths and ids",
    "  section    a name within the task's project, or an id; `life section list <project-ref>` shows them",
    "  label      a slug name such as health, or an id; `life label list` shows them",
    "  filter     a saved filter's name or id, or a query; `life help filter` explains the query grammar",
    `  account    ${ACCOUNT_REF}; \`life account list\` shows them`,
    `  calendar   ${CALENDAR_REF}; \`life calendar list --hidden\` shows them`,
    "  event      an id (e_...) for a single event or a series, or an occurrence ref e_xxxxxxxxxx@2026-09-10T16:00:00Z for one occurrence; every list prints them; `life help event` explains refs, when formats, and scopes",
    `  date       ${DATE_HELP}`,
    "  time       HH:MM (24-hour), stored with the effective timezone",
    '  when       "YYYY-MM-DD HH:MM" in the display zone (--tz, else LIFE_TZ, else the machine\'s) for --start/--end, or an instant; YYYY-MM-DD for --date/--end-date (all-day, end exclusive)',
    "  actor      neel, codex, agent:<name>, or import:<provider>; a task added by anyone but neel lands as proposed; sync writes carry import:google",
    "",
    "exit codes:",
    ...EXIT_LINES,
    "",
    "JSON envelope (stdout, one object): { ok, command, exitCode, result?, error?: { code, message, issues, hint?, needs?, candidates?, candidateKind? }, warnings? }",
    "  error.code is one of usage, rejected, duplicate, needs, not_found, db_unavailable, provider_unavailable, provider_rejected, catalog_unavailable, internal; result is the library's return value (receipt, record, list, or view) untouched.",
    "  A `needs` error carries { field, options, message }: ask, then retry with --<field> <option>. error.candidates is Task[] | Title[] | Candidate[] with error.candidateKind task | title | catalog: tasks or titles on a `duplicate`, titles on a `needs` on ref (pass the id), catalog hits on a `needs` on catalog (retry with --catalog <id>, or --year when the message says year differs or several exact matches).",
    "  provider_unavailable (exit 3): the calendar provider could not be reached and nothing was stored; provider_rejected (exit 1): it refused. catalog_unavailable (exit 3): a catalog source could not be reached on lookup, refresh, or availability; `add` never fails for it and warns instead. Views carry `freshness` (copy age per calendar) and `warnings` (a refresh that failed); a library receipt's warnings (a lookup that failed, the next in a series) are lifted into the envelope's `warnings`.",
    "",
    "next: `life doctor` checks the setup; `life help task` lists the task commands; `life help task add` shows every flag with examples; `life help event` explains event refs, when formats, and scopes; `life help book` (or movie, show, game) explains title refs, date forms, ratings, and the entry types.",
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
  if (group === "account") lines.push("", `refs: ${ACCOUNT_REF}. The first account connected is primary; \`life account primary\` moves the flag. Credentials live in .local/google/<accountId>.json, never in the database.`);
  if (group === "calendar") lines.push("", `refs: ${CALENDAR_REF}. Name, timezone, and access come from the provider on sync; labels, hidden, colour, and order are Life-OS's and survive sync.`);
  if (group === "event") lines.push("", ...EVENT_NOTES);
  const notes = groupNotes(group);
  if (notes.length) lines.push("", ...notes);
  lines.push("", "global flags: see `life --help` (--actor is required for every write when not on a terminal).", "", "exit codes:", ...EXIT_LINES);
  return lines.join("\n");
}

/** The notes hook: what a group's help says beyond its command list (the library groups print their conventions here). */
function groupNotes(group: GroupName): string[] {
  if (isMedium(group)) return mediumNotes(group);
  if (group === "media") return MEDIA_NOTES;
  return [];
}

export function commandHelp(command: CommandDef): string {
  const lines = [`life ${commandName(command)}: ${command.summary}`, "", `usage: ${usageLine(command)}`];
  if (command.description) lines.push("", command.description);
  if (command.positionals.length) lines.push("", "positionals:", ...positionalLines(command.positionals));
  lines.push("", Object.keys(command.flags).length ? "flags:" : "flags: none of its own", ...flagLines(command.flags));
  lines.push("", `global flags: --actor --reason --evidence --key --if-version --json --tz --api-url --verbose (see \`life --help\`)${command.mutates ? "; this command writes, so --actor (or LIFE_ACTOR) is required when not on a terminal" : ""}`);
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
        environment: ["LIFE_API_URL", "LIFE_API_TOKEN", "LIFE_DATABASE_URL", "LIFE_ACTOR", "LIFE_TZ", "LIFE_DEBUG", "LIFE_GOOGLE_CLIENT_ID", "LIFE_GOOGLE_CLIENT_SECRET", "LIFE_CAL_MAX_AGE", "LIFE_CAL_HISTORY_MONTHS", "LIFE_TMDB_KEY", "LIFE_IGDB_CLIENT_ID", "LIFE_IGDB_CLIENT_SECRET", "LIFE_REGION"],
        envFile: ENV_FILE,
        exitCodes: Object.entries(EXIT_MEANING).map(([code, meaning]) => ({ code: Number(code), meaning })),
        filterGrammar: FILTER_GRAMMAR,
        text: topHelp(),
      };
    case "group":
      return {
        group: layer.group,
        summary: GROUP_INFO[layer.group],
        commands: commandsOf(layer.group).map(commandData),
        ...(layer.group === "filter" ? { filterGrammar: FILTER_GRAMMAR } : {}),
        ...(layer.group === "event" ? { notes: EVENT_NOTES } : groupNotes(layer.group).length ? { notes: groupNotes(layer.group) } : {}),
        text: groupHelp(layer.group),
      };
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

    const setup: Setup = { args, flags, ctx, today: todayIn(tz, clock.now()), tz, tzSource, actor, actorSource, json: this.#json, verbose: this.#verbose, io, region: "US", trace: this.trace, warnings: this.#warnings };
    this.trace(`command: life ${this.#command}${args.length ? ` ${args.map((a) => JSON.stringify(a)).join(" ")}` : ""}`);
    this.trace(`timezone: ${tz} (${tzSource}); today: ${setup.today}; actor: ${actor ?? "none"} (${actorSource})`);

    const restore = this.#json ? muteStdoutLogging(io) : () => undefined;
    try {
      if (command.database === "none") return await this.emitRendered(await command.run(setup));

      const config = await clientConfig(io.env, flags.str("api-url") ?? io.env.LIFE_API_URL);
      this.trace(`api: ${config.url}`);
      const tools = createClient({ ...config, timezone: tz });
      try {
        if (command.name !== "doctor" && command.name !== "migrate") setup.region = (await tools.info()).region;
        const inv: Invocation = { ...setup, tools };
        if (this.#verbose) await traceRefs(inv, command);
        let result = await command.run(inv);

        // HANDS D54: a `needs` rejection is a question on a terminal, and a rejection naming the flag otherwise. A catalog question lists its candidates (LEISURE D94).
        const interactive = Boolean(io.stdin.isTTY && io.stdout.isTTY) && !this.#json;
        if (result.needs && interactive && command.flags[result.needs.field]?.kind === "value") {
          const answer = await ask(io, result.needs, result.candidates);
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
    } else if (error instanceof ApiError) {
      code = error.code === "invalid_request" ? "rejected" : error.code === "catalog_unconfigured" || error.code === "needs_reauth" ? "rejected" : error.code;
      exitCode = ["api_unavailable", "db_unavailable", "provider_unavailable", "catalog_unavailable"].includes(code) ? EXIT.database : EXIT.rejected;
      message = error.code === "catalog_unavailable" ? `catalog unavailable: ${error.message}` : error.message;
      if (code === "rejected" && isNotFound([message], this.#args)) code = "not_found";
      switch (error.code) {
        case "catalog_unavailable":
        case "provider_unavailable":
          hint = "retry later with the same --key for a write, or run `life doctor`";
          break;
        case "catalog_unconfigured":
          hint = `configure the catalog on the API server (${ENV_FILE}); add --no-lookup creates a title without a catalog`;
          break;
        case "db_unavailable":
          hint = "run `life doctor`; check LIFE_DATABASE_URL on the API server";
          break;
        case "api_unavailable":
          hint = "start `bun run api`; check LIFE_API_URL and LIFE_API_TOKEN; a lost write response is not proof of failure";
          break;
        case "unauthorized":
          hint = "set LIFE_API_TOKEN to the API server's token";
          break;
        case "needs_reauth":
          hint = "run `life account add google` and pick the same account to sign in again";
          break;
        default:
          hint = hintsFor(this.#commandDef, [message]).join("; ") || undefined;
      }
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
      const cause = (error as { cause?: unknown })?.cause;
      if (cause instanceof Error && cause.stack) io.stderr.write(`caused by: ${cause.stack}\n`);
    }

    const envelope: Envelope = {
      ok: false,
      command: this.#command || (layer ? layerName(layer) : ""),
      exitCode,
      error: { code, message, issues: error instanceof ApiError && error.issues?.length ? error.issues : [message], ...(hint ? { hint } : {}) },
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
      for (const line of result.stderr ?? []) this.#io.stderr.write(`life: ${line}\n`);
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

/** With --verbose: how every project, section, label, filter, account, calendar, and event reference resolved, before the command runs. */
async function traceRefs(inv: Invocation, command: CommandDef): Promise<void> {
  const refs: { kind: RefKind; source: string; value: string }[] = [];
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
      } else if (ref.kind === "account") {
        const account = await inv.tools.account.get(ref.value);
        if (account) resolved = `${account.id} (${account.identity}${account.deletedAt ? ", removed" : ""})`;
      } else if (ref.kind === "calendar") {
        const calendar = await inv.tools.calendar.get(ref.value);
        if (calendar) resolved = `${calendar.id} ("${calendar.name}"${calendar.deletedAt ? ", deleted" : ""})`;
      } else if (ref.kind === "event") {
        const event = await inv.tools.event.get(ref.value);
        if (event) resolved = `${"occurrenceId" in event ? event.occurrenceId : event.id} ("${event.title}"${event.deletedAt ? ", deleted" : ""})`;
      } else if (ref.kind === "title") {
        const medium = command.group && isMedium(command.group) ? command.group : undefined;
        const found = await inv.tools.title.resolve(ref.value, compact({ medium, includeDeleted: true }));
        if (found.ok) resolved = `${found.title.id} ("${found.title.name}", ${found.title.medium}${found.title.deletedAt ? ", deleted" : ""})`;
        else if (found.kind === "ambiguous") resolved = `${found.candidates.length} titles: ${found.candidates.map((t) => t.id).join(", ")}`;
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

/**
 * Put the question to the terminal; null when the answer is not one of the
 * options or the input ends first. A catalog question lists its candidates as
 * a numbered table and takes the id or the 1-based number (`options[i-1]`).
 */
async function ask(io: CliIo, needs: Needs, candidates?: Candidate[]): Promise<string | null> {
  const rl = createInterface({ input: io.stdin, terminal: false });
  try {
    if (candidates?.length) io.stdout.write(`${needs.message}\n${candidateTable(candidates, "", true)}\n${needs.field} [1-${candidates.length}, or the id]: `);
    else io.stdout.write(`${needs.message}\n${needs.field} [${needs.options.join("/")}]: `);
    // The first line wins; an input that ends without one (Ctrl-D) is no answer.
    const answer = await new Promise<string | null>((resolve) => {
      rl.once("line", (line) => resolve(line));
      rl.once("close", () => resolve(null));
    });
    if (answer === null) {
      io.stdout.write("\n");
      return null;
    }
    const chosen = answer.trim();
    // A number within the table picks that row; anything else (a numeric TMDB id such as 841 included) must be one of the ids.
    if (candidates?.length && /^\d+$/.test(chosen)) {
      const index = Number(chosen);
      if (index >= 1 && index <= needs.options.length) return needs.options[index - 1]!;
    }
    return needs.options.find((option) => option.toLowerCase() === chosen.toLowerCase()) ?? null;
  } finally {
    rl.close();
  }
}

// ------------------------------------------------------------------ human output

type Projects = Map<string, Project>;
type Calendars = Map<string, Calendar>;
type Accounts = Map<string, Account>;

async function projectIndex(tools: ToolsClient): Promise<Projects> {
  return indexProjects((await tools.indexes()).projects);
}

async function calendarIndex(tools: ToolsClient): Promise<Calendars> {
  return new Map(((await tools.indexes()).calendars).map((calendar) => [calendar.id, calendar]));
}

async function accountIndex(tools: ToolsClient): Promise<Accounts> {
  return new Map(((await tools.indexes()).accounts).map((account) => [account.id, account]));
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

function describe(record: AnyRecord | CalendarRecord | Title, tz: string): string {
  if (isTitle(record)) return `${record.name}${record.year ? ` (${record.year})` : ""}  ${record.medium}  ${record.status}${record.ownership !== "none" ? `, ${record.ownership}` : ""}${record.deletedAt ? "  deleted" : ""}`;
  if ("identity" in record) return `${record.identity}${record.label ? ` (${record.label})` : ""}${record.primary ? "  primary" : ""}`;
  if ("external" in record && "start" in record) return `${record.title}  ${rangeText(record, tz)}${record.status !== "confirmed" ? `  ${record.status}` : ""}`;
  if ("title" in record) return record.title;
  if ("query" in record) return `${record.name}  ${record.query}`;
  if ("slug" in record) return `${record.name} (${record.slug})`;
  return record.name;
}

/** Candidates as a table by their kind: tasks, titles, or catalog hits. */
function candidatesTable(receipt: AnyReceipt, index: Projects, indent: string): string {
  const candidates = candidatesOf(receipt);
  switch (candidateKindOf(receipt)) {
    case "catalog":
      return candidateTable(candidates as Candidate[], indent, true);
    case "title":
      return titleTable(candidates as Title[], false, indent);
    default:
      return taskTable(candidates as Task[], index, indent);
  }
}

function receiptText(receipt: AnyReceipt, index: Projects, tz: string, hint?: string): string {
  if (receipt.ok) {
    const head = `${receipt.outcome} ${receipt.id} v${receipt.version}  ${describe(receipt.record, tz)}`;
    if (receipt.removed) return `${head}\n  removed ${entryLine(receipt.removed).join("  ")}`;
    return head;
  }
  if (receipt.outcome === "duplicate") {
    const n = candidatesOf(receipt).length;
    const what = candidateKindOf(receipt) === "title" ? `title${n === 1 ? "" : "s"} named alike` : `similar open task${n === 1 ? "" : "s"}`;
    return [`duplicate: ${n} ${what}`, candidatesTable(receipt, index, "  "), "  pass --allow-duplicate to add anyway, or reuse one of them"].join("\n");
  }
  const lines = [`rejected${receipt.id ? ` ${receipt.id}` : ""}`, ...receipt.issues.map((issue) => `  - ${issue}`)];
  if (receipt.needs && candidatesOf(receipt).length) lines.push(candidatesTable(receipt, index, "  "), `  ${hint ?? `pass --${receipt.needs.field} ${receipt.needs.options.join("|")}`}`);
  else if (receipt.needs) lines.push(`  pass --${receipt.needs.field} ${receipt.needs.options.join("|")}`);
  else if (hint) lines.push(`  ${hint}`);
  return lines.join("\n");
}

async function taskDetail(task: Task, index: Projects, tools: ToolsClient): Promise<string> {
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

// ------------------------------------------------------------------ calendar output

/** The zone a timed When's `at` is printed through: a floating one carries its wall clock spelled as UTC (time.ts), so UTC reads it back as written. */
const printZone = (when: { timezone: string | null }, tz: string): string => (when.timezone === null ? "UTC" : tz);

/** A When in the display zone: `2026-09-10 16:00` (with the zone when it is not the display one, `floating` when it has none), or the date. */
function whenText(when: When, tz: string): string {
  if (!isTimedWhen(when)) return when.date;
  const zone = when.timezone === null ? " floating" : when.timezone !== tz ? ` ${when.timezone}` : "";
  const read = printZone(when, tz);
  return `${localDate(when.at, read)} ${localTime(when.at, read)}${zone}`;
}

/** A start and end as one range: `2026-09-10 16:00-17:00`, `2026-09-10 22:00 - 2026-09-11 02:00`, `2026-09-14`, `2026-09-14 to 2026-09-15` (all-day, inclusive). */
function rangeText(span: { start: When; end: When }, tz: string): string {
  const { start, end } = span;
  if (isTimedWhen(start) && isTimedWhen(end)) {
    const read = printZone(start, tz);
    const sameDay = localDate(start.at, read) === localDate(end.at, read);
    const zone = start.timezone === null ? " floating" : start.timezone !== tz ? ` ${start.timezone}` : "";
    return sameDay ? `${localDate(start.at, read)} ${localTime(start.at, read)}-${localTime(end.at, read)}${zone}` : `${localDate(start.at, read)} ${localTime(start.at, read)} - ${localDate(end.at, read)} ${localTime(end.at, read)}${zone}`;
  }
  if (!isTimedWhen(start) && !isTimedWhen(end)) {
    const last = addDays(end.date, -1);
    return last <= start.date ? start.date : `${start.date} to ${last}`;
  }
  return `${whenText(start, tz)} - ${whenText(end, tz)}`;
}

/** The time column of a schedule line for `date`: `07:00-08:00`, `22:00-` for an event running past midnight, `-10:00` for one that began the day before, `10:30` for a timed task. */
function timeOnDay(span: { start: When; end: When }, date: string, tz: string): string {
  if (!isTimedWhen(span.start) || !isTimedWhen(span.end)) return "all day";
  const read = printZone(span.start, tz);
  const from = localDate(span.start.at, read) === date ? localTime(span.start.at, read) : "";
  const endsToday = localDate(new Date(Date.parse(span.end.at) - 1), read) === date;
  const to = endsToday ? localTime(span.end.at, read) : "";
  return `${from}-${to}`;
}

const awaitingAnswer = (occurrence: Occurrence): boolean => occurrence.myResponse === "needsAction";
const calendarName = (calendars: Calendars, id: string): string => calendars.get(id)?.name ?? id;

/** One schedule entry as a row: time, E or T, title (a ? before an invitation awaiting an answer), calendar or project, the ref to act on. */
function scheduleRow(entry: ScheduleEntry, date: string, tz: string, projects: Projects, calendars: Calendars): string[] {
  if (entry.kind === "event") {
    const o = entry.occurrence;
    return [timeOnDay(o, date, tz), "E", `${awaitingAnswer(o) ? "? " : ""}${clip(oneLine(o.title), 60)}${o.status !== "confirmed" ? ` (${o.status})` : ""}`, calendarName(calendars, o.calendarId), o.occurrenceId];
  }
  const task = entry.task;
  const project = projects.get(task.projectId);
  return [task.due?.time ?? "all day", "T", clip(oneLine(task.title), 60), project ? projectPath(project, projects) : task.projectId, task.id];
}

const entryLabel = (entry: ScheduleEntry, projects: Projects, calendars: Calendars): string =>
  entry.kind === "event"
    ? `${awaitingAnswer(entry.occurrence) ? "? " : ""}${entry.occurrence.title} [${calendarName(calendars, entry.occurrence.calendarId)}]`
    : `${entry.task.title} [${projects.get(entry.task.projectId) ? projectPath(projects.get(entry.task.projectId)!, projects) : entry.task.projectId}]`;

/** A day's schedule: the all-day line, then one row per timed entry. */
function dayLines(day: Day, tz: string, projects: Projects, calendars: Calendars, indent: string): string[] {
  const lines: string[] = [];
  if (day.allDay.length) lines.push(`${indent}All day: ${day.allDay.map((entry) => entryLabel(entry, projects, calendars)).join(", ")}`);
  if (day.timed.length) lines.push(table(day.timed.map((entry) => scheduleRow(entry, day.date, tz, projects, calendars)), indent));
  return lines;
}

function todayText(view: TodayView, index: Projects, calendars: Calendars, tz: string): string {
  const schedule = dayLines({ date: view.date, allDay: view.allDay, timed: view.timed }, tz, index, calendars, "  ");
  const lines = [
    `Today ${view.date} ${weekday(view.date)} (${view.timezone})`,
    "",
    ...(schedule.length ? [`Schedule (${view.allDay.length + view.timed.length})`, ...schedule, ""] : []),
    ...section("Overdue", view.overdue, index),
    ...section("Due today", view.due, index),
    ...section("Deadlines", view.deadlines, index),
    ...section("Proposed", view.proposed, index),
  ];
  if (lines.length === 2) lines.push("Nothing scheduled, nothing due, no deadlines, nothing proposed.");
  return lines.join("\n").trimEnd();
}

function weekText(view: WeekView, index: Projects, calendars: Calendars, tz: string): string {
  const lines = [`Week ${view.from} to ${view.to} (${view.timezone})`, ""];
  for (const day of view.days) {
    const count = day.allDay.length + day.timed.length;
    lines.push(`${day.date} ${weekday(day.date)}${count ? ` (${count})` : ""}`);
    lines.push(...(count ? dayLines(day, tz, index, calendars, "  ") : ["  (nothing)"]));
  }
  return lines.join("\n");
}

function slotsText(view: SlotsView, tz: string): string {
  if (!view.slots.length) return "No free slots in the window.";
  const rows = view.slots.map((slot) => {
    const minutes = Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60000);
    return [`${localDate(slot.start, tz)} ${weekday(localDate(slot.start, tz))}`, `${localTime(slot.start, tz)}-${localTime(slot.end, tz)}`, `${minutes} min`, `${slot.start} to ${slot.end}`];
  });
  return `Free slots (${view.slots.length}), ${tz}\n${table(rows, "  ")}`;
}

function syncText(reports: SyncReport[], calendars: Calendars, accounts: Accounts): string {
  if (!reports.length) return "No connected accounts to sync.";
  const lines: string[] = [];
  for (const report of reports) {
    const account = accounts.get(report.accountId);
    lines.push(`${account ? account.identity : report.accountId} (${report.accountId})`);
    if (!report.calendars.length) lines.push("  (no calendars)");
    const rows = report.calendars.map((entry) => [
      calendarName(calendars, entry.calendarId),
      entry.calendarId,
      entry.outcome,
      entry.outcome === "failed" ? "" : `+${entry.created} ~${entry.updated} -${entry.deleted}`,
      entry.error ? `error: ${entry.error}` : "",
    ]);
    if (rows.length) lines.push(table(rows, "  "));
  }
  return lines.join("\n");
}

const accountTable = (accounts: Account[]): string =>
  table(accounts.map((a) => [a.id, a.identity, a.label ?? "", a.primary ? "primary" : "", a.status, a.syncedAt ? `synced ${a.syncedAt}` : "never synced", a.deletedAt ? `removed ${a.deletedAt}` : ""]));

function accountDetail(account: Account, calendars: Calendars): string {
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(11)}${value}`] : []);
  const own = [...calendars.values()].filter((c) => c.accountId === account.id && !c.deletedAt).sort((a, b) => a.order - b.order);
  return [
    `${account.id}  ${account.status}  ${account.identity}`,
    ...field("provider", account.provider),
    ...field("label", account.label),
    ...field("primary", account.primary ? "yes (default target for event add)" : null),
    ...field("scopes", account.scopes.join(" ")),
    ...field("synced", account.syncedAt ?? "never"),
    ...field("calendars", own.length ? own.map((c) => `${c.name} (${c.id}${c.hidden ? ", hidden" : ""}${c.writable ? "" : ", read-only"})`).join(", ") : "none synced yet"),
    ...field("created", account.createdAt),
    ...field("updated", `${account.updatedAt} (v${account.version})`),
    ...field("removed", account.deletedAt),
  ].join("\n");
}

const calendarTable = (calendars: Calendar[], accounts: Accounts): string =>
  table(
    calendars.map((c) => [
      c.id,
      c.name,
      accounts.get(c.accountId)?.identity ?? c.accountId,
      c.primaryOfAccount ? "main" : "",
      c.writable ? "" : "read-only",
      c.hidden ? "hidden" : "",
      labelText(c.labels),
      c.color ?? "",
      c.syncedAt ? `synced ${c.syncedAt}` : "never synced",
      c.syncError ? `error: ${clip(c.syncError, 60)}` : "",
      c.deletedAt ? `deleted ${c.deletedAt}` : "",
    ]),
  );

function calendarDetail(calendar: Calendar, accounts: Accounts): string {
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(11)}${value}`] : []);
  return [
    `${calendar.id}  ${calendar.name}`,
    ...field("account", `${accounts.get(calendar.accountId)?.identity ?? calendar.accountId} (${calendar.accountId})`),
    ...field("ref", `${accounts.get(calendar.accountId)?.identity ?? calendar.accountId}/${calendar.name}`),
    ...field("timezone", calendar.timezone),
    ...field("access", calendar.writable ? "writable" : "read-only"),
    ...field("main", calendar.primaryOfAccount ? "yes (the account's main calendar)" : null),
    ...field("hidden", calendar.hidden ? "yes" : null),
    ...field("labels", labelText(calendar.labels)),
    ...field("color", calendar.color),
    ...field("order", String(calendar.order)),
    ...field("provider id", calendar.external.id),
    ...field("synced", calendar.syncedAt ?? "never"),
    ...field("sync error", calendar.syncError),
    ...field("created", calendar.createdAt),
    ...field("updated", `${calendar.updatedAt} (v${calendar.version})`),
    ...field("deleted", calendar.deletedAt),
  ].join("\n");
}

/** One line per occurrence: the occurrence ref first, so it can be copied straight into update, respond, cancel, or delete. */
const occurrenceTable = (occurrences: Occurrence[], calendars: Calendars, tz: string, indent = ""): string =>
  table(
    occurrences.map((o) => [
      o.occurrenceId,
      rangeText(o, tz),
      "E",
      `${awaitingAnswer(o) ? "? " : ""}${clip(oneLine(o.title), 60)}`,
      o.status !== "confirmed" ? o.status : "",
      calendarName(calendars, o.calendarId),
      o.location ? clip(oneLine(o.location), 30) : "",
      o.repeat ? "repeats" : o.master ? "" : "exception",
      o.deletedAt ? `deleted ${o.deletedAt}` : "",
    ]),
    indent,
  );

function eventDetail(event: Event | Occurrence, calendars: Calendars, tz: string): string {
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(11)}${value}`] : []);
  const occurrence = "occurrenceId" in event ? event : null;
  const lines = [
    `${occurrence ? occurrence.occurrenceId : event.id}  ${event.status}  ${event.title}`,
    ...field("event", occurrence ? `${event.id}${event.masterId ? ` (exception of ${event.masterId})` : ""}` : event.masterId ? `exception of ${event.masterId}` : null),
    ...field("when", rangeText(event, tz)),
    ...field("start", `${whenText(event.start, tz)} (${isTimedWhen(event.start) ? event.start.at : "all day"})`),
    ...field("end", `${whenText(event.end, tz)} (${isTimedWhen(event.end) ? event.end.at : "exclusive"})`),
    ...field("original", event.originalStart ? whenText(event.originalStart, tz) : null),
    ...field("repeat", event.repeat ? `${event.repeat.rrule}${event.repeat.exdates.length ? ` (except ${event.repeat.exdates.join(", ")})` : ""}` : null),
    ...field("calendar", `${calendarName(calendars, event.calendarId)} (${event.calendarId})`),
    ...field("location", event.location),
    ...field("busy", event.busy ? "yes" : "no (free)"),
    ...field("organizer", event.organizer ? `${event.organizer.name ?? event.organizer.email}${event.organizer.self ? " (me)" : ""}` : null),
    ...field("attendees", event.attendees.length ? event.attendees.map((a) => `${a.name ?? a.email}${a.self ? " (me)" : ""}: ${a.response}${a.optional ? ", optional" : ""}`).join("; ") : null),
    ...field("my answer", event.myResponse),
    ...field("conference", event.conferencing ? `${event.conferencing.kind} ${event.conferencing.url}` : null),
    ...field("reminders", event.reminders ? event.reminders.map((r) => `${r.method} ${r.minutes} min before`).join(", ") : null),
    ...field("provider", `${event.external.provider} ${event.external.id} (updated ${event.external.updatedAt})`),
    ...field("origin", `${event.origin.actor} at ${event.origin.at}${event.origin.reason ? `: ${event.origin.reason}` : ""}`),
    ...field("evidence", event.origin.evidence.join(", ")),
    ...field("created", event.createdAt),
    ...field("updated", `${event.updatedAt} (v${event.version})`),
    ...field("deleted", event.deletedAt),
  ];
  if (event.notes?.trim()) lines.push("notes", ...event.notes.trimEnd().split("\n").map((line) => `  ${line}`));
  return lines.join("\n");
}

function upcomingText(view: UpcomingView, index: Projects): string {
  const lines = [`Upcoming ${view.from} to ${view.to}`, ""];
  for (const day of view.days) {
    lines.push(`${day.date} ${weekday(day.date)}${day.tasks.length ? ` (${day.tasks.length})` : ""}`);
    lines.push(day.tasks.length ? taskTable(day.tasks, index, "  ") : "  (nothing)");
  }
  return lines.join("\n");
}

function trashText(view: TrashView, index: Projects, calendars: Calendars, accounts: Accounts, tz: string): string {
  const lines: string[] = [];
  const deleted = (record: { deletedAt: string | null }) => `deleted ${record.deletedAt ?? ""}`;
  if (view.tasks.length) lines.push(`Tasks (${view.tasks.length})`, taskTable(view.tasks, index, "  "), "");
  if (view.projects.length) lines.push(`Projects (${view.projects.length})`, table(view.projects.map((p) => [p.id, p.name, p.slug, deleted(p)]), "  "), "");
  if (view.sections.length) lines.push(`Sections (${view.sections.length})`, table(view.sections.map((s) => [s.id, s.name, deleted(s)]), "  "), "");
  if (view.labels.length) lines.push(`Labels (${view.labels.length})`, table(view.labels.map((l) => [l.id, `@${l.name}`, deleted(l)]), "  "), "");
  if (view.filters.length) lines.push(`Filters (${view.filters.length})`, table(view.filters.map((f) => [f.id, f.name, f.query, deleted(f)]), "  "), "");
  if (view.events.length) lines.push(`Events (${view.events.length})`, table(view.events.map((e) => [e.id, e.title, rangeText(e, tz), calendarName(calendars, e.calendarId), e.masterId ? `exception of ${e.masterId}` : "", deleted(e)]), "  "), "");
  if (view.calendars.length) lines.push(`Calendars (${view.calendars.length})`, table(view.calendars.map((c) => [c.id, c.name, accounts.get(c.accountId)?.identity ?? c.accountId, deleted(c)]), "  "), "");
  if (view.accounts.length) lines.push(`Accounts (${view.accounts.length})`, table(view.accounts.map((a) => [a.id, a.identity, a.label ?? "", deleted(a)]), "  "), "");
  if (view.titles.length) lines.push(`Titles (${view.titles.length})`, titleTable(view.titles, true, "  "), "");
  return lines.length ? lines.join("\n").trimEnd() : "The trash is empty.";
}

// ------------------------------------------------------------------ library output

/** An On with its precision marker: `2026-09-07`, `2026-09-07~w`, `2026-09~m`, `2026~y`, `?`. */
function onText(on: On): string {
  switch (on.precision) {
    case "unknown":
      return "?";
    case "week":
      return `${on.date}~w`;
    case "month":
      return `${on.date}~m`;
    case "year":
      return `${on.date}~y`;
    default:
      return on.date ?? "?";
  }
}

const ratingText = (rating: Rating | null): string => (rating === null ? "" : `${rating}/5`);
const moneyText = (money: { amount: number; currency: string } | null): string => (money ? `${money.amount} ${money.currency}` : "");
const nameYear = (row: { name: string; year: number | null }): string => `${clip(oneLine(row.name), 60)}${row.year ? ` (${row.year})` : ""}`;

/** The last entry of a summary or a full record, for the list column. */
function lastOf(row: ViewTitle): { type: string; on: On } | null {
  if (isTitle(row)) return lastEntry(row.entries);
  return row.lastEntry;
}

function titleRow(row: ViewTitle, showMedium: boolean): string[] {
  const last = lastOf(row);
  return [
    row.id,
    showMedium ? row.medium : "",
    row.status,
    row.ownership === "none" ? "" : row.ownership,
    nameYear(row),
    row.priority ?? "",
    ratingText(row.rating),
    row.liked ? "liked" : "",
    last ? `${last.type} ${onText(last.on)}` : "",
    isTitle(row) && row.deletedAt ? `deleted ${row.deletedAt}` : "",
  ];
}

/** One line per title: id, (medium), status, ownership, name (year), priority, rating, liked, last entry. */
function titleTable(rows: ViewTitle[], showMedium: boolean, indent = ""): string {
  return table(rows.map((row) => titleRow(row, showMedium)), indent);
}

/** One diary line: date with its precision marker, type, and what the entry carries. */
function entryLine(entry: Entry): string[] {
  const extras = [
    entry.progress ? `at ${entry.progress}` : "",
    entry.format ?? "",
    ratingText(entry.rating),
    entry.minutes !== null ? `${entry.minutes} min` : "",
    entry.spend ? `${moneyText(entry.spend)} ${entry.spend.kind}` : "",
    entry.where ? `@ ${entry.where}` : "",
  ].filter(Boolean);
  return [onText(entry.on), entry.type, entry.id, extras.join("  "), entry.text ? clip(oneLine(entry.text), 100) : ""];
}

/** The title page (LEISURE D90): name, year, medium, status and ownership on one line, the take, the fits, the facts, then the diary newest first. */
function titleDetail(title: Title): string {
  const field = (name: string, value: string | undefined | null): string[] => (value ? [`${name.padEnd(13)}${value}`] : []);
  const length = title.length
    ? [title.length.minutes ? `${title.length.minutes} min` : "", title.length.pages ? `${title.length.pages} pages` : "", title.length.hours ? `${title.length.hours} h` : "", title.length.seasons ? `${title.length.seasons} seasons` : "", title.length.episodes ? `${title.length.episodes} episodes` : ""].filter(Boolean).join(", ")
    : null;
  const series = title.series ?? (title.facts?.series ? { name: title.facts.series.name, position: title.facts.series.position } : null);
  const detail = [title.detail.format ? `format ${title.detail.format}` : "", title.detail.platform ? `platform ${title.detail.platform}` : "", title.detail.where ? `watched on ${title.detail.where}` : ""].filter(Boolean).join("; ");
  const owned = title.ownershipDetail;
  const lines = [
    `${title.id}  ${describe(title, "UTC")}`,
    ...field("rating", ratingText(title.rating)),
    ...field("liked", title.liked ? "yes" : null),
    ...field("review", title.review ? clip(oneLine(title.review), 200) : null),
    ...field("priority", title.priority),
    ...field("fits", [title.moodFit.join(", "), title.timeFit ?? ""].filter(Boolean).join("; ")),
    ...field("aliases", title.aliases.join(", ")),
    ...field("creators", title.creators.join(", ")),
    ...field("length", length),
    ...field("series", series ? `${series.name}${series.position !== null ? ` #${series.position}` : ""}${title.series ? " (hand-set)" : ""}` : null),
    ...field("detail", detail),
    ...field("ownership", owned ? [title.ownership, owned.since ? `since ${onText(owned.since)}` : "", owned.where ? `at ${owned.where}` : "", owned.price ? `for ${moneyText(owned.price)}` : ""].filter(Boolean).join(" ") : null),
    ...field("catalog", title.catalog ? `${SOURCE_NAMES[title.catalog.source]} ${title.catalog.externalId} (pulled ${title.catalog.pulledAt})` : "none (`refresh` looks it up)"),
    ...field("edited", title.edited.join(", ")),
    ...field("genres", title.facts?.genres.join(", ")),
    ...field("released", title.facts?.released),
    ...field("synopsis", title.facts?.synopsis ? clip(oneLine(title.facts.synopsis), 300) : null),
    ...field("origin", `${title.origin.actor} at ${title.origin.at}${title.origin.reason ? `: ${title.origin.reason}` : ""}`),
    ...field("evidence", title.origin.evidence.join(", ")),
    ...field("created", title.createdAt),
    ...field("updated", `${title.updatedAt} (v${title.version})`),
    ...field("deleted", title.deletedAt),
  ];
  const availability = title.facts?.availability ?? [];
  if (availability.length) lines.push(`availability (${availability.length})`, availabilityText(availability, "  "));
  if (title.notes?.trim()) lines.push("notes", ...title.notes.trimEnd().split("\n").map((line) => `  ${line}`));
  const entries = orderEntries(title.entries).reverse();
  lines.push(entries.length ? `diary (${entries.length}), newest first` : "diary: empty (curious)");
  if (entries.length) lines.push(table(entries.map(entryLine), "  "));
  return lines.join("\n");
}

/** One line per availability row: kind, name, price, and a `*` on constructed search links. */
function availabilityText(rows: Availability[], indent = ""): string {
  return table(
    rows.map((row) => [row.kind, row.name, moneyText(row.price), row.constructed ? "*" : "", row.region, row.url]),
    indent,
  );
}

/** Catalog candidates: `#  id  name (year)  creators  category`, numbered when the caller asks, with availability lines when a hit carries them. */
function candidateTable(candidates: SearchCandidate[], indent = "", numbered = false): string {
  const rows: string[][] = [];
  if (numbered) rows.push(["#", "id", "name (year)", "creators", "category", "", ""]);
  candidates.forEach((c, i) => {
    rows.push([
      numbered ? String(i + 1) : "",
      c.externalId,
      nameYear(c),
      clip(c.creators.join(", "), 40),
      c.category ?? "",
      c.editionCount !== null ? `${c.editionCount} editions` : "",
      c.inLibrary ? `in the library as ${c.inLibrary}` : "",
    ]);
  });
  const lines = [table(rows, indent)];
  for (const c of candidates) {
    if (c.availability?.length) lines.push(`${indent}  ${c.externalId} ${c.name}:`, availabilityText(c.availability, `${indent}    `));
  }
  return lines.join("\n");
}

function nextText(title: Title, view: NextView): string {
  const entry = view.seriesEntry;
  const position = entry.position !== null ? ` (#${entry.position})` : entry.released ? ` (${entry.released})` : "";
  const where = view.title ? `in the library as ${view.title.id}, ${view.title.status}` : "not in the library; pass --queue to add it to the backlog";
  return `Next after ${title.name}: "${entry.name}"${position}${entry.externalId ? `, catalog ${entry.externalId}` : ""}; ${where}`;
}

function seriesText(view: SeriesView): string {
  const rows = view.entries.map((entry) => [entry.position !== null ? `#${entry.position}` : "", entry.name, entry.released ?? "", entry.externalId ?? "", entry.title ? `${entry.title.id} ${entry.title.status}${entry.title.rating !== null ? ` ${ratingText(entry.title.rating)}` : ""}` : "not in the library"]);
  return `${view.name}${view.position !== null ? ` (this title is #${view.position})` : ""}\n${table(rows, "  ")}`;
}

function buyText(items: BuyItem[], showMedium: boolean): string {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`${titleRow(item.title, showMedium).filter(Boolean).join("  ")}${item.lowestPrice ? `  lowest ${moneyText(item.lowestPrice)}` : ""}`);
    lines.push(item.availability.length ? availabilityText(item.availability, "  ") : "  (nowhere on record)");
  }
  return lines.join("\n");
}

function shelfText(view: ShelfView, showMedium: boolean): string {
  const bucket = (name: string, rows: ViewTitle[]): string[] => (rows.length ? [`${name} (${rows.length})`, titleTable(rows, showMedium, "  "), ""] : []);
  const lines = [...bucket("Done", view.done), ...bucket("In progress", view.inProgress), ...bucket("Untouched", view.untouched), ...bucket("Dropped", view.dropped)];
  return lines.length ? lines.join("\n").trimEnd() : "Nothing owned.";
}

function diaryText(view: DiaryView): string {
  if (!view.entries.length) return "No entries in the range.";
  return table(view.entries.map((entry) => [onText(entry.on), entry.medium, clip(oneLine(entry.titleName), 40), entry.type, entry.titleId, entry.id, entry.progress ? `at ${entry.progress}` : "", entry.minutes !== null ? `${entry.minutes} min` : "", entry.text ? clip(oneLine(entry.text), 80) : ""]));
}

function bucketText(bucket: TimeView["total"]): string {
  const minutes = Object.entries(bucket.minutes).map(([medium, n]) => `${medium} ${n} min`);
  const spend = Object.entries(bucket.spend).map(([currency, kinds]) => [kinds.purchase ? `${kinds.purchase} ${currency} purchase` : "", kinds.iap ? `${kinds.iap} ${currency} iap` : "", kinds.rental ? `${kinds.rental} ${currency} rental` : ""].filter(Boolean).join(", "));
  return [...minutes, ...spend].filter(Boolean).join("; ") || "nothing";
}

function timeText(view: TimeView): string {
  const lines = [`Time ${view.from} to ${view.to}: ${bucketText(view.total)}${view.unplaced ? ` (${view.unplaced} entries at month, year, or ? precision not placed)` : ""}`];
  for (const week of view.weeks) {
    lines.push(`${week.from} to ${week.to}  ${bucketText(week)}`);
    if (week.titles.length) lines.push(table(week.titles.map((t) => [t.id, clip(oneLine(t.name), 50), `${t.minutes} min`]), "  "));
  }
  return lines.join("\n");
}

function yearText(view: YearView): string {
  const byMedium = Object.entries(view.byMedium).map(([medium, stat]) => `${medium} ${stat.count}${stat.avgRating !== null ? ` (avg ${stat.avgRating}/5)` : ""}`);
  const lines = [`${view.year}: ${view.finished.length} finished (${view.again} again), ${view.dropped.length} dropped${byMedium.length ? `; ${byMedium.join(", ")}` : ""}`];
  const rows = (items: YearView["finished"]): string => table(items.map((item) => [onText(item.entry.on), item.title.medium, nameYear(item.title), ratingText(item.entry.rating), item.title.id, item.entry.text ? clip(oneLine(item.entry.text), 60) : ""]), "  ");
  if (view.finished.length) lines.push("Finished", rows(view.finished));
  if (view.dropped.length) lines.push("Dropped", rows(view.dropped));
  return lines.join("\n");
}

function availabilityReportText(report: AvailabilityReport): string {
  const lines = [`Refreshed ${report.refreshed.length}, failed ${report.failed.length}.`];
  if (report.refreshed.length) lines.push(table(report.refreshed.map((r) => [r.id, r.name, r.outcome]), "  "));
  if (report.failed.length) lines.push("Failed", table(report.failed.map((r) => [r.id, r.name, r.issues.join("; ")]), "  "));
  return lines.join("\n");
}
