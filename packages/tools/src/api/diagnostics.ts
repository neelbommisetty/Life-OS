import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Account, Calendar } from "../contract.ts";
import type { Clock } from "../core.ts";
import { createPool, databaseUrl } from "../db/client.ts";
import { CredentialStore } from "../calendar/credentials.ts";
import { GoogleOAuth, NeedsReauth, googleClientIdPresent } from "../calendar/google/oauth.ts";
import { maxAgeFromEnv } from "../calendar/schedule.ts";
import { CatalogUnconfigured, HttpError, MEDIA_BY_SOURCE, readEnv } from "../media/catalog/adapter.ts";
import { IGDB_TOKEN_DIR, igdbTokenFresh, igdbTokenPath, readIgdbToken } from "../media/catalog/igdb.ts";
import { defaultCatalogs, type Catalogs } from "../media/catalog/index.ts";
import { SOURCE_NAMES, normalizeRegion } from "../media/catalog/links.ts";
import { findInbox } from "../organize.ts";
import { PgStore } from "../store.ts";
import { defaultTimezone, isValidTimezone } from "../time.ts";
import { describeUrl, messageOf, sqlDetails } from "./errors.ts";
const ENV_FILE = fileURLToPath(new URL("../../../../.env", import.meta.url));
const MIGRATIONS_JOURNAL = fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url));
export type DiagnosticsOptions = {
  env?: Record<string, string | undefined>;
  clock?: Clock;
  credentials?: CredentialStore;
  refreshToken?: (accountId: string) => Promise<void>;
  catalogs?: Catalogs;
  igdbTokenDir?: string;
  url?: string;
};
type Setup = {
  db: DbSource;
  flags: { bool(name: string): boolean };
  io: DiagnosticsOptions & { env: Record<string, string | undefined> };
  tz: string; tzSource: string; actor?: string; actorSource: string;
  trace(line: string): void;
};
export function diagnosticsSetup(options: DiagnosticsOptions, request: { online?: boolean; timezone?: string; actor?: string } = {}): Setup {
  let url = options.url ?? options.env?.LIFE_DATABASE_URL;
  if (!url) { try { url = databaseUrl(); } catch {} }
  return {
    db: { url, source: "API server configuration", envFile: ENV_FILE, envFileExists: existsSync(ENV_FILE), envFileRead: !options.url && !options.env?.LIFE_DATABASE_URL },
    flags: { bool: (name) => name === "online" && request.online === true },
    io: { ...options, env: options.env ?? process.env },
    tz: request.timezone ?? options.clock?.timezone ?? defaultTimezone(), tzSource: request.timezone ? "API request" : "API server", actor: request.actor, actorSource: "API request",
    trace: () => {},
  };
}
type CheckStatus = "ok" | "warn" | "fail";
type Check = { name: string; status: CheckStatus; value: string; hint?: string };
export type DoctorReport = { healthy: boolean; checks: Check[] };

/** Where the database URL came from, for doctor and for database-failure hints. */
export type DbSource = {
  url: string | undefined;
  /** Server configuration source; never an API-supplied database URL. */
  source: string;
  envFile: string;
  envFileExists: boolean;
  /** True when the .env file supplied the URL. */
  envFileRead: boolean;
};

export async function runDoctor(setup: Setup): Promise<DoctorReport> {
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
      hint: `set LIFE_DATABASE_URL in the environment or in ${db.envFile}, in the API server configuration`,
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
        await calendarChecks(setup, new PgStore(pool), checks);
      } else {
        checks.push({ name: "inbox", status: "warn", value: connected ? "unknown until migrated" : "unknown until connected" });
        checks.push(googleClientCheck(setup, false));
        checks.push({ name: "accounts", status: "warn", value: connected ? "unknown until migrated" : "unknown until connected" });
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  } else {
    checks.push({ name: "connectivity", status: "fail", value: "no URL to connect to", hint: "run `life doctor` again once LIFE_DATABASE_URL is set" });
    checks.push({ name: "migrations", status: "warn", value: "unknown until connected" });
    checks.push({ name: "inbox", status: "warn", value: "unknown until connected" });
    checks.push(googleClientCheck(setup, false));
    checks.push({ name: "accounts", status: "warn", value: "unknown until connected" });
  }

  checks.push(...(await catalogChecks(setup)));

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

/** LIFE_GOOGLE_CLIENT_ID present or not; the secret is never read here. A missing id is a warning: the token check below is what fails when an account really cannot refresh. */
function googleClientCheck(setup: Setup, accountsConnected: boolean): Check {
  if (googleClientIdPresent(setup.io.env)) return { name: "google client", status: "ok", value: "LIFE_GOOGLE_CLIENT_ID is set (the secret is never shown)" };
  return {
    name: "google client",
    status: "warn",
    value: `LIFE_GOOGLE_CLIENT_ID is not set${accountsConnected ? "; the connected accounts cannot refresh their tokens through Google" : " (needed for `life account add google` and every sync)"}`,
    hint: `put Life-OS's Google OAuth desktop client in ${ENV_FILE} as LIFE_GOOGLE_CLIENT_ID and LIFE_GOOGLE_CLIENT_SECRET`,
  };
}

/** The calendar half of doctor: the Google client, each account with its credential and token, each calendar's copy age, the primary account. */
async function calendarChecks(setup: Setup, store: PgStore, checks: Check[]): Promise<void> {
  let accounts: Account[];
  let calendars: Calendar[];
  try {
    ({ accounts, calendars } = await store.read(async (tx) => ({ accounts: await tx.all("account"), calendars: await tx.all("calendar") })));
  } catch (error) {
    checks.push(googleClientCheck(setup, false));
    checks.push({ name: "accounts", status: "fail", value: `cannot read accounts: ${messageOf(error)}`, hint: "run `life migrate`" });
    return;
  }
  accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  checks.push(googleClientCheck(setup, accounts.some((account) => account.status === "connected")));
  const credentials = setup.io.credentials ?? new CredentialStore();
  if (!accounts.length) {
    checks.push({ name: "accounts", status: "ok", value: "none connected; the schedule shows tasks only until `life account add google`" });
    checks.push(await credentialFilesCheck(setup, credentials, accounts));
    return;
  }
  const refresh = setup.io.refreshToken ?? (async (accountId: string) => void (await new GoogleOAuth({ credentials }).refreshAccessToken(accountId)));
  const now = (setup.io.clock?.now() ?? new Date()).getTime();
  const maxAge = maxAgeFromEnv(setup.io.env);
  const primary = accounts.find((account) => account.primary);
  checks.push(primary ? { name: "primary account", status: "ok", value: `${primary.identity} (${primary.id})` } : { name: "primary account", status: "fail", value: "no account is primary", hint: "run `life account primary <ref>`" });

  for (const account of accounts) {
    const summary = `${account.id}; ${account.status}${account.primary ? "; primary" : ""}; ${account.syncedAt ? `synced ${account.syncedAt}` : "never synced"}`;
    checks.push(
      account.status === "connected"
        ? { name: `account ${account.identity}`, status: "ok", value: summary }
        : account.status === "needs_reauth"
          ? { name: `account ${account.identity}`, status: "fail", value: summary, hint: "run `life account add google` and pick this account to sign in again" }
          : { name: `account ${account.identity}`, status: "warn", value: summary },
    );

    const credentialName = `credential ${account.identity}`;
    let present = false;
    try {
      present = await credentials.exists(account.id);
    } catch (error) {
      setup.trace(`doctor: credential check failed for ${account.id}: ${messageOf(error)}`);
    }
    if (!present) {
      checks.push({ name: credentialName, status: "fail", value: `no credential file at ${credentials.path(account.id)}`, hint: "run `life account add google` and pick this account to sign in again" });
    } else if (account.status !== "connected") {
      checks.push({ name: credentialName, status: "warn", value: `file present; token refresh not tried while the account is ${account.status}` });
    } else {
      try {
        await refresh(account.id);
        checks.push({ name: credentialName, status: "ok", value: "file present; token refresh works" });
      } catch (error) {
        setup.trace(`doctor: token refresh failed for ${account.id}: ${messageOf(error)}`);
        checks.push({ name: credentialName, status: "fail", value: `file present; token refresh failed: ${messageOf(error)}`, hint: error instanceof NeedsReauth ? "run `life account add google` and pick this account to sign in again" : "check LIFE_GOOGLE_CLIENT_ID and LIFE_GOOGLE_CLIENT_SECRET and the network, then run `life doctor` again" });
      }
    }

    const own = calendars.filter((calendar) => calendar.accountId === account.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    if (!own.length) checks.push({ name: `calendars ${account.identity}`, status: "warn", value: "none synced yet", hint: "run `life account sync`" });
    for (const calendar of own) {
      const age = calendar.syncedAt === null ? null : Math.max(0, Math.floor((now - Date.parse(calendar.syncedAt)) / 1000));
      const copy = age === null ? "copy never synced" : `copy ${age}s old`;
      const value = `${calendar.id}; ${copy}${calendar.hidden ? "; hidden" : ""}${calendar.writable ? "" : "; read-only"}${calendar.syncError ? `; last sync failed: ${calendar.syncError}` : ""}`;
      const name = `calendar ${account.identity}/${calendar.name}`;
      if (calendar.syncError) checks.push({ name, status: "fail", value, hint: "run `life sync`; if it keeps failing, `life account add google` reconnects the account" });
      else if (age === null || age > maxAge) checks.push({ name, status: "warn", value: `${value}; older than LIFE_CAL_MAX_AGE (${maxAge}s), the next view refreshes it`, hint: "run `life sync`" });
      else checks.push({ name, status: "ok", value });
    }
  }
  checks.push(await credentialFilesCheck(setup, credentials, accounts));
}

/**
 * The credential directory against the live accounts. A `pending-*` file is a
 * sign-in that never became an account (account add failed after the browser
 * step); any other file no live account owns was left behind by a failed or
 * removed account. Each holds a refresh token Google still honours, so they
 * are named with the command that removes them.
 */
async function credentialFilesCheck(setup: Setup, credentials: CredentialStore, accounts: Account[]): Promise<Check> {
  const name = "credential files";
  let ids: string[];
  try {
    ids = await credentials.list();
  } catch (error) {
    setup.trace(`doctor: cannot list ${credentials.dir}: ${messageOf(error)}`);
    return { name, status: "warn", value: `cannot list ${credentials.dir}: ${messageOf(error)}`, hint: "check the directory's permissions" };
  }
  if (!ids.length) return { name, status: "ok", value: `none yet in ${credentials.dir}; the first account add creates one` };
  const live = new Set(accounts.map((account) => account.id));
  const orphans = ids.filter((id) => !live.has(id));
  if (!orphans.length) return { name, status: "ok", value: `${ids.length} in ${credentials.dir}, each a live account's` };
  const pending = orphans.filter((id) => id.startsWith("pending-")).length;
  const plural = orphans.length === 1 ? "" : "s";
  const why = pending ? `; pending-* is a sign-in that never became an account` : "";
  const files = orphans.map((id) => `${id}.json`);
  return {
    name,
    status: "warn",
    value: `${orphans.length} of ${ids.length} file${ids.length === 1 ? "" : "s"} in ${credentials.dir} belong${plural ? "" : "s"} to no live account: ${files.join(", ")}${why}`,
    hint: `each holds a live refresh token; delete the file${plural}: rm ${orphans.map((id) => JSON.stringify(credentials.path(id))).join(" ")}; then revoke Life-OS under https://myaccount.google.com/permissions if that Google account keeps no other connection here`,
  };
}

/** The variables each keyed source reads; Open Library needs none. */
const CATALOG_VARIABLES: Record<CatalogSourceName, string[]> = { tmdb: ["LIFE_TMDB_KEY"], openlibrary: [], igdb: ["LIFE_IGDB_CLIENT_ID", "LIFE_IGDB_CLIENT_SECRET"] };
type CatalogSourceName = keyof Catalogs;
const CATALOG_SOURCES: readonly CatalogSourceName[] = ["tmdb", "openlibrary", "igdb"];
/** What --online searches for at each source: a name every source knows. */
const ONLINE_PROBE: Record<CatalogSourceName, string> = { tmdb: "Dune", openlibrary: "Dune", igdb: "Celeste" };

/**
 * The library half of doctor: each catalog's variables present or not (values
 * never shown), the IGDB token file and its expiry, LIFE_REGION, and with
 * --online one live search per configured source through the catalogs the CLI
 * was given.
 */
async function catalogChecks(setup: Setup): Promise<Check[]> {
  const checks: Check[] = [];
  const env = setup.io.env;
  const missing = (source: CatalogSourceName): string[] => CATALOG_VARIABLES[source].filter((variable) => readEnv(env, variable) === undefined);
  const configured = (source: CatalogSourceName): boolean => missing(source).length === 0;
  const media = (source: CatalogSourceName): string => MEDIA_BY_SOURCE[source].map((m) => `${m}s`).join(" and ");
  for (const source of CATALOG_SOURCES) {
    const name = `catalog ${source}`;
    const variables = CATALOG_VARIABLES[source];
    if (!variables.length) {
      checks.push({ name, status: "ok", value: `${SOURCE_NAMES[source]} needs no key; ${media(source)} look up there` });
      continue;
    }
    const absent = missing(source);
    if (!absent.length) checks.push({ name, status: "ok", value: `${variables.join(" and ")} ${variables.length === 1 ? "is" : "are"} set (never shown); ${media(source)} look up at ${SOURCE_NAMES[source]}` });
    else {
      checks.push({
        name,
        status: "warn",
        value: `${absent.join(" and ")} ${absent.length === 1 ? "is" : "are"} not set; ${media(source)} are created without a catalog (add warns, lookup is rejected)`,
        hint: `put ${variables.join(" and ")} in ${ENV_FILE}${source === "tmdb" ? " (a TMDB v4 read access token)" : " (a Twitch developer app)"}; \`refresh\` links the titles added meanwhile`,
      });
    }
  }

  const tokenDir = setup.io.igdbTokenDir ?? IGDB_TOKEN_DIR;
  const tokenPath = igdbTokenPath(tokenDir);
  const token = await readIgdbToken(tokenDir);
  const now = setup.io.clock?.now() ?? new Date();
  if (!token) checks.push({ name: "igdb token", status: "ok", value: `no token file at ${tokenPath} yet; ${configured("igdb") ? "the first game lookup creates it" : "not needed until LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are set"}` });
  else if (igdbTokenFresh(token, now)) checks.push({ name: "igdb token", status: "ok", value: `file present at ${tokenPath}; expires ${token.expiresAt}` });
  else checks.push({ name: "igdb token", status: "warn", value: `file present at ${tokenPath}; ${Date.parse(token.expiresAt) <= now.getTime() ? "expired" : "expires within a day"} (${token.expiresAt}); the next game lookup refreshes it${configured("igdb") ? "" : ", once LIFE_IGDB_CLIENT_ID and LIFE_IGDB_CLIENT_SECRET are set"}` });

  const rawRegion = readEnv(env, "LIFE_REGION");
  checks.push({ name: "region", status: "ok", value: `${normalizeRegion(rawRegion)} (${rawRegion === undefined ? "default; set LIFE_REGION to change it" : `LIFE_REGION${normalizeRegion(rawRegion) !== rawRegion ? `="${rawRegion}", normalized` : ""}`})` });

  if (!setup.flags.bool("online")) return checks;
  const catalogs = setup.io.catalogs ?? defaultCatalogs({ env });
  for (const source of CATALOG_SOURCES) {
    const name = `catalog ${source} online`;
    if (!configured(source)) {
      checks.push({ name, status: "warn", value: "skipped: not configured" });
      continue;
    }
    const medium = MEDIA_BY_SOURCE[source][0]!;
    const probe = ONLINE_PROBE[source];
    try {
      const hits = await catalogs[source].search(medium, probe);
      checks.push({ name, status: "ok", value: `${SOURCE_NAMES[source]} answered: ${hits.length} candidate${hits.length === 1 ? "" : "s"} for "${probe}"` });
    } catch (error) {
      setup.trace(`doctor: ${source} search failed: ${messageOf(error)}`);
      if (error instanceof CatalogUnconfigured) checks.push({ name, status: "warn", value: `skipped: ${error.variable} is not set`, hint: `put ${error.variable} in ${ENV_FILE}` });
      else checks.push({ name, status: "fail", value: `${SOURCE_NAMES[source]} could not answer a search for "${probe}": ${messageOf(error)}`, hint: error instanceof HttpError ? "the source refused: check the key" : "check the network and the source's status, then run `life doctor --online` again" });
    }
  }
  return checks;
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
