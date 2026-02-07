import { ArchiveClient } from "./archive-client";
import { requireApiSessionUser } from "@/lib/api/session";

export default async function ArchivePage() {
  await requireApiSessionUser();

  return <ArchiveClient />;
}
