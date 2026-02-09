import type { Metadata } from "next";
import { ChatClient } from "./chat-client";
import { requireApiSessionUser } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Chat",
  description: "Chat with your AI workspace and manage conversation threads.",
};

export default async function ChatPage() {
  await requireApiSessionUser();

  return <ChatClient />;
}
