import { neonAuthMiddleware } from "@neondatabase/auth/next/server";

export default neonAuthMiddleware({
  // Redirects unauthenticated users to sign-in page
  loginUrl: "/auth/sign-in",
});

const PROTECTED_MATCHERS = [
  "/",
  "/analytics/:path*",
  "/chat/:path*",
  "/notes/:path*",
  "/projects/:path*",
  "/tasks/:path*",
  "/account/:path*",
];

export const config = {
  matcher: PROTECTED_MATCHERS,
};
