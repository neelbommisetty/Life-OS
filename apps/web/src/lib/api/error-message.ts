type ApiErrorPayload = {
  message?: string;
  error?: string;
};

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return toNonEmptyString(error.message) ?? fallbackMessage;
  }

  return toNonEmptyString(error) ?? fallbackMessage;
}

export async function readApiErrorMessageFromResponse(
  response: Response,
  fallbackMessage: string,
) {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;
  const payloadMessage =
    toNonEmptyString(payload?.message) ?? toNonEmptyString(payload?.error);

  if (payloadMessage) {
    return payloadMessage;
  }

  if (response.status === 401) {
    return "Unauthorized: Please sign in to continue";
  }

  return fallbackMessage;
}
