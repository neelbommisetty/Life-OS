import { notFound } from "next/navigation";
import { ChatScrollFixture } from "./chat-scroll-fixture";

export default function ChatScrollE2EPage() {
  if (process.env.ENABLE_E2E_ROUTES !== "1") {
    notFound();
  }

  return <ChatScrollFixture />;
}
