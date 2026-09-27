import { createClient } from "@life-os/tools/client";
import type {
  Ctx,
  Receipt,
  Task,
  Project,
  Section,
  Label,
  Filter,
} from "../../../packages/tools/src/contract.ts";
import type { ProjectNode } from "../../../packages/tools/src/organize.ts";
export type { Task, Project, Section, Label, Filter };
export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const api = createClient({
  url: `${window.location.origin}/api`,
  token: "",
  timezone,
  timeoutMs: 35_000,
});
export const context = (
  version?: number,
  key: string = crypto.randomUUID(),
): Ctx => ({
  actor: "neel",
  key,
  ...(version ? { ifVersion: version } : {}),
});
export function recordOf<T>(receipt: Receipt<T>): T {
  if (!receipt.ok)
    throw new Error(
      receipt.outcome === "duplicate"
        ? "A similar task already exists. Check your list, or choose “Add as a separate task”."
        : receipt.issues.join(" · ") || "The change could not be saved.",
    );
  return receipt.record;
}
export function flatten(
  nodes: ProjectNode[],
): { project: Project; sections: Section[]; depth: number }[] {
  const walk = (
    items: ProjectNode[],
    depth: number,
  ): ReturnType<typeof flatten> =>
    items.flatMap((node) => [
      { project: node.project, sections: node.sections, depth },
      ...walk(node.children, depth + 1),
    ]);
  return walk(nodes, 0);
}
export async function loadWorkspace() {
  const [tasks, tree, labels, filters] = await Promise.all([
    api.task.list({ includeClosed: true, includeDeleted: true }),
    api.project.tree(),
    api.label.list(),
    api.filter.list(),
  ]);
  return { tasks, projects: flatten(tree), labels, filters };
}
