// The filter grammar: a Todoist-like subset, parsed once and evaluated against
// tasks with a small context the operations layer prepares. Anything outside
// the subset is rejected with a message, never guessed.
//
//   today | tomorrow | yesterday | overdue | no date | no deadline | no priority
//   N days | due: X | due before: X | due after: X
//   deadline: X | deadline before: X | deadline after: X
//   #project (that project) | ##project (with sub-projects) | @label
//   p1..p4 | assigned to: X | status: S | open | done | cancelled | all
//   subtask | recurring | search: text
//   combined with &, |, !, and parentheses.

import { isValidDate, relativeDate, addDays } from "./time.ts";

export type Term =
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "yesterday" }
  | { kind: "overdue" }
  | { kind: "no_date" }
  | { kind: "no_deadline" }
  | { kind: "no_priority" }
  | { kind: "days"; n: number }
  | { kind: "due"; op: "on" | "before" | "after"; value: string }
  | { kind: "deadline"; op: "on" | "before" | "after"; value: string }
  | { kind: "project"; ref: string; withSubprojects: boolean }
  | { kind: "label"; name: string }
  | { kind: "priority"; value: number }
  | { kind: "executor"; value: string }
  | { kind: "status"; value: string }
  | { kind: "all" }
  | { kind: "subtask" }
  | { kind: "recurring" }
  | { kind: "search"; text: string };

export type FilterNode =
  | { type: "and"; left: FilterNode; right: FilterNode }
  | { type: "or"; left: FilterNode; right: FilterNode }
  | { type: "not"; expr: FilterNode }
  | { type: "term"; term: Term };

export type ParseResult = { ok: true; ast: FilterNode } | { ok: false; error: string };

const STATUSES = ["proposed", "accepted", "in_progress", "done", "cancelled"];

type Token = { type: "op"; value: "&" | "|" | "!" | "(" | ")" } | { type: "term"; value: string };

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  let current = "";
  let quote: string | null = null;
  const flush = () => {
    const value = current.trim();
    if (value) tokens.push({ type: "term", value });
    current = "";
  };
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if ("&|!()".includes(ch)) {
      flush();
      tokens.push({ type: "op", value: ch as "&" | "|" | "!" | "(" | ")" });
    } else current += ch;
  }
  if (quote) return "Unclosed quote";
  flush();
  return tokens;
}

function dateArg(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (["today", "tomorrow", "yesterday"].includes(lowered) || /^[+-]\d{1,3}[dw]$/.test(lowered))
    return lowered;
  return isValidDate(value) ? value : null;
}

function parseTerm(raw: string): Term | string {
  const value = raw.trim();
  const lowered = value.toLowerCase();
  const simple: Record<string, Term> = {
    today: { kind: "today" },
    tomorrow: { kind: "tomorrow" },
    yesterday: { kind: "yesterday" },
    overdue: { kind: "overdue" },
    "no date": { kind: "no_date" },
    "no due date": { kind: "no_date" },
    "no deadline": { kind: "no_deadline" },
    "no priority": { kind: "no_priority" },
    subtask: { kind: "subtask" },
    recurring: { kind: "recurring" },
    all: { kind: "all" },
    open: { kind: "status", value: "open" },
    done: { kind: "status", value: "done" },
    completed: { kind: "status", value: "done" },
    cancelled: { kind: "status", value: "cancelled" },
    proposed: { kind: "status", value: "proposed" },
  };
  if (simple[lowered]) return simple[lowered]!;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,3}) days?$/.exec(lowered))) return { kind: "days", n: Number(match[1]) };
  if ((match = /^next (\d{1,3}) days?$/.exec(lowered))) return { kind: "days", n: Number(match[1]) };
  if ((match = /^p([1-4])$/.exec(lowered))) return { kind: "priority", value: Number(match[1]) };
  if ((match = /^(due|deadline)(?:\s+(before|after))?\s*:\s*(.+)$/.exec(lowered))) {
    const date = dateArg(match[3]!);
    if (!date) return `${match[1]}: expected today, tomorrow, +Nd, or YYYY-MM-DD, got "${match[3]}"`;
    const op = (match[2] ?? "on") as "on" | "before" | "after";
    return match[1] === "due" ? { kind: "due", op, value: date } : { kind: "deadline", op, value: date };
  }
  if ((match = /^##(.+)$/.exec(value))) return { kind: "project", ref: match[1]!.trim().toLowerCase(), withSubprojects: true };
  if ((match = /^#(.+)$/.exec(value))) return { kind: "project", ref: match[1]!.trim().toLowerCase(), withSubprojects: false };
  if ((match = /^@(.+)$/.exec(value))) return { kind: "label", name: match[1]!.trim().toLowerCase() };
  if ((match = /^(?:assigned to|executor)\s*:\s*(.+)$/.exec(lowered))) return { kind: "executor", value: match[1]!.trim() };
  if ((match = /^status\s*:\s*(.+)$/.exec(lowered))) {
    const status = match[1]!.trim().replace("-", "_");
    if (status !== "open" && !STATUSES.includes(status)) return `status: expected one of ${STATUSES.join(", ")}, got "${status}"`;
    return { kind: "status", value: status };
  }
  if ((match = /^search\s*:\s*(.+)$/i.exec(value))) return { kind: "search", text: match[1]!.trim().toLowerCase() };
  return `Unknown filter term "${value}"`;
}

export function parseFilter(input: string): ParseResult {
  const tokens = tokenize(input);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  if (!tokens.length) return { ok: false, error: "Empty filter" };
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];
  let error: string | null = null;

  function parseOr(): FilterNode | null {
    let left = parseAnd();
    if (!left) return null;
    while (peek()?.type === "op" && (peek() as { value: string }).value === "|") {
      next();
      const right = parseAnd();
      if (!right) return null;
      left = { type: "or", left, right };
    }
    return left;
  }
  function parseAnd(): FilterNode | null {
    let left = parseNot();
    if (!left) return null;
    while (peek()?.type === "op" && (peek() as { value: string }).value === "&") {
      next();
      const right = parseNot();
      if (!right) return null;
      left = { type: "and", left, right };
    }
    return left;
  }
  function parseNot(): FilterNode | null {
    const token = peek();
    if (!token) {
      error = "Unexpected end of filter";
      return null;
    }
    if (token.type === "op" && token.value === "!") {
      next();
      const expr = parseNot();
      return expr ? { type: "not", expr } : null;
    }
    if (token.type === "op" && token.value === "(") {
      next();
      const expr = parseOr();
      if (!expr) return null;
      const close = next();
      if (!close || close.type !== "op" || close.value !== ")") {
        error = "Missing closing parenthesis";
        return null;
      }
      return expr;
    }
    if (token.type === "op") {
      error = `Unexpected "${token.value}"`;
      return null;
    }
    next();
    const term = parseTerm(token.value);
    if (typeof term === "string") {
      error = term;
      return null;
    }
    return { type: "term", term };
  }

  const ast = parseOr();
  if (!ast) return { ok: false, error: error ?? "Invalid filter" };
  if (index < tokens.length) {
    const extra = tokens[index]!;
    return { ok: false, error: `Unexpected "${extra.value}"` };
  }
  return { ok: true, ast };
}

/** True when the query says anything about status, so the open-only default should not apply. */
export function mentionsStatus(node: FilterNode): boolean {
  switch (node.type) {
    case "term":
      return node.term.kind === "status" || node.term.kind === "all";
    case "not":
      return mentionsStatus(node.expr);
    default:
      return mentionsStatus(node.left) || mentionsStatus(node.right);
  }
}

/** What the evaluator needs to know about one task, prepared by the operations layer. */
export type FilterSubject = {
  status: string;
  dueDate: string | null;
  deadline: string | null;
  priority: number | null;
  executor: string;
  hasParent: boolean;
  recurring: boolean;
  /** The task's own labels plus its project's. */
  labels: string[];
  /** Slug paths of the task's project and, first, of every ancestor. Lowercase. */
  projectPaths: string[];
  /** The task's own project path (last element of projectPaths). */
  projectPath: string;
  /** The task's project id and ancestor ids, for `#id` references. */
  projectIds: string[];
  searchable: string;
};

const resolve = (value: string, today: string) => relativeDate(value, today) ?? value;

export function matches(node: FilterNode, subject: FilterSubject, today: string): boolean {
  switch (node.type) {
    case "and":
      return matches(node.left, subject, today) && matches(node.right, subject, today);
    case "or":
      return matches(node.left, subject, today) || matches(node.right, subject, today);
    case "not":
      return !matches(node.expr, subject, today);
    case "term":
      return matchTerm(node.term, subject, today);
  }
}

function matchTerm(term: Term, s: FilterSubject, today: string): boolean {
  switch (term.kind) {
    case "today":
      return s.dueDate === today;
    case "tomorrow":
      return s.dueDate === addDays(today, 1);
    case "yesterday":
      return s.dueDate === addDays(today, -1);
    case "overdue":
      return s.dueDate !== null && s.dueDate < today;
    case "no_date":
      return s.dueDate === null;
    case "no_deadline":
      return s.deadline === null;
    case "no_priority":
      return s.priority === null;
    case "days":
      return s.dueDate !== null && s.dueDate >= today && s.dueDate <= addDays(today, term.n);
    case "due":
    case "deadline": {
      const actual = term.kind === "due" ? s.dueDate : s.deadline;
      if (actual === null) return false;
      const target = resolve(term.value, today);
      return term.op === "on" ? actual === target : term.op === "before" ? actual < target : actual > target;
    }
    case "project": {
      const ref = term.ref;
      const own = s.projectPath === ref || s.projectIds[s.projectIds.length - 1] === ref;
      if (own) return true;
      if (!term.withSubprojects) return false;
      return s.projectPaths.includes(ref) || s.projectIds.includes(ref) || s.projectPath.startsWith(ref + "/");
    }
    case "label":
      return s.labels.includes(term.name);
    case "priority":
      return s.priority === term.value;
    case "executor":
      return s.executor === term.value;
    case "status":
      return term.value === "open"
        ? ["proposed", "accepted", "in_progress"].includes(s.status)
        : s.status === term.value;
    case "all":
      return true;
    case "subtask":
      return s.hasParent;
    case "recurring":
      return s.recurring;
    case "search":
      return s.searchable.includes(term.text);
  }
}
