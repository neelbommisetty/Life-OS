import { describe, test, expect } from "bun:test";
import { formatRelativeTime } from "./utils";

describe("formatRelativeTime", () => {
  test("formats minutes, hours, and days with thresholds", () => {
    const now = new Date();

    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60 * 1000))).toBe(
      "5m",
    );
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 60 * 60 * 1000))).toBe(
      "3h",
    );
    expect(formatRelativeTime(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000))).toBe(
      "2d",
    );
  });

  test("formats older dates as month and day", () => {
    const oldDate = new Date("2020-01-15T12:00:00Z");
    expect(formatRelativeTime(oldDate)).toBe("Jan 15");
  });
});
