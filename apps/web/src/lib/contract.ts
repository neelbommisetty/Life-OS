import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/);
const date = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const text = z.string().min(1).max(8000);
const base = { id, version: z.number().int().positive(), sourceId: id };
const source = z.strictObject({
  id,
  label: text,
  checkedAt: timestamp,
  state: z.enum(["available", "partial", "unavailable"]),
  coverage: text,
});
const metric = z.strictObject({
  id,
  label: text,
  unit: z.string().min(1).max(24),
  style: z.enum(["bars", "points"]),
  precision: z.number().int().min(0).max(3),
});
const observation = z.strictObject({
  ...base,
  kind: z.literal("observation"),
  metricId: id,
  value: z.number().finite(),
  unit: z.string(),
  date,
});
const reflection = z.strictObject({
  ...base,
  kind: z.literal("reflection"),
  text,
  date,
  wording: z.enum(["direct", "summary"]),
});
const intention = z.strictObject({
  ...base,
  kind: z.literal("intention"),
  text,
  date,
});
const task = z.strictObject({
  ...base,
  kind: z.literal("task"),
  title: text,
  status: z.enum(["open", "completed", "cancelled"]),
  dueDate: date.nullable(),
  context: text,
});
const event = z.strictObject({
  ...base,
  kind: z.literal("event"),
  title: text,
  start: timestamp,
  end: timestamp,
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  location: text,
  status: z.enum(["accepted", "tentative", "needsAction", "cancelled"]),
});
export const recordSchema = z.discriminatedUnion("kind", [
  observation,
  reflection,
  intention,
  task,
  event,
]);
const block = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("metric"),
    metricId: id,
    from: date,
    through: date,
    note: text,
  }),
  z.strictObject({
    type: z.literal("timeline"),
    recordIds: z.array(id).min(1).max(8),
  }),
  z.strictObject({ type: z.literal("reflection"), recordId: id }),
]);
const focus = z.strictObject({
  id,
  label: text,
  title: text,
  directionId: id,
  basis: z.enum(["stated", "suggested"]),
  why: text,
  consideredAt: timestamp,
  reviewAfter: timestamp,
  assessment: text,
  assessmentDate: date,
  recognition: text,
  evidence: z
    .array(
      z.strictObject({ recordId: id, version: z.number().int().positive() }),
    )
    .min(1),
  blocks: z.array(block).min(1).max(8),
});

export const homeDataSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision: id,
    publishedAt: timestamp,
    area: z.strictObject({ id, label: text }),
    activeFocusId: id,
    sources: z.array(source).min(1).max(30),
    metrics: z.array(metric).max(30),
    records: z.array(recordSchema).max(3000),
    focuses: z.array(focus).min(1).max(12),
  })
  .superRefine((data, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const [name, items] of [
      ["sources", data.sources],
      ["metrics", data.metrics],
      ["records", data.records],
      ["focuses", data.focuses],
    ] as const) {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        issue(`Duplicate IDs in ${name}`);
    }
    const sources = new Set(data.sources.map((item) => item.id));
    const metrics = new Map(data.metrics.map((item) => [item.id, item]));
    const records = new Map(data.records.map((item) => [item.id, item]));
    if (!data.focuses.some((item) => item.id === data.activeFocusId))
      issue("Active focus does not exist");
    for (const record of data.records) {
      if (!sources.has(record.sourceId))
        issue(`Missing source for ${record.id}`);
      if (
        record.kind === "observation" &&
        metrics.get(record.metricId)?.unit !== record.unit
      )
        issue(`Missing metric or unit mismatch for ${record.id}`);
      if (
        record.kind === "event" &&
        Date.parse(record.end) <= Date.parse(record.start)
      )
        issue(`Event must end after it starts: ${record.id}`);
    }
    for (const focus of data.focuses) {
      if (records.get(focus.directionId)?.kind !== "intention")
        issue(`Missing intention for ${focus.id}`);
      if (Date.parse(focus.reviewAfter) <= Date.parse(focus.consideredAt))
        issue(`Focus review must follow consideration: ${focus.id}`);
      for (const ref of focus.evidence) {
        if (!records.has(ref.recordId))
          issue(`Missing evidence ${ref.recordId}`);
      }
      for (const block of focus.blocks) {
        if (block.type === "metric") {
          if (!metrics.has(block.metricId))
            issue(`Unknown metric ${block.metricId}`);
          if (block.from > block.through) issue("Metric range is reversed");
        }
        if (
          block.type === "reflection" &&
          records.get(block.recordId)?.kind !== "reflection"
        )
          issue(`Missing reflection ${block.recordId}`);
        if (block.type === "timeline") {
          for (const ref of block.recordIds)
            if (records.get(ref)?.kind !== "reflection")
              issue(`Missing timeline reflection ${ref}`);
        }
      }
    }
  });

export type HomeData = z.infer<typeof homeDataSchema>;
export type EvidenceRecord = HomeData["records"][number];
export type Observation = Extract<EvidenceRecord, { kind: "observation" }>;
export type Focus = HomeData["focuses"][number];
export type Block = Focus["blocks"][number];
export type Metric = HomeData["metrics"][number];
