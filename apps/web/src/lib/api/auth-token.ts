import "server-only";
import { authServer } from "@/lib/auth/server";
import { cache } from "react";

type AuthServerResult = {
  data: unknown;
  error: {
    message?: string;
    status?: number;
    statusText?: string;
  } | null;
};

type TokenExtractorInput = Record<string, unknown>;

function extractTokenFromObject(input: TokenExtractorInput) {
  const directCandidates = [
    input.token,
    input.accessToken,
    input.access_token,
    input.jwt,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const nestedData = input.data;
  if (nestedData && typeof nestedData === "object") {
    return extractTokenFromObject(nestedData as TokenExtractorInput);
  }

  return null;
}

function extractToken(data: unknown) {
  if (typeof data === "string" && data.trim().length > 0) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  return extractTokenFromObject(data as TokenExtractorInput);
}

async function requestTokenFromEndpoint(
  endpoint: (() => Promise<AuthServerResult>) | undefined,
) {
  if (!endpoint) {
    return { token: null, error: null as string | null };
  }

  const response = await endpoint();
  if (response.error) {
    return { token: null, error: response.error.message ?? "Token request failed" };
  }

  return { token: extractToken(response.data), error: null as string | null };
}

export const getApiBearerToken = cache(async () => {
  const { data: session } = await authServer.getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized: Please sign in to continue");
  }

  const tokenEndpoint = (authServer as unknown as { token?: () => Promise<AuthServerResult> })
    .token;
  const accessTokenEndpoint = (
    authServer as unknown as { getAccessToken?: () => Promise<AuthServerResult> }
  ).getAccessToken;

  const tokenResult = await requestTokenFromEndpoint(tokenEndpoint);
  if (tokenResult.token) {
    return tokenResult.token;
  }

  const accessTokenResult = await requestTokenFromEndpoint(accessTokenEndpoint);
  if (accessTokenResult.token) {
    return accessTokenResult.token;
  }

  const errorMessage =
    tokenResult.error ??
    accessTokenResult.error ??
    "Failed to exchange session for API token";

  throw new Error(errorMessage);
});
