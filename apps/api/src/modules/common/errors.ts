import { ZodError } from "zod";

const NOT_FOUND_MESSAGES = new Set([
  "Project not found",
  "Note not found",
  "Task not found",
  "Thread not found",
  "Message not found",
  "Inbox item not found",
  "Inbox proposal output not found",
]);

const BAD_REQUEST_MESSAGES = new Set([
  "Only assistant messages can be saved as notes",
  "Selected model is not available",
  "Can only regenerate assistant messages",
  "Can only regenerate the latest assistant message",
  "Archived inbox items cannot be processed",
  "Only pending outputs can be approved",
  "Only pending outputs can be declined",
  "Only failed outputs can be retried",
  "Only failed outputs can be skipped",
  "Only processing inbox items can be recovered",
  "Inbox item is not eligible for recovery yet",
]);

export class ApiError extends Error {
  readonly status: 400 | 401 | 404 | 500 | 503;
  readonly code: string;

  constructor(
    status: 400 | 401 | 404 | 500 | 503,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function unauthorizedError(
  message = "Unauthorized: Please sign in to continue",
) {
  return new ApiError(401, "unauthorized", message);
}

export function badRequestError(message: string) {
  return new ApiError(400, "invalid_request", message);
}

export function notFoundError(message: string) {
  return new ApiError(404, "not_found", message);
}

export function serviceUnavailableError(message: string) {
  return new ApiError(503, "service_unavailable", message);
}

function toServiceUnavailableMessage(message: string): string | null {
  if (/api key is not configured/i.test(message)) {
    return "AI provider credentials are not configured on the server";
  }

  if (/environment variable is not set/i.test(message)) {
    return message;
  }

  if (
    /no service route registered for/i.test(message) ||
    /has not been registered\./i.test(message)
  ) {
    return "AI services are not initialized on the server";
  }

  return null;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join("; ");
    return badRequestError(message || "Invalid request");
  }

  if (error instanceof Error) {
    if (error.message === "Unauthorized") {
      return unauthorizedError("Unauthorized");
    }

    const unavailableMessage = toServiceUnavailableMessage(error.message);
    if (unavailableMessage) {
      return serviceUnavailableError(unavailableMessage);
    }

    if (NOT_FOUND_MESSAGES.has(error.message)) {
      return notFoundError(error.message);
    }

    if (BAD_REQUEST_MESSAGES.has(error.message)) {
      return badRequestError(error.message);
    }

    return new ApiError(500, "internal_error", error.message);
  }

  return new ApiError(500, "internal_error", "An unexpected error occurred");
}

export function toErrorBody(error: ApiError) {
  return {
    error: error.code,
    message: error.message,
  };
}
