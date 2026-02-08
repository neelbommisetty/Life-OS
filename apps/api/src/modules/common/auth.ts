import {
  createRemoteJWKSet,
  customFetch,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { ApiError, unauthorizedError } from "./errors.js";

const AUTH_SESSION_TIMEOUT_MS = 8_000;
const requestUserIdCache = new WeakMap<Request, Promise<string>>();
const jwksByBaseUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const SESSION_HEADER_DENYLIST = [
  "host",
  "content-length",
  "content-type",
  "transfer-encoding",
  "connection",
  "expect",
] as const;

function getAuthBaseUrlFromEnv() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ApiError(
      500,
      "auth_configuration_error",
      "NEON_AUTH_BASE_URL is required to resolve auth sessions",
    );
  }
  return baseUrl;
}

function getJwtIssuerFromEnv() {
  const issuer = process.env.NEON_AUTH_JWT_ISSUER?.trim();
  return issuer ? issuer : undefined;
}

function getJwtAudienceFromEnv() {
  const audience = process.env.NEON_AUTH_JWT_AUDIENCE?.trim();
  if (!audience) {
    return undefined;
  }

  const values = audience
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length <= 1) {
    return values[0];
  }

  return values;
}

function buildSessionUrl(baseUrl: string) {
  return `${baseUrl}/get-session`;
}

function buildJwksUrl(baseUrl: string) {
  return `${baseUrl}/jwt`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isSelfAuthProxyBaseUrl(requestUrl: string, baseUrl: string) {
  try {
    const request = new URL(requestUrl);
    const authBase = new URL(baseUrl);
    if (request.origin !== authBase.origin) {
      return false;
    }

    const normalizedPath = authBase.pathname.replace(/\/+$/, "");
    return (
      normalizedPath === "/api/auth" || normalizedPath.startsWith("/api/auth/")
    );
  } catch {
    return false;
  }
}

function isProxyAuthPath(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    return (
      normalizedPath === "/api/auth" || normalizedPath.startsWith("/api/auth/")
    );
  } catch {
    return false;
  }
}

function buildSessionHeaders(request: Request) {
  const headers = new Headers(request.headers);
  for (const name of SESSION_HEADER_DENYLIST) {
    headers.delete(name);
  }
  return headers;
}

function parseBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorizedError("Invalid authorization header");
  }

  const token = match[1]?.trim();
  if (!token) {
    throw unauthorizedError("Invalid authorization header");
  }

  return token;
}

function resolveUserIdFromJwtPayload(
  payload: JWTPayload & {
    user_id?: unknown;
    userId?: unknown;
    uid?: unknown;
    user?: { id?: unknown };
  },
) {
  const candidates = [
    payload.sub,
    payload.user_id,
    payload.userId,
    payload.uid,
    payload.user?.id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

function getCachedJwks(baseUrl: string, fetchFn: typeof fetch) {
  const isDefaultFetch = fetchFn === fetch;
  if (isDefaultFetch) {
    const existing = jwksByBaseUrl.get(baseUrl);
    if (existing) {
      return existing;
    }
  }

  const jwks = createRemoteJWKSet(new URL(buildJwksUrl(baseUrl)), {
    [customFetch]: fetchFn,
  });

  if (isDefaultFetch) {
    jwksByBaseUrl.set(baseUrl, jwks);
  }

  return jwks;
}

type ResolveUserIdDependencies = {
  fetchFn?: typeof fetch;
  getAuthBaseUrl?: () => string;
  getJwtIssuer?: () => string | undefined;
  getJwtAudience?: () => string | string[] | undefined;
  sessionTimeoutMs?: number;
};

async function resolveUserIdFromBearerToken(
  token: string,
  dependencies: Required<ResolveUserIdDependencies>,
) {
  const baseUrl = dependencies.getAuthBaseUrl();
  const jwks = getCachedJwks(baseUrl, dependencies.fetchFn);
  const issuer = dependencies.getJwtIssuer();
  const audience = dependencies.getJwtAudience();

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });

    const userId = resolveUserIdFromJwtPayload(payload);
    if (!userId) {
      throw unauthorizedError("Unauthorized");
    }

    return userId;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof joseErrors.JOSEError) {
      throw unauthorizedError("Invalid or expired token");
    }

    throw new ApiError(
      500,
      "auth_resolution_error",
      error instanceof Error ? error.message : "Failed to verify bearer token",
    );
  }
}

async function resolveUserIdFromSession(
  request: Request,
  dependencies: Required<ResolveUserIdDependencies>,
) {
  const baseUrl = dependencies.getAuthBaseUrl();
  if (isProxyAuthPath(baseUrl)) {
    throw new ApiError(
      500,
      "auth_configuration_error",
      "NEON_AUTH_BASE_URL cannot point to a /api/auth proxy endpoint; set it to the Neon Auth upstream URL",
    );
  }

  if (isSelfAuthProxyBaseUrl(request.url, baseUrl)) {
    throw new ApiError(
      500,
      "auth_configuration_error",
      "NEON_AUTH_BASE_URL cannot point to this API /api/auth proxy; set it to the Neon Auth upstream URL",
    );
  }

  const sessionUrl = buildSessionUrl(baseUrl);
  const headers = buildSessionHeaders(request);

  let response: Response;
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    dependencies.sessionTimeoutMs,
  );

  try {
    response = await dependencies.fetchFn(sessionUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: abortController.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new ApiError(
        500,
        "auth_resolution_error",
        `Auth session request timed out after ${dependencies.sessionTimeoutMs}ms`,
      );
    }

    throw new ApiError(
      500,
      "auth_resolution_error",
      error instanceof Error ? error.message : "Failed to resolve user session",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw unauthorizedError("Unauthorized");
    }

    throw new ApiError(
      500,
      "auth_resolution_error",
      `Failed to resolve auth session (upstream status ${response.status})`,
    );
  }

  const payload = (await response.json()) as {
    data?: {
      session?: {
        user?: {
          id?: string;
        };
      };
      user?: {
        id?: string;
      };
    };
    user?: {
      id?: string;
    };
  };

  const userId =
    payload.data?.session?.user?.id ?? payload.data?.user?.id ?? payload.user?.id;

  if (!userId) {
    throw unauthorizedError("Unauthorized");
  }

  return userId;
}

async function resolveUserIdFromRequestUncached(
  request: Request,
  dependencies: Required<ResolveUserIdDependencies>,
) {
  const token = parseBearerToken(request.headers.get("authorization"));

  if (token) {
    return resolveUserIdFromBearerToken(token, dependencies);
  }

  return resolveUserIdFromSession(request, dependencies);
}

export async function resolveUserIdFromRequest(
  request: Request,
  dependencies: ResolveUserIdDependencies = {},
) {
  const resolvedDependencies: Required<ResolveUserIdDependencies> = {
    fetchFn: dependencies.fetchFn ?? fetch,
    getAuthBaseUrl: dependencies.getAuthBaseUrl ?? getAuthBaseUrlFromEnv,
    getJwtIssuer: dependencies.getJwtIssuer ?? getJwtIssuerFromEnv,
    getJwtAudience: dependencies.getJwtAudience ?? getJwtAudienceFromEnv,
    sessionTimeoutMs: dependencies.sessionTimeoutMs ?? AUTH_SESSION_TIMEOUT_MS,
  };

  const hasCustomDependencies =
    dependencies.fetchFn !== undefined ||
    dependencies.getAuthBaseUrl !== undefined ||
    dependencies.getJwtIssuer !== undefined ||
    dependencies.getJwtAudience !== undefined ||
    dependencies.sessionTimeoutMs !== undefined;

  if (hasCustomDependencies) {
    return resolveUserIdFromRequestUncached(request, resolvedDependencies);
  }

  const cached = requestUserIdCache.get(request);
  if (cached) {
    return cached;
  }

  const resolution = resolveUserIdFromRequestUncached(request, resolvedDependencies);
  requestUserIdCache.set(request, resolution);
  return resolution;
}
