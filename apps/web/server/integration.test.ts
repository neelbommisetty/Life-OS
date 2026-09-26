import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "./bridge.ts";
import { testEnvironment } from "../tests/environment.ts";

test("website → bridge → real HTTP API → disposable database: complete task lifecycle and organization", async () => {
  const env = await testEnvironment();
  const origin = "http://127.0.0.1:4320";
  const bridge = createBridge({ ...env, origins: [origin] });
  const ctx = () => ({ actor: "neel", key: crypto.randomUUID() });
  async function call(op: string, args: unknown[] = []) {
    const result = await bridge.request(`${origin}/api/v1/${op}`, {
      method: "POST",
      headers: {
        origin,
        host: "127.0.0.1:4320",
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ args, timezone: "America/Los_Angeles" }),
    });
    assert.equal(result.status, 200);
    const body = (await result.json()) as any;
    assert.equal(body.ok, true);
    return body.result;
  }
  try {
    const project = await call("project.add", [
      { name: "Web flow", color: "#456d59" },
      ctx(),
    ]);
    assert.equal(project.ok, true);
    const section = await call("section.add", [
      { project: project.id, name: "Next" },
      ctx(),
    ]);
    const create = ctx();
    const added = await call("task.add", [
      {
        title: "Review the design",
        status: "accepted",
        due: { date: "2026-09-25" },
        labels: ["focus"],
        priority: 1,
      },
      create,
    ]);
    assert.equal(added.ok, true);
    assert.equal(
      (
        await call("task.add", [
          {
            title: "Review the design",
            status: "accepted",
            due: { date: "2026-09-25" },
            labels: ["focus"],
            priority: 1,
          },
          create,
        ])
      ).id,
      added.id,
    );
    assert.equal(
      (await call("task.add", [{ title: "Review the design" }, ctx()])).outcome,
      "duplicate",
    );
    const edited = await call("task.update", [
      added.id,
      { notes: "Check mobile layout" },
      { ...ctx(), ifVersion: added.version },
    ]);
    assert.equal(edited.ok, true);
    assert.equal(
      (
        await call("task.update", [
          added.id,
          { title: "Stale update" },
          { ...ctx(), ifVersion: added.version },
        ])
      ).ok,
      false,
    );
    const moved = await call("task.move", [
      added.id,
      { project: project.id, section: section.id },
      { ...ctx(), ifVersion: edited.version },
    ]);
    assert.equal(moved.record.sectionId, section.id);
    assert.equal(
      (await call("task.note", [added.id, "Ready to test", ctx()])).ok,
      true,
    );
    assert.equal((await call("views.search", ["mobile"])).length, 1);
    assert.equal((await call("views.label", ["focus"])).length, 1);
    const filter = await call("filter.add", [
      { name: "High priority", query: "p1 & status:accepted" },
      ctx(),
    ]);
    assert.equal(filter.ok, true);
    assert.equal((await call("filter.run", [filter.id])).length, 1);
    const child = await call("task.add", [
      {
        title: "Check a small screen",
        parent: added.id,
        project: project.id,
        section: section.id,
      },
      ctx(),
    ]);
    assert.equal(child.ok, true);
    const needs = await call("task.complete", [added.id, ctx()]);
    assert.equal(needs.ok, false);
    assert.equal(needs.needs.field, "subtasks");
    const complete = await call("task.complete", [
      added.id,
      ctx(),
      { subtasks: "complete" },
    ]);
    assert.equal(complete.record.status, "done");
    assert.equal((await call("task.get", [child.id])).status, "done");
    const reopened = await call("task.uncomplete", [added.id, ctx()]);
    assert.equal(reopened.record.status, "accepted");
    const deleted = await call("task.delete", [
      added.id,
      ctx(),
      { subtasks: "delete" },
    ]);
    assert.ok(deleted.record.deletedAt);
    assert.equal(
      (await call("task.restore", [added.id, ctx()])).record.deletedAt,
      null,
    );
    const repeating = await call("task.add", [
      {
        title: "Daily review",
        due: { date: "2026-09-25" },
        repeat: "FREQ=DAILY",
      },
      ctx(),
    ]);
    const occurrence = await call("task.complete", [repeating.id, ctx()]);
    assert.equal(occurrence.record.status, "accepted");
    assert.equal(occurrence.record.due.date, "2026-09-26");
    assert.equal(
      (await call("project.tree")).some(
        (p: any) => p.project.id === project.id,
      ),
      true,
    );
  } finally {
    await env.close();
  }
});
