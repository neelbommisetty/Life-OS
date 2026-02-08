import { Hono } from "hono";
import type { Context } from "hono";

const AUTH_PROXY_PREFIX = "/api/auth";
const PROXY_HEADER_DENYLIST = [
  "host",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
] as const;

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

async function buildProxyBody(request: Request, headers: Headers) {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    headers.delete("content-type");
    headers.delete("content-length");
    return undefined;
  }

  return body;
}

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
    for (const name of PROXY_HEADER_DENYLIST) {
      headers.delete(name);
    }

    const body = await buildProxyBody(request, headers);

    const upstreamResponse = await fetchFn(targetUrl, {
      method: request.method,
      headers,
      body,
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
