// Refresh tokens live outside the database, one file per account in
// .local/google/<accountId>.json at the repository root, mode 0600. This module
// is the only reader and writer of those files. It never logs their contents
// and its errors name the path, never what was in it.

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What one credential file holds. */
export type Credential = {
  identity: string;
  refreshToken: string;
  scopes: string[];
  obtainedAt: string;
};

/** The default directory: `.local/google/` at the repository root, resolved from this file the way `src/db/client.ts` resolves `.env`. */
export const CREDENTIALS_DIR = fileURLToPath(new URL("../../../../.local/google/", import.meta.url));

/** Account ids are file names; anything outside this set is refused so a ref can never escape the directory. */
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;

function isCredential(value: unknown): value is Credential {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.identity === "string" &&
    record.identity.length > 0 &&
    typeof record.refreshToken === "string" &&
    record.refreshToken.length > 0 &&
    Array.isArray(record.scopes) &&
    record.scopes.every((scope) => typeof scope === "string") &&
    typeof record.obtainedAt === "string"
  );
}

/**
 * The credential files of one directory. Construct with no argument for the
 * repository's `.local/google/`; tests point it at a temp directory.
 */
export class CredentialStore {
  readonly dir: string;

  constructor(dir: string = CREDENTIALS_DIR) {
    this.dir = dir;
  }

  /** The file an account's credential lives in. Throws on an id that is not a plain file name. */
  path(accountId: string): string {
    if (!ACCOUNT_ID.test(accountId)) throw new Error(`Not a credential id: ${JSON.stringify(accountId)}`);
    return join(this.dir, `${accountId}.json`);
  }

  /** The credential, or null when there is no file. A file that is not a credential throws, naming the path. */
  async read(accountId: string): Promise<Credential | null> {
    const path = this.path(accountId);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Credential file is not valid JSON: ${path}`);
    }
    if (!isCredential(parsed)) throw new Error(`Credential file does not hold a credential: ${path}`);
    return { identity: parsed.identity, refreshToken: parsed.refreshToken, scopes: [...parsed.scopes], obtainedAt: parsed.obtainedAt };
  }

  /** True when a credential file exists, without reading it. */
  async exists(accountId: string): Promise<boolean> {
    try {
      await stat(this.path(accountId));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Write the credential (replacing any existing one) with mode 0600 in a
   * 0700 directory. The write goes to a sibling temp file first and is renamed
   * into place, so a crash never leaves a half-written token. Returns the path.
   */
  async write(accountId: string, credential: Credential): Promise<string> {
    const path = this.path(accountId);
    if (!isCredential(credential)) throw new Error(`Refusing to write an incomplete credential for ${accountId}`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    const body = JSON.stringify(
      { identity: credential.identity, refreshToken: credential.refreshToken, scopes: credential.scopes, obtainedAt: credential.obtainedAt },
      null,
      2,
    );
    try {
      await writeFile(temp, `${body}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    return path;
  }

  /** Remove the credential file. Returns true when there was one. */
  async delete(accountId: string): Promise<boolean> {
    const path = this.path(accountId);
    try {
      await rm(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * The ids of every credential file in the directory, sorted: account ids and
   * any provisional `pending-*` file a sign-in left behind. `life doctor` uses
   * it to warn on a file no live account owns. Empty when the directory does
   * not exist yet; the temp files of an interrupted write are not listed.
   */
  async list(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter((id) => ACCOUNT_ID.test(id))
      .sort();
  }

  /**
   * Move a credential from one id to another (the OAuth flow stores it under a
   * provisional id; `account.add` adopts it under the account's). Returns false
   * when there was nothing under `fromId`. An existing file under `toId` is
   * replaced.
   */
  async rename(fromId: string, toId: string): Promise<boolean> {
    const from = this.path(fromId);
    const to = this.path(toId);
    if (from === to) return this.exists(fromId);
    try {
      await rename(from, to);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";
}
