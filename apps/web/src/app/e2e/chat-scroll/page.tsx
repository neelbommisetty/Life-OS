import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatScrollFixture } from "./chat-scroll-fixture";

export const metadata: Metadata = {
  title: "E2E Chat Scroll Fixture",
  description: "Internal fixture route for chat scroll end-to-end tests.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function ChatScrollE2EPage() {
  if (process.env.ENABLE_E2E_ROUTES !== "1") {
    notFound();
  }

  return <ChatScrollFixture />;
}
