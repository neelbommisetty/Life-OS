import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { CREDENTIALS_DIR, CredentialStore, type Credential } from "./credentials.ts";

const roots: string[] = [];
async function tempStore(): Promise<CredentialStore> {
  const root = await mkdtemp(join(tmpdir(), "life-credentials-"));
  roots.push(root);
  return new CredentialStore(join(root, ".local", "google"));
}
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const credential: Credential = {
  identity: "neel@example.com",
  refreshToken: "1//refresh-token-secret",
  scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/userinfo.email"],
  obtainedAt: "2026-09-09T12:00:00Z",
};

test("the default directory is .local/google at the repository root", () => {
  assert.ok(CREDENTIALS_DIR.endsWith(`${sep}.local${sep}google${sep}`), CREDENTIALS_DIR);
  assert.ok(!CREDENTIALS_DIR.includes(`${sep}packages${sep}`), "resolved above packages/, at the repository root");
});

test("write then read round-trips, creates the directory, and sets the modes", async () => {
  const store = await tempStore();
  assert.equal(await store.read("a_abc123"), null);
  assert.equal(await store.exists("a_abc123"), false);

  const path = await store.write("a_abc123", credential);
  assert.equal(path, join(store.dir, "a_abc123.json"));
  assert.deepEqual(await store.read("a_abc123"), credential);
  assert.equal(await store.exists("a_abc123"), true);

  const file = await stat(path);
  assert.equal(file.mode & 0o777, 0o600, "file is owner read/write only");
  const dir = await stat(store.dir);
  assert.equal(dir.mode & 0o777, 0o700, "directory is owner only");

  const onDisk = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(onDisk).sort(), ["identity", "obtainedAt", "refreshToken", "scopes"]);
  assert.deepEqual(await readdir(store.dir), ["a_abc123.json"], "no temp file left behind");
});

test("write replaces an existing credential and leaves nothing else behind", async () => {
  const store = await tempStore();
  await store.write("a_one", credential);
  await store.write("a_one", { ...credential, refreshToken: "1//rotated", obtainedAt: "2026-09-10T00:00:00Z" });
  const read = await store.read("a_one");
  assert.equal(read?.refreshToken, "1//rotated");
  assert.equal(read?.obtainedAt, "2026-09-10T00:00:00Z");
  assert.deepEqual(await readdir(store.dir), ["a_one.json"]);
});

test("delete removes the file and reports whether there was one", async () => {
  const store = await tempStore();
  await store.write("a_gone", credential);
  assert.equal(await store.delete("a_gone"), true);
  assert.equal(await store.read("a_gone"), null);
  assert.equal(await store.delete("a_gone"), false);
});

test("rename moves a credential from a provisional id to the account's", async () => {
  const store = await tempStore();
  await store.write("pending-1", credential);
  assert.equal(await store.rename("pending-1", "a_final"), true);
  assert.equal(await store.exists("pending-1"), false);
  assert.deepEqual(await store.read("a_final"), credential);
  assert.equal(await store.rename("pending-1", "a_other"), false, "nothing left under the old id");
  assert.equal(await store.rename("a_final", "a_final"), true, "renaming onto itself is a no-op that reports presence");
});

test("list names every credential file, provisional ones included, and nothing else", async () => {
  const store = await tempStore();
  assert.deepEqual(await store.list(), [], "no directory yet is an empty list, not an error");
  await store.write("a_zeta", credential);
  await store.write("pending-k9x", credential);
  await store.write("a_alpha", credential);
  await writeFile(join(store.dir, "a_alpha.json.deadbeef.tmp"), "half-written");
  await writeFile(join(store.dir, "notes.txt"), "not a credential");
  await writeFile(join(store.dir, ".hidden.json"), "{}");
  assert.deepEqual(await store.list(), ["a_alpha", "a_zeta", "pending-k9x"]);
  await store.delete("pending-k9x");
  assert.deepEqual(await store.list(), ["a_alpha", "a_zeta"]);
});

test("ids that are not plain file names are refused, so nothing escapes the directory", async () => {
  const store = await tempStore();
  for (const bad of ["../escape", "a/b", "", ".hidden", "a b", "x".repeat(200)]) {
    assert.throws(() => store.path(bad), /Not a credential id/, JSON.stringify(bad));
    await assert.rejects(store.read(bad), /Not a credential id/);
    await assert.rejects(store.write(bad, credential), /Not a credential id/);
    await assert.rejects(store.delete(bad), /Not a credential id/);
  }
});

test("a file that is not a credential throws naming the path and never its contents", async () => {
  const store = await tempStore();
  await store.write("a_seed", credential); // creates the directory
  const secretish = "not json but contains SECRET-VALUE-42";
  await writeFile(join(store.dir, "a_broken.json"), secretish);
  await assert.rejects(store.read("a_broken"), (error: Error) => {
    assert.match(error.message, /not valid JSON/);
    assert.ok(error.message.includes(join(store.dir, "a_broken.json")));
    assert.ok(!error.message.includes("SECRET-VALUE-42"));
    return true;
  });
  await writeFile(join(store.dir, "a_partial.json"), JSON.stringify({ identity: "x@y", refreshToken: "TOKEN-LEAK" }));
  await assert.rejects(store.read("a_partial"), (error: Error) => {
    assert.match(error.message, /does not hold a credential/);
    assert.ok(!error.message.includes("TOKEN-LEAK"));
    return true;
  });
});

test("write refuses an incomplete credential", async () => {
  const store = await tempStore();
  await assert.rejects(store.write("a_bad", { ...credential, refreshToken: "" }), /incomplete credential/);
  assert.equal(await store.exists("a_bad"), false);
});
