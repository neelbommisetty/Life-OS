import type { Metadata } from "next";
import { ArchiveClient } from "./archive-client";
import { requireApiSessionUser } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Archived Tasks",
  description: "Review and search your archived tasks.",
};

export default async function ArchivePage() {
  await requireApiSessionUser();

  return <ArchiveClient />;
}
