import type { Metadata } from "next";
import { Suspense } from "react";
import { requireApiSessionUser } from "@/lib/api/session";
import { listInboxItems } from "@/lib/inbox/actions";
import { InboxClient } from "./inbox-client";

export const metadata: Metadata = {
  title: "Inbox",
  description: "Capture a thought, review when ready.",
};

export default async function InboxPage() {
  await requireApiSessionUser();

  const items = await listInboxItems();

  return (
    <Suspense fallback={null}>
      <InboxClient initialItems={items} />
    </Suspense>
  );
}
