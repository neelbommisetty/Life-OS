// Manually run smoke test against the real Google adapter: creates a
// throwaway event on a real, connected calendar, lists it back, reschedules
// it, then deletes it, printing each receipt. Not part of `bun run test` (or
// `node --test`) — it touches the network and a real calendar, so it never
// runs unattended and never runs against FakeAdapter.
//
// Usage (from packages/tools):
//   node scripts/google-smoke.ts <account ref> <calendar name>
//
// <account ref> is an account id (a_...), the identity email, or the label,
// as already connected with `life account add google`. <calendar name> is a
// calendar on that account, matched the way the CLI matches --calendar.
// Refuses to run without both arguments so it can never fire by accident.

import { createClient } from "../src/api/client.ts";
import { clientConfig } from "../src/api/config.ts";

const [accountRef, calendarName] = process.argv.slice(2);

if (!accountRef || !calendarName) {
  console.error("usage: node scripts/google-smoke.ts <account ref> <calendar name>");
  console.error("refusing to run without an explicit account and calendar: this creates and deletes a real event.");
  process.exit(64);
}

const ctx = { actor: "codex", reason: "google-smoke: manual adapter check" };

async function main(): Promise<void> {
  const tools = createClient(await clientConfig(process.env));
  try {
    const account = await tools.account.get(accountRef);
    if (!account) throw new Error(`no connected account "${accountRef}"; run \`life account list\` first`);

    const calendar = await tools.calendar.get(`${account.identity}/${calendarName}`);
    if (!calendar) throw new Error(`no calendar "${calendarName}" on account "${accountRef}"; run \`life calendar list\` first`);

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const addReceipt = await tools.event.add(
      { title: "life-os google-smoke (safe to delete)", calendar: calendar.id, start: { at: start.toISOString(), timezone: null }, duration: 15 },
      ctx,
    );
    console.log("add:", JSON.stringify(addReceipt, null, 2));
    const id = addReceipt.id;
    if (addReceipt.outcome === "rejected" || !id) throw new Error("add was rejected; nothing left to clean up");

    const listed = await tools.event.list({ from: start.toISOString(), to: new Date(start.getTime() + 60 * 60 * 1000).toISOString(), calendars: [calendar.id] });
    console.log("list:", JSON.stringify(listed, null, 2));

    const newStart = new Date(start.getTime() + 60 * 60 * 1000);
    const rescheduleReceipt = await tools.event.reschedule(id, { start: { at: newStart.toISOString(), timezone: null } }, ctx);
    console.log("reschedule:", JSON.stringify(rescheduleReceipt, null, 2));

    const deleteReceipt = await tools.event.delete(id, ctx);
    console.log("delete:", JSON.stringify(deleteReceipt, null, 2));
  } finally {
    await tools.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
