import { auth } from "./auth";

/**
 * Get the current session on the server side
 * Use this in Server Components, Server Actions, and API routes
 */
export async function getSession() {
  return await auth.api.getSession({
    headers: await import("next/headers").then((m) => m.headers()),
  });
}

/**
 * Get the current user on the server side
 * Returns null if not authenticated
 */
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Require authentication - throws if not authenticated
 * Use this in protected routes/actions
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
