import "server-only";
import { resolveApiBaseUrl } from "./base-url-resolver";

export function getApiBaseUrl() {
  return resolveApiBaseUrl({
    apiBaseUrl: process.env.API_BASE_URL,
    publicApiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
}

export function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}
