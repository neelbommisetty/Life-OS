import type { NextRequest } from "next/server";
import { createLogger } from "@life-os/logger";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { getProxyBodyAndNormalizeHeaders } from "@/lib/api/proxy-request";

type RouteParams = {
  path: string[];
};

const REQUEST_ID_HEADER = "x-request-id";
const logger = createLogger("web:api-proxy:auth");

function buildTargetUrl(path: string[], search: string) {
  const apiBaseUrl = getApiBaseUrl();
  const encodedPath = path.map(encodeURIComponent).join("/");
  return `${apiBaseUrl}/api/auth/${encodedPath}${search}`;
}

function getRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (existing) {
    return existing;
  }

  return crypto.randomUUID();
}

async function proxyToApi(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const requestId = getRequestId(request);

  try {
    const { path } = await params;
    const targetUrl = buildTargetUrl(path, request.nextUrl.search);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set(REQUEST_ID_HEADER, requestId);

    logger.info("Proxying auth request", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      query: request.nextUrl.search || undefined,
      targetUrl,
    });

    const body = await getProxyBodyAndNormalizeHeaders(request, headers);

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    logger.info("Auth proxy completed", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      status: upstreamResponse.status,
      upstreamLocation:
        upstreamResponse.status >= 300 && upstreamResponse.status < 400
          ? upstreamResponse.headers.get("location") ?? undefined
          : undefined,
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set(REQUEST_ID_HEADER, requestId);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    logger.error("Auth proxy failed", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      {
        error: "auth_proxy_error",
        message: error instanceof Error ? error.message : "Unable to proxy auth request",
      },
      {
        status: 500,
        headers: {
          [REQUEST_ID_HEADER]: requestId,
        },
      },
    );
  }
}

export const GET = proxyToApi;
export const POST = proxyToApi;
export const PUT = proxyToApi;
export const PATCH = proxyToApi;
export const DELETE = proxyToApi;
