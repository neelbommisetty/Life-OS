import { describe, expect, test } from "bun:test";
import {
  buildProjectTabUrl,
  defaultProjectTabKey,
  getProjectTabKeyFromPathname,
  normalizeProjectTabKey,
  projectTabs,
  resolveProjectTabKey,
} from "@/lib/project-tabs";

describe("project tabs > normalizeProjectTabKey", () => {
  test("returns null for empty input", () => {
    expect(normalizeProjectTabKey("")).toBeNull();
    expect(normalizeProjectTabKey(null)).toBeNull();
  });

  test("normalizes valid keys", () => {
    expect(normalizeProjectTabKey("Tasks")).toBe("tasks");
    expect(normalizeProjectTabKey(" overview ")).toBe("overview");
  });

  test("rejects invalid keys", () => {
    expect(normalizeProjectTabKey("unknown")).toBeNull();
  });
});

describe("project tabs > resolveProjectTabKey", () => {
  test("defaults to overview when missing or invalid", () => {
    expect(resolveProjectTabKey("unknown")).toBe(defaultProjectTabKey);
    expect(resolveProjectTabKey(null)).toBe(defaultProjectTabKey);
  });
});

describe("project tabs > getProjectTabKeyFromPathname", () => {
  test("returns null for non-project paths", () => {
    expect(getProjectTabKeyFromPathname("/settings")).toBeNull();
  });

  test("extracts the tab segment", () => {
    expect(getProjectTabKeyFromPathname("/projects/123/tasks")).toBe("tasks");
    expect(getProjectTabKeyFromPathname("/projects/123/unknown")).toBeNull();
  });
});

describe("project tabs > buildProjectTabUrl", () => {
  test("sets the tab query param", () => {
    const searchParams = new URLSearchParams("foo=bar");
    const nextUrl = buildProjectTabUrl("123", searchParams, "tasks");
    expect(nextUrl).toBe("/projects/123/tasks?foo=bar");
  });

  test("drops unrelated query params on tab switch", () => {
    const searchParams = new URLSearchParams("tasksView=backlog&threadId=abc&foo=bar");
    const nextUrl = buildProjectTabUrl("123", searchParams, "overview");
    expect(nextUrl).toBe("/projects/123/overview?threadId=abc&foo=bar");
  });

  test("round-trips with resolveProjectTabKey", () => {
    const tabKey = projectTabs[2].key;
    const searchParams = new URLSearchParams("foo=bar");
    const url = buildProjectTabUrl("123", searchParams, tabKey);
    const pathname = new URL(url, "http://example.com").pathname;
    const parts = pathname.split("/");
    const resolved = resolveProjectTabKey(parts[3] ?? "");
    expect(resolved).toBe(tabKey);
  });
});
