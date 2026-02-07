"use client";

import { useEffect, useMemo, useState } from "react";
import { useChatScroll } from "@/hooks/use-chat-scroll";

type ThreadId = "thread-a" | "thread-b";

const THREAD_MESSAGES: Record<ThreadId, string[]> = {
  "thread-a": Array.from({ length: 14 }, (_, index) => `Thread A message ${index + 1}`),
  "thread-b": Array.from({ length: 14 }, (_, index) => `Thread B message ${index + 1}`),
};

export function ChatScrollFixture() {
  const [threadId, setThreadId] = useState<ThreadId>("thread-a");
  const [messages, setMessages] = useState<string[]>(THREAD_MESSAGES["thread-a"]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isTailExpanded, setIsTailExpanded] = useState(false);

  const handleSelectThread = (nextThreadId: ThreadId) => {
    if (nextThreadId === threadId) return;
    setIsLoadingMessages(true);
    setIsTailExpanded(false);
    setThreadId(nextThreadId);
  };

  const { messagesContainerRef, handleScroll } = useChatScroll({
    threadId,
    messagesLength: messages.length,
    isLoading: isLoadingMessages,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: () => {
      // No-op for the e2e fixture.
    },
    isPending: false,
    streamingContent: "",
  });

  useEffect(() => {
    const loadTimer = setTimeout(() => {
      setMessages(THREAD_MESSAGES[threadId]);
      setIsLoadingMessages(false);
    }, 80);

    return () => {
      clearTimeout(loadTimer);
    };
  }, [threadId]);

  useEffect(() => {
    if (isLoadingMessages) return;

    const growthTimer = setTimeout(() => {
      setIsTailExpanded(true);
    }, 280);

    return () => {
      clearTimeout(growthTimer);
    };
  }, [threadId, isLoadingMessages]);

  const activeThreadLabel = useMemo(() => {
    return threadId === "thread-a" ? "Thread A" : "Thread B";
  }, [threadId]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-6" data-testid="chat-scroll-fixture">
      <h1 className="text-lg font-semibold">Chat scroll regression fixture</h1>
      <p className="text-sm text-muted-foreground" data-testid="active-thread">
        Active: {activeThreadLabel}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => handleSelectThread("thread-a")}
        >
          Thread A
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => handleSelectThread("thread-b")}
        >
          Thread B
        </button>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        data-testid="messages-container"
        className="min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-3"
        style={{ height: 320 }}
      >
        {messages.map((message, index) => (
          <div
            key={message}
            className="mb-2 rounded border bg-muted/40 px-3 py-2 text-sm"
            style={{ minHeight: 56 }}
            data-testid={index === messages.length - 1 ? "latest-message" : undefined}
          >
            {message}
          </div>
        ))}

        <div
          data-testid="delayed-tail"
          data-expanded={isTailExpanded ? "true" : "false"}
          style={{ height: isTailExpanded ? 900 : 0 }}
          className="transition-[height] duration-150"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
