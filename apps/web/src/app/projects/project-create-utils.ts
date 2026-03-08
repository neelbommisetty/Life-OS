import type { CreateProjectInput } from "@/lib/projects";

export function buildCreateProjectPayload(
  formData: CreateProjectInput,
): CreateProjectInput | null {
  const name = formData.name.trim();

  if (!name) {
    return null;
  }

  return {
    name,
    description: formData.description?.trim() ?? "",
    aiInstructions: formData.aiInstructions?.trim() ?? "",
  };
}

export function getProjectDetailHref(projectId: string): string {
  return `/projects/${projectId}`;
}

export function getProjectCreateHref(): string {
  return "/projects/new";
}
