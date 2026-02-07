import { notFound, redirect } from "next/navigation";
import { AuthClient } from "./auth-client";
import { getApiSessionUser } from "@/lib/api/session";

export const dynamicParams = false;

const AUTH_PATHS = [
  "sign-in",
  "sign-up",
  "forget-password",
  "recover",
  "reset-password",
] as const;

type AuthPath = (typeof AUTH_PATHS)[number];

export function generateStaticParams() {
  return AUTH_PATHS.map((path) => ({ path }));
}

function normalizePath(path: AuthPath) {
  if (path === "recover") {
    return "forget-password";
  }

  return path;
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  const typedPath = path as AuthPath;

  if (!AUTH_PATHS.includes(typedPath)) {
    notFound();
  }

  const normalizedPath = normalizePath(typedPath);
  const sessionUser = await getApiSessionUser();
  if (sessionUser && (normalizedPath === "sign-in" || normalizedPath === "sign-up")) {
    redirect("/");
  }

  return (
    <main className="container mx-auto flex grow flex-col items-center justify-center gap-3 self-center p-4 md:p-6">
      <AuthClient path={normalizedPath} />
    </main>
  );
}
