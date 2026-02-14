import type { Metadata } from "next";
import { ChatClient } from "./chat-client";
import { requireApiSessionUser } from "@/lib/api/session";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: brand.terms.assistant,
  description: "Draft, summarize, and turn work into a clear next step.",
};

export default async function ChatPage() {
  await requireApiSessionUser();

  return <ChatClient />;
}
