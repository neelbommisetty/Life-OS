import { Suspense } from "react";
import type { Metadata } from "next";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string }>;
}): Promise<Metadata> {
  const { path } = await params;
  const typedPath = path as AuthPath;
  const normalizedPath = AUTH_PATHS.includes(typedPath)
    ? normalizePath(typedPath)
    : "sign-in";

  const titleByPath: Record<Exclude<AuthPath, "recover">, string> = {
    "sign-in": "Sign In",
    "sign-up": "Sign Up",
    "forget-password": "Forgot Password",
    "reset-password": "Reset Password",
  };

  const descriptionByPath: Record<Exclude<AuthPath, "recover">, string> = {
    "sign-in": "Access your Life-OS account.",
    "sign-up": "Create your Life-OS account.",
    "forget-password": "Request a password reset link.",
    "reset-password": "Set a new password for your account.",
  };

  return {
    title: titleByPath[normalizedPath],
    description: descriptionByPath[normalizedPath],
    robots: {
      index: false,
      follow: false,
    },
  };
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
      <Suspense fallback={null}>
        <AuthClient path={normalizedPath} />
      </Suspense>
    </main>
  );
}
