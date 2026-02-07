import { ApiError, unauthorizedError } from "./errors.js";

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

function buildSessionUrl(getAuthBaseUrl: () => string) {
  return `${getAuthBaseUrl()}/get-session`;
}

type ResolveUserIdDependencies = {
  fetchFn?: typeof fetch;
  getAuthBaseUrl?: () => string;
};

export async function resolveUserIdFromRequest(
  request: Request,
  dependencies: ResolveUserIdDependencies = {},
) {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const getAuthBaseUrl = dependencies.getAuthBaseUrl ?? getAuthBaseUrlFromEnv;
  const sessionUrl = buildSessionUrl(getAuthBaseUrl);

  const headers = new Headers(request.headers);
  headers.delete("host");

  let response: Response;
  try {
    response = await fetchFn(sessionUrl, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch (error) {
    throw new ApiError(
      500,
      "auth_resolution_error",
      error instanceof Error ? error.message : "Failed to resolve user session",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw unauthorizedError("Unauthorized");
    }

    throw new ApiError(
      500,
      "auth_resolution_error",
      "Failed to resolve auth session",
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
