// The `life` CLI: a thin client of the Tools facade for a shell, usable by a
// program. Every command maps onto one library call; the CLI adds argument
// parsing, the actor rule, relative dates, the sub-task question on a terminal,
// human or JSON output, and stable exit codes. Nothing here writes a record.
//
//   life <group> <command> [args] [flags]
//   exit codes: 0 ok, 1 rejected or invalid, 2 duplicate candidates,
//               3 database unavailable, 64 usage

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
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
import { rejected, type Clock } from "./core.ts";
import { effectiveLabels, indexProjects, projectPath, type ProjectContents, type ProjectNode, type SectionTasks } from "./organize.ts";
import type { CompleteOptions, DeleteOptions, ImportResult, TaskAssign } from "./tasks.ts";
import { defaultTimezone, isValidTimezone, relativeDate, todayIn } from "./time.ts";
import { Tools } from "./tools.ts";
import type { TodayView, TrashView, UpcomingView } from "./views.ts";

// ------------------------------------------------------------------ public surface

export const EXIT = { ok: 0, rejected: 1, duplicate: 2, database: 3, usage: 64 } as const;

/** What the CLI talks to; `bin/life.js` passes the process, tests pass streams and a fixed clock. */
export type CliIo = {
  env: Record<string, string | undefined>;
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream & { isTTY?: boolean };
  stderr: NodeJS.WritableStream;
  /** Replaces the wall clock; `--tz` and LIFE_TZ still decide the timezone. */
  clock?: Clock;
};

export const USAGE = `usage: life <group> <command> [args] [flags]

Global flags: --actor a (or LIFE_ACTOR; defaults to neel on a terminal) --reason "..." --evidence ref (repeatable)
              --key idempotency-key --if-version n --json --tz zone --db url

life task add <title> [--notes] [--project ref] [--section name|id] [--parent id] [--due date|today|tomorrow|+Nd] [--time HH:MM] [--tz] [--deadline date] [--duration min] [--repeat RRULE] [--priority 1-4] [--label name]... [--executor] [--bucket] [--status proposed|accepted] [--allow-duplicate]
life task get <id>
life task list [--filter "<query>"] [--project ref] [--with-subprojects] [--section name|id] [--label name] [--status a,b] [--all] [--due date] [--due-before date] [--due-after date] [--undated] [--text s] [--deleted] [--limit n]
life task update <id> [--title] [--notes] [--priority n|--no-priority] [--due d|--no-due] [--time] [--tz] [--deadline d|--no-deadline] [--duration n|--no-duration] [--repeat r|--no-repeat] [--label name]...|--no-label
life task move <id> [--project ref] [--section name|id|--no-section] [--parent id|--no-parent]
life task reorder <id> <id>...
life task duplicate <id> [--no-subtasks]
life task accept|start|uncomplete|restore <id>
life task complete <id> [--date d] [--subtasks complete|leave]
life task cancel <id> --reason "..."
life task delete <id> [--subtasks delete|leave]
life task assign <id> [--executor e] [--bucket b|--no-bucket]
life task reschedule <id> (--due d [--time] [--tz] | --no-due)
life task note <id> <text> [--attach name=url]...
life task history <id>
life task import <file.json> [--dry-run]
life project add <name> [--parent ref] [--slug s] [--color c] [--layout list|board] [--label name]...
life project tree [--archived]
life project get|archive|unarchive|restore <ref>
life project update <ref> [--name] [--slug] [--color|--no-color] [--layout] [--label]...
life project move <ref> (--parent ref | --no-parent)
life project delete <ref> [--contents delete|inbox]
life project reorder <id> <id>...
life section add <project-ref> <name>
life section list <project-ref>
life section update <id> --name n
life section archive|unarchive|restore <id>
life section delete <id> [--tasks delete|unsection]
life section reorder <id> <id>...
life label add <name> [--color c]
life label list
life label update <ref> [--name] [--color|--no-color]
life label delete|restore <ref>
life label reorder <id> <id>...
life filter add <name> <query>
life filter list
life filter run <ref|query>
life filter update <ref> [--name] [--query]
life filter delete|restore <ref>
life filter reorder <id> <id>...
life today [--date d]
life upcoming [days] [--from d]
life search <text>
life trash
life export [file]
life migrate
life help

Exit codes: 0 ok, 1 rejected or invalid, 2 duplicate candidates, 3 database unavailable, 64 usage.
JSON output is the default when stdout is not a terminal.
`;

/** Run the CLI and resolve to its exit code. Never throws; everything is reported on stderr. */
export async function main(argv: string[], io: CliIo = processIo()): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`life: ${error.message}\n`);
      if (error.showUsage) io.stderr.write(`\n${USAGE}`);
      return EXIT.usage;
    }
    if (isDatabaseError(error)) {
      io.stderr.write(`life: database unavailable: ${messageOf(error)}\n`);
      return EXIT.database;
    }
    io.stderr.write(`life: ${messageOf(error)}\n`);
    return EXIT.rejected;
  }
}

function processIo(): CliIo {
  return { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
}

// ------------------------------------------------------------------ errors

class UsageError extends Error {
  readonly showUsage: boolean;

  constructor(message: string, showUsage = false) {
    super(message);
    this.showUsage = showUsage;
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

// ------------------------------------------------------------------ argument parsing

type FlagKind = "value" | "list" | "bool";
type FlagSpec = Readonly<Record<string, FlagKind>>;

const GLOBAL_FLAGS: FlagSpec = {
  actor: "value",
  reason: "value",
  evidence: "list",
  key: "value",
  "if-version": "value",
  json: "bool",
  tz: "value",
  db: "value",
  help: "bool",
};

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

type Parsed = { command: Command; name: string; args: string[]; flags: Flags };

function parseArgv(argv: string[]): Parsed | "help" {
  const flags = new Flags();
  const args: string[] = [];
  const words: string[] = [];
  let command: Command | null = null;
  let onlyPositionals = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (onlyPositionals || !token.startsWith("--") || token === "-") {
      if (token === "-h" && !onlyPositionals) return "help";
      if (command) args.push(token);
      else {
        words.push(token);
        const found = resolveCommand(words);
        if (found === "help") return "help";
        if (found) command = found;
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
    if (name === "help") return "help";
    const kind = GLOBAL_FLAGS[name] ?? command?.flags[name];
    if (!kind) {
      const where = command ? `for \`life ${words.join(" ")}\`` : "before the command";
      throw new UsageError(`unknown flag --${name} ${where}`, !command);
    }
    if (kind === "bool") {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      flags.set(name, kind, undefined);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      value = next;
      i++;
    }
    flags.set(name, kind, value);
  }

  if (!command) {
    if (!words.length) throw new UsageError("a command is required", true);
    throw new UsageError(`life ${words[0]}: a command is required`, true);
  }
  const name = words.join(" ");
  const [min, max] = command.args;
  if (args.length < min) throw new UsageError(`life ${name}: ${command.argNames.slice(args.length, min).map((a) => `<${a}>`).join(" ")} required\n  ${command.usage}`);
  if (max !== null && args.length > max) throw new UsageError(`life ${name}: unexpected argument "${args[max]}"\n  ${command.usage}`);
  return { command, name, args, flags };
}

// ------------------------------------------------------------------ the command table

type Rendered = {
  code: number;
  json: unknown;
  /** The human rendering, built only when asked for. */
  text: () => Promise<string> | string;
  /** A rejection the caller can turn into a question. */
  needs?: Needs;
};

type Invocation = {
  tools: Tools;
  args: string[];
  flags: Flags;
  /** The mutation context; throws a usage error when no actor could be resolved. */
  ctx: () => Ctx;
  today: string;
  tz: string;
  json: boolean;
  io: CliIo;
};

type Command = {
  usage: string;
  argNames: string[];
  /** Minimum and maximum positionals; null for unbounded. */
  args: [number, number | null];
  flags: FlagSpec;
  mutates: boolean;
  run(inv: Invocation): Promise<Rendered>;
};

const GROUPS = new Set(["task", "project", "section", "label", "filter"]);

function resolveCommand(words: string[]): Command | "help" | null {
  if (words.length === 1) {
    if (words[0] === "help") return "help";
    if (GROUPS.has(words[0]!)) return null; // wait for the command word
    const top = COMMANDS[words[0]!];
    if (top) return top;
    throw new UsageError(`unknown command "${words[0]}"`, true);
  }
  const found = COMMANDS[words.join(" ")];
  if (!found) throw new UsageError(`unknown command "${words.join(" ")}"`, true);
  return found;
}

/** Drop undefined keys so an input carries only what was asked for. The library validates the shape. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

/** YYYY-MM-DD, today, tomorrow, yesterday, +Nd, -Nw; anything else passes through for the library to reject. */
function resolveDate(inv: Invocation, value: string): string {
  return relativeDate(value, inv.today) ?? value;
}

function dateFlag(inv: Invocation, name: string): string | undefined {
  const value = inv.flags.str(name);
  return value === undefined ? undefined : resolveDate(inv, value);
}

/** `--due d [--time HH:MM]` as a Due; a time carries the effective timezone. */
function dueFlag(inv: Invocation): Due | undefined {
  const date = inv.flags.str("due");
  const time = inv.flags.str("time");
  if (date === undefined) {
    if (time !== undefined) throw new UsageError("--time needs --due");
    return undefined;
  }
  const due: Due = { date: resolveDate(inv, date) };
  if (time !== undefined) {
    due.time = time;
    due.timezone = inv.tz;
  }
  return due;
}

function attachments(inv: Invocation): { name: string; url: string }[] {
  return inv.flags.list("attach").map((raw) => {
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`--attach expects name=url, got "${raw}"`);
    return { name: raw.slice(0, eq), url: raw.slice(eq + 1) };
  });
}

function labelsFlag(inv: Invocation): string[] | undefined {
  if (inv.flags.bool("no-label")) {
    if (inv.flags.list("label").length) throw new UsageError("--label and --no-label exclude each other");
    return [];
  }
  const labels = inv.flags.list("label");
  return labels.length ? labels : undefined;
}

function choiceFlag(inv: Invocation, name: string, options: string[]): string | undefined {
  const value = inv.flags.str(name);
  if (value !== undefined && !options.includes(value)) throw new UsageError(`--${name} expects ${options.join(" or ")}, got "${value}"`);
  return value;
}

// ---- the flag specs shared by several commands

const TASK_SCHEDULE: FlagSpec = { due: "value", time: "value", deadline: "value", duration: "value", repeat: "value", priority: "value" };
const TASK_ADD_FLAGS: FlagSpec = {
  ...TASK_SCHEDULE,
  notes: "value",
  project: "value",
  section: "value",
  parent: "value",
  label: "list",
  executor: "value",
  bucket: "value",
  status: "value",
  "allow-duplicate": "bool",
};
const TASK_UPDATE_FLAGS: FlagSpec = {
  ...TASK_SCHEDULE,
  title: "value",
  notes: "value",
  label: "list",
  "no-label": "bool",
  "no-priority": "bool",
  "no-due": "bool",
  "no-deadline": "bool",
  "no-duration": "bool",
  "no-repeat": "bool",
};

// ---- rendering results

const receiptCode = (receipt: Receipt<unknown>): number =>
  receipt.ok ? EXIT.ok : receipt.outcome === "duplicate" ? EXIT.duplicate : EXIT.rejected;

/** One receipt: exit code from the outcome, the receipt as JSON, one line plus issues as text. */
function rendered(inv: Invocation, receipt: Receipt<AnyRecord>): Rendered {
  return {
    code: receiptCode(receipt),
    json: receipt,
    text: async () => receiptText(receipt, await projectIndex(inv.tools)),
    ...(!receipt.ok && receipt.outcome === "rejected" && receipt.needs ? { needs: receipt.needs } : {}),
  };
}

function renderedAll(inv: Invocation, receipts: Receipt<AnyRecord>[]): Rendered {
  const codes = receipts.map(receiptCode);
  const code = codes.includes(EXIT.rejected) ? EXIT.rejected : codes.includes(EXIT.duplicate) ? EXIT.duplicate : EXIT.ok;
  return {
    code,
    json: receipts,
    text: async () => {
      const index = await projectIndex(inv.tools);
      return receipts.map((receipt) => receiptText(receipt, index)).join("\n");
    },
  };
}

function renderedTasks(inv: Invocation, tasks: Task[], empty = "No tasks."): Rendered {
  return {
    code: EXIT.ok,
    json: tasks,
    text: async () => (tasks.length ? taskTable(tasks, await projectIndex(inv.tools)) : empty),
  };
}

const plain = (code: number, json: unknown, text: string): Rendered => ({ code, json, text: () => text });

/** A read that found nothing: exit 1, a rejection-shaped object in JSON so an agent sees why, the sentence on a terminal. */
const notFound = (issue: string, text: string): Rendered => plain(EXIT.rejected, rejected([issue]), text);

// ---- task commands

const taskAdd: Command = {
  usage: "life task add <title> [--notes] [--project ref] [--section name|id] [--parent id] [--due d] [--time HH:MM] [--deadline d] [--duration min] [--repeat RRULE] [--priority 1-4] [--label name]... [--executor] [--bucket] [--status proposed|accepted] [--allow-duplicate]",
  argNames: ["title"],
  args: [1, 1],
  flags: TASK_ADD_FLAGS,
  mutates: true,
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
    return rendered(inv, await inv.tools.task.add(input as TaskAdd, inv.ctx()));
  },
};

const taskGet: Command = {
  usage: "life task get <id>",
  argNames: ["id"],
  args: [1, 1],
  flags: {},
  mutates: false,
  async run(inv) {
    const task = await inv.tools.task.get(inv.args[0]!);
    if (!task) return notFound(`task: no task "${inv.args[0]}"`, `No task "${inv.args[0]}".`);
    return { code: EXIT.ok, json: task, text: async () => taskDetail(task, await projectIndex(inv.tools), inv.tools) };
  },
};

const taskList: Command = {
  usage: "life task list [--filter q] [--project ref] [--with-subprojects] [--section s] [--label l] [--status a,b] [--all] [--due d] [--due-before d] [--due-after d] [--undated] [--text s] [--deleted] [--limit n]",
  argNames: [],
  args: [0, 0],
  flags: {
    filter: "value",
    project: "value",
    "with-subprojects": "bool",
    section: "value",
    label: "value",
    status: "value",
    all: "bool",
    due: "value",
    "due-before": "value",
    "due-after": "value",
    undated: "bool",
    text: "value",
    deleted: "bool",
    limit: "value",
  },
  mutates: false,
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

const taskUpdate: Command = {
  usage: "life task update <id> [--title] [--notes] [--priority n|--no-priority] [--due d|--no-due] [--time] [--deadline d|--no-deadline] [--duration n|--no-duration] [--repeat r|--no-repeat] [--label name]...|--no-label",
  argNames: ["id"],
  args: [1, 1],
  flags: { ...TASK_UPDATE_FLAGS },
  mutates: true,
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
    if (!Object.keys(input).length) throw new UsageError("life task update: nothing to change; pass at least one flag");
    return rendered(inv, await inv.tools.task.update(inv.args[0]!, input as TaskUpdate, inv.ctx()));
  },
};

const taskMove: Command = {
  usage: "life task move <id> [--project ref] [--section name|id|--no-section] [--parent id|--no-parent]",
  argNames: ["id"],
  args: [1, 1],
  flags: { project: "value", section: "value", "no-section": "bool", parent: "value", "no-parent": "bool" },
  mutates: true,
  async run(inv) {
    const input = compact({ project: inv.flags.str("project"), section: inv.flags.clearable("section"), parent: inv.flags.clearable("parent") });
    if (!Object.keys(input).length) throw new UsageError("life task move: pass --project, --section/--no-section, or --parent/--no-parent");
    return rendered(inv, await inv.tools.task.move(inv.args[0]!, input as TaskMove, inv.ctx()));
  },
};

const taskReorder: Command = {
  usage: "life task reorder <id> <id>...",
  argNames: ["id"],
  args: [1, null],
  flags: {},
  mutates: true,
  run: async (inv) => renderedAll(inv, await inv.tools.task.reorder(inv.args, inv.ctx())),
};

const taskDuplicate: Command = {
  usage: "life task duplicate <id> [--no-subtasks]",
  argNames: ["id"],
  args: [1, 1],
  flags: { "no-subtasks": "bool" },
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.task.duplicate(inv.args[0]!, inv.ctx(), inv.flags.bool("no-subtasks") ? { subtasks: false } : {})),
};

const transition = (verb: "accept" | "start" | "uncomplete" | "restore" | "cancel"): Command => ({
  usage: verb === "cancel" ? 'life task cancel <id> --reason "..."' : `life task ${verb} <id>`,
  argNames: ["id"],
  args: [1, 1],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.task[verb](inv.args[0]!, inv.ctx())),
});

const taskComplete: Command = {
  usage: "life task complete <id> [--date d] [--subtasks complete|leave]",
  argNames: ["id"],
  args: [1, 1],
  flags: { date: "value", subtasks: "value" },
  mutates: true,
  async run(inv) {
    const opts = compact({ date: dateFlag(inv, "date"), subtasks: choiceFlag(inv, "subtasks", ["complete", "leave"]) });
    return rendered(inv, await inv.tools.task.complete(inv.args[0]!, inv.ctx(), opts as CompleteOptions));
  },
};

const taskDelete: Command = {
  usage: "life task delete <id> [--subtasks delete|leave]",
  argNames: ["id"],
  args: [1, 1],
  flags: { subtasks: "value" },
  mutates: true,
  async run(inv) {
    const opts = compact({ subtasks: choiceFlag(inv, "subtasks", ["delete", "leave"]) });
    return rendered(inv, await inv.tools.task.delete(inv.args[0]!, inv.ctx(), opts as DeleteOptions));
  },
};

const taskAssign: Command = {
  usage: "life task assign <id> [--executor e] [--bucket b|--no-bucket]",
  argNames: ["id"],
  args: [1, 1],
  flags: { executor: "value", bucket: "value", "no-bucket": "bool" },
  mutates: true,
  async run(inv) {
    const input = compact({ executor: inv.flags.str("executor"), bucket: inv.flags.clearable("bucket") });
    if (!Object.keys(input).length) throw new UsageError("life task assign: pass --executor, --bucket, or --no-bucket");
    return rendered(inv, await inv.tools.task.assign(inv.args[0]!, input as TaskAssign, inv.ctx()));
  },
};

const taskReschedule: Command = {
  usage: "life task reschedule <id> (--due d [--time HH:MM] | --no-due)",
  argNames: ["id"],
  args: [1, 1],
  flags: { due: "value", time: "value", "no-due": "bool" },
  mutates: true,
  async run(inv) {
    const cleared = inv.flags.bool("no-due");
    const due = dueFlag(inv);
    if (cleared && due !== undefined) throw new UsageError("--due and --no-due exclude each other");
    if (!cleared && due === undefined) throw new UsageError("life task reschedule: pass --due d or --no-due");
    return rendered(inv, await inv.tools.task.reschedule(inv.args[0]!, cleared ? null : due!, inv.ctx()));
  },
};

const taskNote: Command = {
  usage: "life task note <id> <text> [--attach name=url]...",
  argNames: ["id", "text"],
  args: [2, 2],
  flags: { attach: "list" },
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.task.note(inv.args[0]!, inv.args[1]!, inv.ctx(), attachments(inv))),
};

const taskHistory: Command = {
  usage: "life task history <id>",
  argNames: ["id"],
  args: [1, 1],
  flags: {},
  mutates: false,
  async run(inv) {
    const id = inv.args[0]!;
    if (!(await inv.tools.task.get(id))) return notFound(`task: no task "${id}"`, `No task "${id}".`);
    const entries = await inv.tools.task.history(id);
    return plain(EXIT.ok, entries, historyText(entries));
  },
};

const taskImport: Command = {
  usage: "life task import <file.json> [--dry-run]",
  argNames: ["file"],
  args: [1, 1],
  flags: { "dry-run": "bool" },
  mutates: true,
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
    return plain(code, result, importText(result));
  },
};

// ---- project commands

const projectAdd: Command = {
  usage: "life project add <name> [--parent ref] [--slug s] [--color c] [--layout list|board] [--label name]...",
  argNames: ["name"],
  args: [1, 1],
  flags: { parent: "value", slug: "value", color: "value", layout: "value", label: "list" },
  mutates: true,
  async run(inv) {
    const f = inv.flags;
    const input = compact({ name: inv.args[0]!, parent: f.str("parent"), slug: f.str("slug"), color: f.str("color"), layout: f.str("layout"), labels: labelsFlag(inv) });
    return rendered(inv, await inv.tools.project.add(input as ProjectAdd, inv.ctx()));
  },
};

const projectTree: Command = {
  usage: "life project tree [--archived]",
  argNames: [],
  args: [0, 0],
  flags: { archived: "bool" },
  mutates: false,
  async run(inv) {
    const tree = await inv.tools.project.tree({ includeArchived: inv.flags.bool("archived") });
    return plain(EXIT.ok, tree, treeText(tree));
  },
};

const projectGet: Command = {
  usage: "life project get <ref>",
  argNames: ["ref"],
  args: [1, 1],
  flags: {},
  mutates: false,
  async run(inv) {
    const project = await inv.tools.project.get(inv.args[0]!);
    if (!project) return notFound(`project: no project "${inv.args[0]}"`, `No project "${inv.args[0]}".`);
    return { code: EXIT.ok, json: project, text: async () => projectDetail(project, await projectIndex(inv.tools)) };
  },
};

const projectVerb = (verb: "archive" | "unarchive" | "restore"): Command => ({
  usage: `life project ${verb} <ref>`,
  argNames: ["ref"],
  args: [1, 1],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.project[verb](inv.args[0]!, inv.ctx())),
});

const projectUpdate: Command = {
  usage: "life project update <ref> [--name] [--slug] [--color|--no-color] [--layout] [--label]...|--no-label",
  argNames: ["ref"],
  args: [1, 1],
  flags: { name: "value", slug: "value", color: "value", "no-color": "bool", layout: "value", label: "list", "no-label": "bool" },
  mutates: true,
  async run(inv) {
    const f = inv.flags;
    const input = compact({ name: f.str("name"), slug: f.str("slug"), color: f.clearable("color"), layout: f.str("layout"), labels: labelsFlag(inv) });
    if (!Object.keys(input).length) throw new UsageError("life project update: nothing to change; pass at least one flag");
    return rendered(inv, await inv.tools.project.update(inv.args[0]!, input as ProjectUpdate, inv.ctx()));
  },
};

const projectMove: Command = {
  usage: "life project move <ref> (--parent ref | --no-parent)",
  argNames: ["ref"],
  args: [1, 1],
  flags: { parent: "value", "no-parent": "bool" },
  mutates: true,
  async run(inv) {
    const parent = inv.flags.clearable("parent");
    if (parent === undefined) throw new UsageError("life project move: pass --parent ref or --no-parent");
    return rendered(inv, await inv.tools.project.move(inv.args[0]!, parent, inv.ctx()));
  },
};

const projectDelete: Command = {
  usage: "life project delete <ref> [--contents delete|inbox]",
  argNames: ["ref"],
  args: [1, 1],
  flags: { contents: "value" },
  mutates: true,
  async run(inv) {
    const opts = compact({ contents: choiceFlag(inv, "contents", ["delete", "inbox"]) }) as { contents?: ProjectContents };
    return rendered(inv, await inv.tools.project.delete(inv.args[0]!, inv.ctx(), opts));
  },
};

const projectReorder: Command = {
  usage: "life project reorder <id> <id>...",
  argNames: ["id"],
  args: [1, null],
  flags: {},
  mutates: true,
  run: async (inv) => renderedAll(inv, await inv.tools.project.reorder(inv.args, inv.ctx())),
};

// ---- section commands

const sectionAdd: Command = {
  usage: "life section add <project-ref> <name>",
  argNames: ["project-ref", "name"],
  args: [2, 2],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.section.add({ project: inv.args[0]!, name: inv.args[1]! }, inv.ctx())),
};

const sectionList: Command = {
  usage: "life section list <project-ref>",
  argNames: ["project-ref"],
  args: [1, 1],
  flags: {},
  mutates: false,
  async run(inv) {
    const sections = await inv.tools.section.list(inv.args[0]!);
    return plain(EXIT.ok, sections, sections.length ? sectionTable(sections) : "No sections.");
  },
};

const sectionUpdate: Command = {
  usage: "life section update <id> --name n",
  argNames: ["id"],
  args: [1, 1],
  flags: { name: "value" },
  mutates: true,
  async run(inv) {
    const name = inv.flags.str("name");
    if (name === undefined) throw new UsageError("life section update: pass --name");
    return rendered(inv, await inv.tools.section.update(inv.args[0]!, { name }, inv.ctx()));
  },
};

const sectionVerb = (verb: "archive" | "unarchive" | "restore"): Command => ({
  usage: `life section ${verb} <id>`,
  argNames: ["id"],
  args: [1, 1],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.section[verb](inv.args[0]!, inv.ctx())),
});

const sectionDelete: Command = {
  usage: "life section delete <id> [--tasks delete|unsection]",
  argNames: ["id"],
  args: [1, 1],
  flags: { tasks: "value" },
  mutates: true,
  async run(inv) {
    const opts = compact({ tasks: choiceFlag(inv, "tasks", ["delete", "unsection"]) }) as { tasks?: SectionTasks };
    return rendered(inv, await inv.tools.section.delete(inv.args[0]!, inv.ctx(), opts));
  },
};

const sectionReorder: Command = {
  usage: "life section reorder <id> <id>...",
  argNames: ["id"],
  args: [1, null],
  flags: {},
  mutates: true,
  run: async (inv) => renderedAll(inv, await inv.tools.section.reorder(inv.args, inv.ctx())),
};

// ---- label commands

const labelAdd: Command = {
  usage: "life label add <name> [--color c]",
  argNames: ["name"],
  args: [1, 1],
  flags: { color: "value" },
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.label.add(compact({ name: inv.args[0]!, color: inv.flags.str("color") }) as LabelAdd, inv.ctx())),
};

const labelList: Command = {
  usage: "life label list",
  argNames: [],
  args: [0, 0],
  flags: {},
  mutates: false,
  async run(inv) {
    const labels = await inv.tools.label.list();
    return plain(EXIT.ok, labels, labels.length ? labelTable(labels) : "No labels.");
  },
};

const labelUpdate: Command = {
  usage: "life label update <ref> [--name] [--color|--no-color]",
  argNames: ["ref"],
  args: [1, 1],
  flags: { name: "value", color: "value", "no-color": "bool" },
  mutates: true,
  async run(inv) {
    const input = compact({ name: inv.flags.str("name"), color: inv.flags.clearable("color") });
    if (!Object.keys(input).length) throw new UsageError("life label update: nothing to change; pass --name, --color, or --no-color");
    return rendered(inv, await inv.tools.label.update(inv.args[0]!, input as LabelUpdate, inv.ctx()));
  },
};

const labelVerb = (verb: "delete" | "restore"): Command => ({
  usage: `life label ${verb} <ref>`,
  argNames: ["ref"],
  args: [1, 1],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.label[verb](inv.args[0]!, inv.ctx())),
});

const labelReorder: Command = {
  usage: "life label reorder <id> <id>...",
  argNames: ["id"],
  args: [1, null],
  flags: {},
  mutates: true,
  run: async (inv) => renderedAll(inv, await inv.tools.label.reorder(inv.args, inv.ctx())),
};

// ---- filter commands

const filterAdd: Command = {
  usage: "life filter add <name> <query>",
  argNames: ["name", "query"],
  args: [2, 2],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.filter.add({ name: inv.args[0]!, query: inv.args[1]! }, inv.ctx())),
};

const filterList: Command = {
  usage: "life filter list",
  argNames: [],
  args: [0, 0],
  flags: {},
  mutates: false,
  async run(inv) {
    const filters = await inv.tools.filter.list();
    return plain(EXIT.ok, filters, filters.length ? filterTable(filters) : "No filters.");
  },
};

const filterRun: Command = {
  usage: "life filter run <ref|query>",
  argNames: ["ref|query"],
  args: [1, 1],
  flags: {},
  mutates: false,
  run: async (inv) => renderedTasks(inv, await inv.tools.views.filter(inv.args[0]!)),
};

const filterUpdate: Command = {
  usage: "life filter update <ref> [--name] [--query]",
  argNames: ["ref"],
  args: [1, 1],
  flags: { name: "value", query: "value" },
  mutates: true,
  async run(inv) {
    const input = compact({ name: inv.flags.str("name"), query: inv.flags.str("query") });
    if (!Object.keys(input).length) throw new UsageError("life filter update: nothing to change; pass --name or --query");
    return rendered(inv, await inv.tools.filter.update(inv.args[0]!, input as FilterUpdate, inv.ctx()));
  },
};

const filterVerb = (verb: "delete" | "restore"): Command => ({
  usage: `life filter ${verb} <ref>`,
  argNames: ["ref"],
  args: [1, 1],
  flags: {},
  mutates: true,
  run: async (inv) => rendered(inv, await inv.tools.filter[verb](inv.args[0]!, inv.ctx())),
});

const filterReorder: Command = {
  usage: "life filter reorder <id> <id>...",
  argNames: ["id"],
  args: [1, null],
  flags: {},
  mutates: true,
  run: async (inv) => renderedAll(inv, await inv.tools.filter.reorder(inv.args, inv.ctx())),
};

// ---- views and maintenance

const today: Command = {
  usage: "life today [--date d]",
  argNames: [],
  args: [0, 0],
  flags: { date: "value" },
  mutates: false,
  async run(inv) {
    const view = await inv.tools.views.today(compact({ date: dateFlag(inv, "date") }));
    return { code: EXIT.ok, json: view, text: async () => todayText(view, await projectIndex(inv.tools)) };
  },
};

const upcoming: Command = {
  usage: "life upcoming [days] [--from d]",
  argNames: ["days"],
  args: [0, 1],
  flags: { from: "value" },
  mutates: false,
  async run(inv) {
    const raw = inv.args[0];
    if (raw !== undefined && !/^\d+$/.test(raw)) throw new UsageError(`life upcoming: days must be a whole number, got "${raw}"`);
    const days = raw === undefined ? undefined : Number(raw);
    const view = await inv.tools.views.upcoming(days, compact({ from: dateFlag(inv, "from") }));
    return { code: EXIT.ok, json: view, text: async () => upcomingText(view, await projectIndex(inv.tools)) };
  },
};

const search: Command = {
  usage: "life search <text>",
  argNames: ["text"],
  args: [1, 1],
  flags: {},
  mutates: false,
  run: async (inv) => renderedTasks(inv, await inv.tools.views.search(inv.args[0]!), "No matches."),
};

const trash: Command = {
  usage: "life trash",
  argNames: [],
  args: [0, 0],
  flags: {},
  mutates: false,
  async run(inv) {
    const view = await inv.tools.views.trash();
    return { code: EXIT.ok, json: view, text: async () => trashText(view, await projectIndex(inv.tools)) };
  },
};

const exportCommand: Command = {
  usage: "life export [file]",
  argNames: ["file"],
  args: [0, 1],
  flags: {},
  mutates: false,
  async run(inv) {
    const dump = await inv.tools.export();
    const file = inv.args[0];
    const body = `${JSON.stringify(dump, null, 2)}\n`;
    if (file === undefined) {
      // A dump is JSON whichever way it is asked for.
      return { code: EXIT.ok, json: dump, text: () => body.trimEnd() };
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

const migrate: Command = {
  usage: "life migrate",
  argNames: [],
  args: [0, 0],
  flags: {},
  mutates: false,
  // The dispatcher opens Tools with migrate: true for this command; by the time run() is called the schema is current.
  run: async () => plain(EXIT.ok, { migrated: true }, "Database migrated."),
};

const COMMANDS: Readonly<Record<string, Command>> = {
  "task add": taskAdd,
  "task get": taskGet,
  "task list": taskList,
  "task update": taskUpdate,
  "task move": taskMove,
  "task reorder": taskReorder,
  "task duplicate": taskDuplicate,
  "task accept": transition("accept"),
  "task start": transition("start"),
  "task uncomplete": transition("uncomplete"),
  "task restore": transition("restore"),
  "task complete": taskComplete,
  "task cancel": transition("cancel"),
  "task delete": taskDelete,
  "task assign": taskAssign,
  "task reschedule": taskReschedule,
  "task note": taskNote,
  "task history": taskHistory,
  "task import": taskImport,
  "project add": projectAdd,
  "project tree": projectTree,
  "project get": projectGet,
  "project archive": projectVerb("archive"),
  "project unarchive": projectVerb("unarchive"),
  "project restore": projectVerb("restore"),
  "project update": projectUpdate,
  "project move": projectMove,
  "project delete": projectDelete,
  "project reorder": projectReorder,
  "section add": sectionAdd,
  "section list": sectionList,
  "section update": sectionUpdate,
  "section archive": sectionVerb("archive"),
  "section unarchive": sectionVerb("unarchive"),
  "section restore": sectionVerb("restore"),
  "section delete": sectionDelete,
  "section reorder": sectionReorder,
  "label add": labelAdd,
  "label list": labelList,
  "label update": labelUpdate,
  "label delete": labelVerb("delete"),
  "label restore": labelVerb("restore"),
  "label reorder": labelReorder,
  "filter add": filterAdd,
  "filter list": filterList,
  "filter run": filterRun,
  "filter update": filterUpdate,
  "filter delete": filterVerb("delete"),
  "filter restore": filterVerb("restore"),
  "filter reorder": filterReorder,
  today,
  upcoming,
  search,
  trash,
  export: exportCommand,
  migrate,
};

// ------------------------------------------------------------------ the dispatcher

async function run(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed === "help") {
    io.stdout.write(USAGE);
    return EXIT.ok;
  }
  const { command, args, flags } = parsed;

  const json = flags.bool("json") || !io.stdout.isTTY;
  const tz = timezoneOf(flags, io);
  const clock: Clock = { now: io.clock ? io.clock.now : () => new Date(), timezone: tz };
  const actor = actorOf(flags, io);
  const ctx = (): Ctx => {
    if (actor === undefined) throw new UsageError("--actor is required when stdin is not a terminal (or set LIFE_ACTOR)");
    return contextOf(actor, flags);
  };
  // Resolve the actor before touching the database, so a missing one is a plain usage error.
  if (command.mutates) ctx();

  const tools = await Tools.open({ url: flags.str("db") ?? io.env.LIFE_DATABASE_URL, clock, migrate: command === migrate });
  try {
    const inv: Invocation = { tools, args, flags, ctx, today: todayIn(tz, clock.now()), tz, json, io };
    let result = await command.run(inv);

    // HANDS D54: a `needs` rejection is a question on a terminal, and a rejection naming the flag otherwise.
    const interactive = Boolean(io.stdin.isTTY && io.stdout.isTTY) && !json;
    if (result.needs && interactive && command.flags[result.needs.field] === "value") {
      const answer = await ask(io, result.needs);
      if (answer !== null) {
        flags.set(result.needs.field, "value", answer);
        result = await command.run(inv);
      }
    }

    if (json) {
      io.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`);
      if (result.needs) io.stderr.write(`life: ${result.needs.message}\n  pass --${result.needs.field} ${result.needs.options.join("|")}\n`);
    } else {
      io.stdout.write(`${await result.text()}\n`);
    }
    return result.code;
  } finally {
    await tools.close();
  }
}

function timezoneOf(flags: Flags, io: CliIo): string {
  const fromFlag = flags.str("tz");
  if (fromFlag !== undefined) {
    if (!isValidTimezone(fromFlag)) throw new UsageError(`--tz: unknown timezone "${fromFlag}"`);
    return fromFlag;
  }
  const fromEnv = io.env.LIFE_TZ;
  if (fromEnv && isValidTimezone(fromEnv)) return fromEnv;
  return defaultTimezone();
}

/** `--actor`, else LIFE_ACTOR, else `neel` only on an interactive terminal. */
function actorOf(flags: Flags, io: CliIo): string | undefined {
  const fromFlag = flags.str("actor");
  if (fromFlag !== undefined) return fromFlag;
  const fromEnv = io.env.LIFE_ACTOR;
  if (fromEnv) return fromEnv;
  return io.stdin.isTTY ? "neel" : undefined;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function receiptText(receipt: Receipt<AnyRecord>, index: Projects): string {
  if (receipt.ok) return `${receipt.outcome} ${receipt.id} v${receipt.version}  ${describe(receipt.record)}`;
  if (receipt.outcome === "duplicate") {
    const n = receipt.candidates.length;
    return [
      `duplicate: ${n} similar open task${n === 1 ? "" : "s"}`,
      taskTable(receipt.candidates as Task[], index, "  "),
      "  pass --allow-duplicate to add anyway",
    ].join("\n");
  }
  const lines = [`rejected${receipt.id ? ` ${receipt.id}` : ""}`, ...receipt.issues.map((issue) => `  - ${issue}`)];
  if (receipt.needs) lines.push(`  pass --${receipt.needs.field} ${receipt.needs.options.join("|")}`);
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
  const rows = result.items
    .filter((item) => item.outcome !== "created")
    .map((item) => [`#${item.index}`, item.outcome, item.id ?? "", item.issues.join("; ")]);
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
