import type { NextRequest } from "next/server";
import { createLogger } from "@life-os/logger";
import { getApiBaseUrl } from "@/lib/api/base-url";

const STREAM_PATH = "/api/chat/stream";
const REQUEST_ID_HEADER = "x-request-id";
const logger = createLogger("web:api-proxy:chat-stream");

function getRequestId(request: NextRequest) {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim();
  if (existing) {
    return existing;
  }

  return crypto.randomUUID();
}

async function proxyToApi(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const targetUrl = `${getApiBaseUrl()}${STREAM_PATH}`;
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set(REQUEST_ID_HEADER, requestId);

    logger.info("Proxying chat stream request", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      query: request.nextUrl.search || undefined,
    });

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

    logger.info("Chat stream proxy completed", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      status: upstreamResponse.status,
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.set(REQUEST_ID_HEADER, requestId);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    logger.error("Chat stream proxy failed", {
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      {
        error: "chat_stream_proxy_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to proxy chat stream request",
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

export const POST = proxyToApi;
