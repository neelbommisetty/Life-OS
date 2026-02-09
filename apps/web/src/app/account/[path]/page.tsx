import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireApiSessionUser } from "@/lib/api/session";
import { AccountClient } from "./account-client";

const ACCOUNT_PATHS = ["profile", "security"] as const;

type AccountPath = (typeof ACCOUNT_PATHS)[number];

export const dynamicParams = false;

export function generateStaticParams() {
  return ACCOUNT_PATHS.map((path) => ({ path }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string }>;
}): Promise<Metadata> {
  const { path } = await params;
  const typedPath = path as AccountPath;
  const isKnownPath = ACCOUNT_PATHS.includes(typedPath);

  const titleByPath: Record<AccountPath, string> = {
    profile: "Account Profile",
    security: "Account Security",
  };

  const descriptionByPath: Record<AccountPath, string> = {
    profile: "Manage your profile information.",
    security: "Manage your account security settings.",
  };

  return {
    title: isKnownPath ? titleByPath[typedPath] : "Account",
    description: isKnownPath
      ? descriptionByPath[typedPath]
      : "Manage your account settings.",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  const typedPath = path as AccountPath;

  if (!ACCOUNT_PATHS.includes(typedPath)) {
    notFound();
  }

  const user = await requireApiSessionUser();

  return <AccountClient path={typedPath} user={user} />;
}
