type ResolveApiBaseUrlInput = {
  apiBaseUrl?: string | null;
  publicApiBaseUrl?: string | null;
  nodeEnv?: string | null;
};

function normalizeBaseUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\/+$/, "");
}

export function resolveApiBaseUrl({
  apiBaseUrl,
  publicApiBaseUrl,
  nodeEnv,
}: ResolveApiBaseUrlInput) {
  const configuredServerBaseUrl = normalizeBaseUrl(apiBaseUrl);
  if (configuredServerBaseUrl) {
    return configuredServerBaseUrl;
  }

  if (nodeEnv !== "production") {
    return "http://localhost:3001";
  }

  const configuredPublicBaseUrl = normalizeBaseUrl(publicApiBaseUrl);
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl;
  }

  throw new Error("API_BASE_URL or NEXT_PUBLIC_API_BASE_URL must be set");
}
