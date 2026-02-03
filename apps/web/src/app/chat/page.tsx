import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import { ChatClient } from "./chat-client";

export default async function ChatPage() {
  const { data: session } = await authServer.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  return <ChatClient />;
}
