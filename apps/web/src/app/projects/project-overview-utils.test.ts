import { describe, expect, test } from "bun:test";
import { brand } from "@/lib/brand";
import { getProjectOverviewStats } from "./project-overview-utils";

describe("getProjectOverviewStats", () => {
  test("summarizes assistant, open task, and note counts for the overview", () => {
    expect(
      getProjectOverviewStats({
        chatThreads: [{ id: "thread-1" }, { id: "thread-2" }] as never,
        tasks: [
          { id: "task-1", status: "TODO" },
          { id: "task-2", status: "DONE" },
        ] as never,
        notes: [{ id: "note-1" }] as never,
      }),
    ).toEqual([
      {
        label: brand.terms.assistant,
        value: 2,
        detail: "2 conversations in this project",
      },
      {
        label: "Open tasks",
        value: 1,
        detail: "1 task still in progress",
      },
      {
        label: brand.terms.library,
        value: 1,
        detail: "1 note saved in this project",
      },
    ]);
  });
});
