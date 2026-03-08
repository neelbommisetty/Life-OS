type ProjectCardFields = {
  description: string | null;
  aiInstructions: string | null;
};

export function getProjectCardLabels(project: ProjectCardFields) {
  return {
    brief: project.description?.trim() ? "Brief added" : "Brief pending",
    instructions: project.aiInstructions?.trim()
      ? "Instructions added"
      : "Instructions pending",
  };
}
