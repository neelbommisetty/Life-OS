import type { NextRequest } from "next/server";
import { getApiBaseUrl } from "@/lib/api/base-url";

const STREAM_PATH = "/api/chat/stream";

async function proxyToApi(request: NextRequest) {
  try {
    const targetUrl = `${getApiBaseUrl()}${STREAM_PATH}`;
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
        error: "chat_stream_proxy_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to proxy chat stream request",
      },
      { status: 500 },
    );
  }
}

export const POST = proxyToApi;
