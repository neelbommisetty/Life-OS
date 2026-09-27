import { test } from "node:test";
import assert from "node:assert/strict";
import { testEnvironment } from "../tests/environment.ts";
import { createBridge } from "./bridge.ts";
import { ProviderUnavailable } from "../../../packages/tools/src/calendar/adapter.ts";

test("calendar bridge lifecycle uses real HTTP, recurrence scopes, version checks and fake provider readback", async () => {
  const env = await testEnvironment();
  const origin = "http://127.0.0.1:4320";
  const bridge = createBridge({ ...env, origins: [origin] });
  const ctx = () => ({ actor: "neel", key: crypto.randomUUID() });
  async function call(op: string, args: unknown[] = []) {
    const response = await bridge.request(`${origin}/api/v1/${op}`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:4320",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ args, timezone: "America/Los_Angeles" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  }
  try {
    const cal = await env.seedCalendar();
    assert.equal((await call("account.list")).length, 1);
    assert.equal(
      (await call("calendar.list", [{ includeHidden: true }]))[0].id,
      cal.id,
    );
    const input = {
      title: "Weekend",
      calendar: cal.id,
      start: { date: "2026-09-25" },
      end: { date: "2026-09-27" },
    };
    const key = ctx();
    const added = await call("event.add", [input, key]);
    assert.equal(added.ok, true);
    assert.equal((await call("event.add", [input, key])).id, added.id);
    let week = await call("views.week", [{ from: "2026-09-25", days: 3 }]);
    assert.equal(week.days[0].allDay.length, 1);
    assert.equal(week.days[1].allDay.length, 1);
    assert.equal(week.days[2].allDay.length, 0);
    const ref = week.days[0].allDay[0].occurrence.occurrenceId;
    const current = await call("event.get", [ref]);
    const update = await call("event.update", [
      ref,
      { title: "Long weekend" },
      { ...ctx(), ifVersion: current.version },
    ]);
    assert.equal(update.ok, true);
    assert.equal(
      (
        await call("event.update", [
          ref,
          { title: "Stale" },
          { ...ctx(), ifVersion: current.version },
        ])
      ).ok,
      false,
    );
    const milliseconds = await call("event.add", [
      {
        title: "Milliseconds",
        calendar: cal.id,
        start: {
          at: "2026-09-25T18:00:00.000Z",
          timezone: "America/Los_Angeles",
        },
        duration: 60,
      },
      ctx(),
    ]);
    const withMilliseconds = await call("views.week", [
      { from: "2026-09-25", days: 1 },
    ]);
    const millisecondsRef = withMilliseconds.days[0].timed.find(
      (entry: any) => entry.occurrence.id === milliseconds.id,
    ).occurrence.occurrenceId;
    assert.ok(await call("event.get", [millisecondsRef]));
    assert.equal(
      (
        await call("event.update", [
          millisecondsRef,
          { notes: "Can reopen" },
          { ...ctx(), ifVersion: milliseconds.version },
        ])
      ).ok,
      true,
    );
    const series = await call("event.add", [
      {
        title: "Focus",
        calendar: cal.id,
        start: { at: "2026-09-25T16:00:00Z", timezone: "America/Los_Angeles" },
        duration: 60,
        repeat: "FREQ=DAILY;COUNT=3",
      },
      ctx(),
    ]);
    assert.equal(series.ok, true);
    week = await call("views.week", [{ from: "2026-09-25", days: 3 }]);
    const second = week.days[1].timed[0].occurrence;
    const missingScope = await call("event.update", [
      second.occurrenceId,
      { title: "One focus session" },
      ctx(),
    ]);
    assert.equal(missingScope.needs.field, "scope");
    const scoped = await call("event.update", [
      second.occurrenceId,
      { title: "One focus session" },
      { ...ctx(), ifVersion: second.version },
      { scope: "this" },
    ]);
    assert.equal(scoped.ok, true);
    week = await call("views.week", [{ from: "2026-09-25", days: 3 }]);
    assert.equal(week.days[0].timed[0].occurrence.title, "Focus");
    const exception = week.days[1].timed[0].occurrence;
    assert.equal(exception.title, "One focus session");
    const exceptionRef = `${exception.id}@${exception.originalStart.at}`;
    assert.equal(
      (
        await call("event.update", [
          exceptionRef,
          { notes: "Exception follow-up" },
          { ...ctx(), ifVersion: exception.version },
          { scope: "this" },
        ])
      ).ok,
      true,
    );
    assert.equal(
      (
        await call("event.delete", [
          ref,
          { ...ctx(), ifVersion: update.version },
        ])
      ).ok,
      true,
    );
    assert.ok((await call("event.get", [added.id])).deletedAt);
    assert.ok(
      ["synced", "unchanged"].includes(
        (await call("calendar.sync", [cal.id])).calendars[0].outcome,
      ),
    );
    const readOnly = await env.seedCalendar([], {
      id: "read-only",
      writable: false,
      primary: false,
    });
    assert.equal(
      (await call("event.add", [{ ...input, calendar: readOnly.id }, ctx()]))
        .ok,
      false,
    );
  } finally {
    await env.close();
  }
});

test("calendar invitations and failed refreshes keep provider receipts and stale evidence", async () => {
  const env = await testEnvironment();
  try {
    const cal = await env.seedCalendar([
      {
        id: "inv",
        title: "Invitation",
        start: { date: "2026-09-25" },
        end: { date: "2026-09-26" },
        attendees: [
          {
            email: "demo@example.com",
            name: null,
            response: "needsAction",
            self: true,
            optional: false,
          },
        ],
        myResponse: "needsAction",
      },
    ]);
    const week = await env.client.views.week({ from: "2026-09-25", days: 1 });
    const entry = week.days[0].allDay[0];
    assert.equal(entry.kind, "event");
    if (entry.kind !== "event") throw new Error("Expected event");
    const receipt = await env.client.event.respond(
      entry.occurrence.occurrenceId,
      "accepted",
      {
        actor: "neel",
        key: crypto.randomUUID(),
        ifVersion: entry.occurrence.version,
      },
    );
    assert.equal(receipt.ok, true);
    if (receipt.ok) assert.equal(receipt.record.myResponse, "accepted");
    const syncPage = env.fake.syncPage.bind(env.fake);
    env.fake.syncPage = async () => {
      throw new ProviderUnavailable("Fixture is offline");
    };
    const failed = await env.client.calendar.sync(cal.id);
    assert.equal(failed.calendars[0].outcome, "failed");
    env.fake.syncPage = syncPage;
    const stale = await env.client.views.week({
      from: "2026-09-25",
      days: 1,
      fresh: false,
    });
    assert.equal(stale.days[0].allDay.length, 1);
    assert.match(stale.freshness[0].error!, /offline/);
  } finally {
    await env.close();
  }
});
