import "server-only";
import { buildApiUrl } from "./base-url";
import { getApiBearerToken } from "./auth-token";

type ApiErrorPayload = {
  message?: string;
  error?: string;
};

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
  const token = await getApiBearerToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);

  return fetch(buildApiUrl(path), {
    ...init,
    headers,
    cache: init.cache ?? "no-store",
  });
}

export async function apiFetchJson<T>(path: string, init: RequestInit = {}) {
  const response = await apiFetch(path, init);

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return (await response.json()) as T;
}
