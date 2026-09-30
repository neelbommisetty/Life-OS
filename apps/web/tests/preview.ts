// Browser verification against disposable data. Stop this process to drop it all.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testEnvironment } from "./environment.ts";
import type { Receipt } from "../../../packages/tools/src/contract.ts";
import { localDate, addDays } from "../src/model.ts";
const env = await testEnvironment();
const take = <T>(r: Receipt<T>): T => {
  if (!r.ok) throw new Error(r.issues.join("; "));
  return r.record;
};
const ctx = () => ({ actor: "neel", key: crypto.randomUUID() });
const today = localDate();
const work = take(
  await env.client.project.add(
    { name: "Website refresh", color: "#6d82aa" },
    ctx(),
  ),
);
const personal = take(
  await env.client.project.add({ name: "Personal", color: "#4c7664" }, ctx()),
);
const learning = take(
  await env.client.project.add({ name: "Learning", color: "#c49350" }, ctx()),
);
const section = take(
  await env.client.section.add(
    { project: work.id, name: "In progress" },
    ctx(),
  ),
);
for (const input of [
  {
    title: "Review the homepage direction",
    duration: 45,
    notes: "A final look at the layout, type, and little details.",
    project: work.id,
    section: section.id,
    due: { date: today },
    priority: 1,
    labels: ["focus"],
  },
  {
    title: "Make time for a walk",
    project: personal.id,
    due: { date: today },
    priority: 4,
    repeat: "FREQ=DAILY",
  },
  {
    title: "Read a chapter of the new book",
    project: learning.id,
    due: { date: today },
    priority: 3,
    labels: ["reading"],
  },
  {
    title: "Send feedback on the first draft",
    project: work.id,
    due: { date: addDays(today, -1) },
    priority: 2,
  },
  {
    title: "Plan something good for the weekend",
    project: personal.id,
    due: { date: today },
    priority: 4,
  },
  {
    title: "Explore a new idea",
    project: learning.id,
    due: { date: addDays(today, 1) },
    priority: 4,
  },
  { title: "A thought for later", priority: 4 },
])
  take(await env.client.task.add({ ...input, status: "accepted" }, ctx()));
const demoZone = "America/Los_Angeles";
const { DateTime } = await import("luxon");
const at = (day: string, time: string) => ({
  at: DateTime.fromISO(`${day}T${time}`, { zone: demoZone }).toUTC().toISO()!,
  timezone: demoZone,
});
await env.seedCalendar([
  {
    id: "daily-focus",
    title: "A little room to focus",
    start: at(today, "09:00"),
    end: at(today, "10:30"),
    repeat: { rrule: "FREQ=DAILY;COUNT=12", exdates: [] },
    location: "At home",
    notes: "Synthetic calendar fixture.",
  },
  {
    id: "lunch",
    title: "Lunch with Alex",
    start: at(today, "12:00"),
    end: at(today, "13:00"),
    location: "The corner café",
  },
  {
    id: "overlap",
    title: "Catch up with the team",
    start: at(today, "09:45"),
    end: at(today, "10:15"),
  },
  {
    id: "weekend",
    title: "A weekend away",
    start: { date: addDays(today, 1) },
    end: { date: addDays(today, 3) },
  },
  {
    id: "invitation",
    title: "Design conversation",
    start: at(today, "15:00"),
    end: at(today, "16:00"),
    organizer: { email: "alex@example.com", name: "Alex", self: false },
    attendees: [
      {
        email: "demo@example.com",
        name: "Demo",
        response: "needsAction",
        self: true,
        optional: false,
      },
    ],
    myResponse: "needsAction",
    conferencing: { kind: "Meet", url: "https://meet.google.com/example" },
  },
]);
await env.seedCalendar(
  [
    {
      id: "reading",
      title: "Quiet reading hour",
      start: at(addDays(today, 2), "16:00"),
      end: at(addDays(today, 2), "17:00"),
      busy: false,
    },
  ],
  { id: "shared", name: "Family", primary: false, color: "#ae8244" },
);
await env.seedCalendar(
  [
    {
      id: "holiday",
      title: "Community day",
      start: { date: addDays(today, 3) },
      end: { date: addDays(today, 4) },
    },
  ],
  {
    id: "holidays",
    name: "Holidays",
    primary: false,
    writable: false,
    color: "#8b79a8",
  },
);
const web = spawn(process.execPath, ["server/index.ts", "--production"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    LIFE_API_URL: env.url,
    LIFE_API_TOKEN: env.token,
    LIFE_WEB_PORT: "4321",
  },
  stdio: "inherit",
});
let closed = false;
async function close() {
  if (closed) return;
  closed = true;
  web.kill("SIGTERM");
  await env.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
web.on("exit", close);
console.log(
  "Disposable browser verification ready on http://127.0.0.1:4321/todo",
);
