import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeDataSchema, type HomeData } from "./contract";
import {
  focusFreshness,
  observationsFor,
  operationalRecords,
} from "./selectors";
import { readDataFile } from "./data-file";

const fixture = JSON.parse(
  await readFile(
    new URL("../../data/health.example.json", import.meta.url),
    "utf8",
  ),
);
const fresh = (): HomeData => structuredClone(fixture);
const now = "2026-09-06T12:00:00Z";

test("rejects broken references, duplicate records, mismatched units and invalid events", () => {
  for (const mutate of [
    (data: HomeData) => {
      data.activeFocusId = "absent";
    },
    (data: HomeData) => {
      data.records.push(data.records[0]);
    },
    (data: HomeData) => {
      data.records[0].sourceId = "absent";
    },
    (data: HomeData) => {
      const r = data.records.find((r) => r.kind === "observation")!;
      r.unit = "lb";
    },
    (data: HomeData) => {
      const r = data.records.find((r) => r.kind === "event")!;
      r.end = r.start;
    },
    (data: HomeData) => {
      data.focuses[0].directionId = "note";
    },
  ]) {
    const data = fresh();
    mutate(data);
    assert.equal(homeDataSchema.safeParse(data).success, false);
  }
  assert.equal(homeDataSchema.safeParse(fresh()).success, true);
});

test("correction changes evidence freshness until the focus acknowledges the new version", () => {
  const data = fresh();
  const focus = data.focuses[0];
  assert.equal(focusFreshness(data, focus, now).evidenceChanged, false);
  data.records.find((r) => r.id === "note")!.version++;
  assert.equal(homeDataSchema.safeParse(data).success, true);
  assert.equal(focusFreshness(data, focus, now).evidenceChanged, true);
  focus.evidence.find((r) => r.recordId === "note")!.version++;
  assert.equal(focusFreshness(data, focus, now).evidenceChanged, false);
  assert.equal(
    focusFreshness(data, focus, "2100-01-01T00:00:00Z").reviewDue,
    true,
  );
});

test("focus changes leave commitments intact; status and event time control the plan", () => {
  const data = fresh();
  const before = operationalRecords(data, now);
  data.activeFocusId = "rest";
  assert.deepEqual(operationalRecords(data, now), before);
  data.records.find((r) => r.kind === "task")!.status = "completed";
  assert.equal(operationalRecords(data, now).tasks.length, 0);
  const event = data.records.find((r) => r.kind === "event")!;
  event.status = "cancelled";
  assert.equal(operationalRecords(data, now).events.length, 0);
  event.status = "accepted";
  assert.equal(
    operationalRecords(data, "2100-01-01T00:00:00Z").events.length,
    0,
  );
});

test("missing readings stay absent and a real zero remains a measurement", () => {
  const data = fresh();
  const block = data.focuses[0].blocks[0];
  assert.equal(block.type, "metric");
  if (block.type !== "metric") return;
  data.records.find((r) => r.kind === "observation")!.value = 0;
  assert.deepEqual(
    observationsFor(data, block).map((r) => r.value),
    [0],
  );
  assert.deepEqual(observationsFor(data, { ...block, from: "2026-09-05" }), []);
});

test("file reads distinguish missing, malformed and corrected content without a code change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "life-os-data-"));
  const path = join(dir, "health.json");
  try {
    assert.deepEqual(await readDataFile(path), {
      ok: false,
      reason: "missing",
      issues: [],
    });
    await writeFile(path, "{");
    const invalid = await readDataFile(path);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, "invalid");
    const data = fresh();
    await writeFile(path, JSON.stringify(data));
    const before = await readDataFile(path);
    const reading = data.records.find((r) => r.kind === "observation")!;
    reading.value = 27;
    reading.version++;
    await writeFile(path, JSON.stringify(data));
    const after = await readDataFile(path);
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.digest, after.digest);
    assert.equal(
      after.data.records.find((r) => r.kind === "observation")!.value,
      27,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
