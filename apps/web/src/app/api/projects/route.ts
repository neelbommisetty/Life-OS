import type { NextRequest } from "next/server";
import { getApiBaseUrl } from "@/lib/api/base-url";
import { getProxyBodyAndNormalizeHeaders } from "@/lib/api/proxy-request";

function buildTargetUrl(search: string) {
  return `${getApiBaseUrl()}/projects${search}`;
}

async function proxyProjects(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("host");

  const body = await getProxyBodyAndNormalizeHeaders(request, headers);
  const upstreamResponse = await fetch(buildTargetUrl(request.nextUrl.search), {
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
}

export const POST = proxyProjects;
