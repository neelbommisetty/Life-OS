import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { homeDataSchema, type HomeData } from "./contract";

export type LoadResult =
  | { ok: true; data: HomeData; digest: string }
  | {
      ok: false;
      reason: "missing" | "invalid" | "unavailable";
      issues: string[];
    };

export function dataFilePath() {
  return (
    process.env.LIFE_OS_DATA_FILE ||
    resolve(process.cwd(), "../../.local/health.json")
  );
}

export async function readDataFile(path = dataFilePath()): Promise<LoadResult> {
  try {
    if ((await stat(path)).size > 2_000_000)
      return {
        ok: false,
        reason: "invalid",
        issues: ["Data file exceeds the 2 MB limit."],
      };
    const raw = await readFile(path, "utf8");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        reason: "invalid",
        issues: ["Data is not valid JSON."],
      };
    }
    const result = homeDataSchema.safeParse(value);
    if (!result.success)
      return {
        ok: false,
        reason: "invalid",
        issues: result.error.issues
          .slice(0, 8)
          .map(
            (issue) =>
              `${issue.path.join(".") || "document"}: ${issue.message}`,
          ),
      };
    return {
      ok: true,
      data: result.data,
      digest: createHash("sha256").update(raw).digest("hex"),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "missing"
          : "unavailable",
      issues: [],
    };
  }
}
