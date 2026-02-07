import "server-only";
import { headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { buildApiUrl } from "./base-url";

export type ApiSessionUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type SessionPayloadUser = {
  id?: unknown;
  name?: unknown;
  email?: unknown;
};

type SessionPayload = {
  data?: {
    session?: {
      user?: SessionPayloadUser;
    };
    user?: SessionPayloadUser;
  };
  user?: SessionPayloadUser;
};

const LOGIN_PATH = "/auth/sign-in";

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseSessionUser(payload: SessionPayload) {
  const user =
    payload.data?.session?.user ?? payload.data?.user ?? payload.user ?? null;

  if (!user) {
    return null;
  }

  const id = toOptionalString(user.id);
  if (!id) {
    return null;
  }

  return {
    id,
    name: toOptionalString(user.name),
    email: toOptionalString(user.email),
  } satisfies ApiSessionUser;
}

async function resolveCookieHeader(cookieHeader?: string | null) {
  if (cookieHeader !== undefined) {
    return cookieHeader;
  }

  try {
    const requestHeaders = await nextHeaders();
    return requestHeaders.get("cookie");
  } catch {
    return null;
  }
}

export async function getApiSessionUser(options?: { cookieHeader?: string | null }) {
  const cookieHeader = await resolveCookieHeader(options?.cookieHeader);
  const requestHeaders = new Headers();

  if (cookieHeader) {
    requestHeaders.set("cookie", cookieHeader);
  }

  const response = await fetch(buildApiUrl("/api/auth/get-session"), {
    method: "GET",
    headers: requestHeaders,
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to resolve auth session via API (${response.status})`,
    );
  }

  const payload = (await response.json().catch(() => null)) as SessionPayload | null;
  if (!payload) {
    return null;
  }

  return parseSessionUser(payload);
}

export async function requireApiSessionUser(options?: {
  cookieHeader?: string | null;
}) {
  const user = await getApiSessionUser(options);
  if (!user) {
    redirect(LOGIN_PATH);
  }
  return user;
}
