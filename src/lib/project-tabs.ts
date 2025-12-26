export const projectTabs = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
  { key: "chat", label: "AI Chat" },
  { key: "artifacts", label: "Artifacts" },
] as const;

export type ProjectTabKey = (typeof projectTabs)[number]["key"];

export const defaultProjectTabKey: ProjectTabKey = "overview";

const tabKeySet = new Set<ProjectTabKey>(projectTabs.map((tab) => tab.key));

export function normalizeProjectTabKey(value?: string | null): ProjectTabKey | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return tabKeySet.has(normalized as ProjectTabKey)
    ? (normalized as ProjectTabKey)
    : null;
}

export function getProjectTabKeyFromPathname(pathname: string): ProjectTabKey | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects") {
    return null;
  }
  return normalizeProjectTabKey(parts[2]);
}

export function resolveProjectTabKey(tabParam?: string | null): ProjectTabKey {
  const normalized = normalizeProjectTabKey(tabParam);
  return normalized ?? defaultProjectTabKey;
}

export function buildProjectTabUrl(
  projectId: string,
  searchParams: { toString: () => string },
  tabKey: ProjectTabKey
): string {
  const nextParams = new URLSearchParams(searchParams.toString());
  if (tabKey !== "tasks") {
    nextParams.delete("tasksView");
  }
  const query = nextParams.toString();
  const basePath = `/projects/${projectId}/${tabKey}`;
  return query ? `${basePath}?${query}` : basePath;
}
