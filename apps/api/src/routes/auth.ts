import { Hono } from "hono";
import type { Context } from "hono";

const AUTH_PROXY_PREFIX = "/api/auth";

function getAuthBaseUrlFromEnv() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("NEON_AUTH_BASE_URL is required to proxy auth requests");
  }
  return baseUrl;
}

function buildProxyUrl(
  requestUrl: string,
  requestPath: string,
  getAuthBaseUrl: () => string,
) {
  const baseUrl = getAuthBaseUrl();
  const url = new URL(requestUrl);
  const pathAfterPrefix = requestPath.replace(AUTH_PROXY_PREFIX, "");
  const normalizedPath = pathAfterPrefix.startsWith("/")
    ? pathAfterPrefix
    : `/${pathAfterPrefix}`;
  return `${baseUrl}${normalizedPath}${url.search}`;
}

function isAuthUpstreamPath(pathname: string, authBasePath: string) {
  return pathname === authBasePath || pathname.startsWith(`${authBasePath}/`);
}

function rewriteUpstreamRedirectLocation(
  location: string | null,
  getAuthBaseUrl: () => string,
) {
  if (!location) {
    return null;
  }

  const authBaseUrl = new URL(getAuthBaseUrl());
  const normalizedAuthBasePath = authBaseUrl.pathname.replace(/\/+$/, "");
  const resolvedLocation = new URL(location, authBaseUrl);

  if (
    resolvedLocation.origin !== authBaseUrl.origin ||
    !isAuthUpstreamPath(resolvedLocation.pathname, normalizedAuthBasePath)
  ) {
    return location;
  }

  const pathSuffix = resolvedLocation.pathname.slice(normalizedAuthBasePath.length);
  return `${AUTH_PROXY_PREFIX}${pathSuffix}${resolvedLocation.search}${resolvedLocation.hash}`;
}

type AuthRouteDependencies = {
  fetchFn?: typeof fetch;
  getAuthBaseUrl?: () => string;
};

export function createAuthRoute(dependencies: AuthRouteDependencies = {}) {
  const authRoute = new Hono();
  const fetchFn = dependencies.fetchFn ?? fetch;
  const getAuthBaseUrl = dependencies.getAuthBaseUrl ?? getAuthBaseUrlFromEnv;

  async function proxyAuthRequest(request: Request) {
    const targetUrl = buildProxyUrl(
      request.url,
      new URL(request.url).pathname,
      getAuthBaseUrl,
    );

    const headers = new Headers(request.headers);
    headers.delete("host");

    const upstreamResponse = await fetchFn(targetUrl, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      redirect: "manual",
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    const rewrittenLocation = rewriteUpstreamRedirectLocation(
      responseHeaders.get("location"),
      getAuthBaseUrl,
    );

    if (rewrittenLocation) {
      responseHeaders.set("location", rewrittenLocation);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  const handler = async (c: Context) => {
    try {
      return await proxyAuthRequest(c.req.raw);
    } catch (error) {
      return c.json(
        {
          error: "auth_proxy_error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to proxy auth request",
        },
        500,
      );
    }
  };

  authRoute.all("/api/auth", handler);
  authRoute.all("/api/auth/*", handler);

  return authRoute;
}

export const authRoute = createAuthRoute();
