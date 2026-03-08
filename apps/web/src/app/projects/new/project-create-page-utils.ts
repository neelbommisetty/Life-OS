export function getProjectCreateFeedback(
  isCreating: boolean,
  errorMessage: string | null,
) {
  if (errorMessage) {
    return {
      tone: "error" as const,
      message: errorMessage,
    };
  }

  if (isCreating) {
    return {
      tone: "pending" as const,
      message: "Creating project...",
    };
  }

  return {
    tone: "idle" as const,
    message: "Project opens right after creation.",
  };
}
