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

export function messageOf(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length) return error.errors.map(messageOf).join("; ");
  return error instanceof Error ? error.message : String(error);
}

/** Connection, authentication, missing-database, and not-migrated failures: the database is not usable. */
export function isDatabaseError(error: unknown): boolean {
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
export function sqlDetails(error: unknown): string[] {
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
export function isInternalError(error: unknown): boolean {
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
