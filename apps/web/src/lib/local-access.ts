import "server-only";
import { headers } from "next/headers";

export async function isLocalRequest() {
  if (process.env.VERCEL) return false;
  const host = (await headers()).get("host") ?? "";
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
}
