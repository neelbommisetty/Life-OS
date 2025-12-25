export const SYSTEM_CONTEXT_ARTIFACT_TITLE = "System context";

export function isSystemContextTitle(title?: string | null): boolean {
  if (!title) return false;
  return title.trim().toLowerCase() === SYSTEM_CONTEXT_ARTIFACT_TITLE.toLowerCase();
}

export function isSystemContextArtifact(artifact?: { title?: string | null } | null): boolean {
  if (!artifact) return false;
  return isSystemContextTitle(artifact.title);
}
