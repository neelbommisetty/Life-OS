import type { Project } from "@life-os/db";
import type { UpdateProjectInput } from "@/lib/projects";

export type ProjectEditFormData = Omit<UpdateProjectInput, "id">;

export function getProjectEditFormData(
  project: Pick<Project, "name" | "description" | "aiInstructions">,
): ProjectEditFormData {
  return {
    name: project.name,
    description: project.description ?? "",
    aiInstructions: project.aiInstructions ?? "",
  };
}

export function buildProjectUpdatePayload(
  formData: ProjectEditFormData,
): ProjectEditFormData | null {
  const name = formData.name?.trim();

  if (!name) {
    return null;
  }

  return {
    name,
    description: formData.description?.trim() ?? "",
    aiInstructions: formData.aiInstructions?.trim() ?? "",
  };
}
