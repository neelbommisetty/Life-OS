import type { NextRequest } from "next/server";
import { getApiBaseUrl } from "@/lib/api/base-url";

type RouteParams = {
  path: string[];
};

function buildTargetUrl(path: string[], search: string) {
  const apiBaseUrl = getApiBaseUrl();
  const encodedPath = path.map(encodeURIComponent).join("/");
  return `${apiBaseUrl}/api/auth/${encodedPath}${search}`;
}

async function proxyToApi(request: NextRequest, { params }: { params: Promise<RouteParams> }) {
  try {
    const { path } = await params;
    const targetUrl = buildTargetUrl(path, request.nextUrl.search);
    const headers = new Headers(request.headers);
    headers.delete("host");

    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: upstreamResponse.headers,
    });
  } catch (error) {
    return Response.json(
      {
        error: "auth_proxy_error",
        message: error instanceof Error ? error.message : "Unable to proxy auth request",
      },
      { status: 500 },
    );
  }
}

export const GET = proxyToApi;
export const POST = proxyToApi;
export const PUT = proxyToApi;
export const PATCH = proxyToApi;
export const DELETE = proxyToApi;
