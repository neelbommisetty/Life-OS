import type { Context } from "hono";
import { badRequestError, toApiError, toErrorBody } from "./errors.js";

export async function readJsonBody(c: Context) {
  try {
    return await c.req.json();
  } catch {
    throw badRequestError("Request body must be valid JSON");
  }
}

export async function readJsonRequest(request: Request) {
  try {
    return await request.json();
  } catch {
    throw badRequestError("Request body must be valid JSON");
  }
}

export function parseBooleanQuery(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw badRequestError("Boolean query parameters must be true or false");
}

export function parseNumberQuery(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw badRequestError("Numeric query parameter is invalid");
  }

  return parsed;
}

export function handleRouteError(c: Context, error: unknown) {
  const apiError = toApiError(error);
  return c.json(toErrorBody(apiError), apiError.status);
}
