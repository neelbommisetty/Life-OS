import type { Metadata } from "next";
import { Suspense } from "react";
import { requireApiSessionUser } from "@/lib/api/session";
import { listArchivedInboxItems } from "@/lib/inbox/actions";
import { InboxArchiveClient } from "./archive-client";

export const metadata: Metadata = {
  title: "Inbox Archive",
  description: "Review archived inbox items.",
};

export default async function InboxArchivePage() {
  await requireApiSessionUser();

  const items = await listArchivedInboxItems();

  return (
    <Suspense fallback={null}>
      <InboxArchiveClient initialItems={items} />
    </Suspense>
  );
}
