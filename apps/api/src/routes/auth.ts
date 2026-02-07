import { Hono } from "hono";

export const authRoute = new Hono();

const AUTH_PROXY_PREFIX = "/api/auth";

function getAuthBaseUrl() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("NEON_AUTH_BASE_URL is required to proxy auth requests");
  }
  return baseUrl;
}

function buildProxyUrl(requestUrl: string, requestPath: string) {
  const baseUrl = getAuthBaseUrl();
  const url = new URL(requestUrl);
  const pathAfterPrefix = requestPath.replace(AUTH_PROXY_PREFIX, "");
  const normalizedPath = pathAfterPrefix.startsWith("/")
    ? pathAfterPrefix
    : `/${pathAfterPrefix}`;
  return `${baseUrl}${normalizedPath}${url.search}`;
}

async function proxyAuthRequest(request: Request) {
  const targetUrl = buildProxyUrl(request.url, new URL(request.url).pathname);
  const headers = new Headers(request.headers);
  headers.delete("host");

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: upstreamResponse.headers,
  });
}

authRoute.all("/api/auth", async (c) => {
  try {
    return await proxyAuthRequest(c.req.raw);
  } catch (error) {
    return c.json(
      {
        error: "auth_proxy_error",
        message: error instanceof Error ? error.message : "Unable to proxy auth request",
      },
      500,
    );
  }
});

authRoute.all("/api/auth/*", async (c) => {
  try {
    return await proxyAuthRequest(c.req.raw);
  } catch (error) {
    return c.json(
      {
        error: "auth_proxy_error",
        message: error instanceof Error ? error.message : "Unable to proxy auth request",
      },
      500,
    );
  }
});
