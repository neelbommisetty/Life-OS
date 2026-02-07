import { ChatClient } from "./chat-client";
import { requireApiSessionUser } from "@/lib/api/session";

export default async function ChatPage() {
  await requireApiSessionUser();

  return <ChatClient />;
}
