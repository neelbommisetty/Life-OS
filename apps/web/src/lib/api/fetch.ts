import "server-only";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { buildApiUrl } from "./base-url";

type ApiErrorPayload = {
  message?: string;
  error?: string;
};

const LOGIN_PATH = "/auth/sign-in";

async function readApiErrorMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | ApiErrorPayload
    | null;

  if (payload?.message) {
    return payload.message;
  }

  if (response.status === 401) {
    return "Unauthorized: Please sign in to continue";
  }

  return `API request failed with status ${response.status}`;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (!headers.has("cookie")) {
    try {
      const requestHeaders = await nextHeaders();
      const cookieHeader = requestHeaders.get("cookie");
      if (cookieHeader) {
        headers.set("cookie", cookieHeader);
      }
    } catch {
      // If headers() is unavailable in this execution context, continue without cookies.
    }
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });

  if (response.status === 401) {
    redirect(LOGIN_PATH);
  }

  return response;
}

export async function apiFetchJson<T>(path: string, init: RequestInit = {}) {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return (await response.json()) as T;
}
