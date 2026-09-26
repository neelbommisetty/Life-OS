import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_API_URL = "http://127.0.0.1:4319";
export const API_TOKEN_FILE = fileURLToPath(new URL("../../../../.local/api/token", import.meta.url));

/** Only the default local API uses a local token file; a remote client must
 * explicitly supply its token. Client configuration never loads backend .env. */
export async function clientConfig(env: Record<string, string | undefined>, url = env.LIFE_API_URL ?? DEFAULT_API_URL) {
  let token = env.LIFE_API_TOKEN;
  if (!token && url.replace(/\/$/, "") === DEFAULT_API_URL) {
    try { token = (await readFile(API_TOKEN_FILE, "utf8")).trim(); } catch {}
  }
  return { url, token: token ?? "" };
}

/** Generate once for the local service; never print or commit it. */
export async function serverToken(env: Record<string, string | undefined>): Promise<string> {
  if (env.LIFE_API_TOKEN) return env.LIFE_API_TOKEN;
  await mkdir(dirname(API_TOKEN_FILE), { recursive: true, mode: 0o700 });
  try { await writeFile(API_TOKEN_FILE, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return (await readFile(API_TOKEN_FILE, "utf8")).trim();
}
