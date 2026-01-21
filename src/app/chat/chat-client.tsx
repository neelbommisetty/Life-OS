"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useChatStreaming, useChatScroll } from "@/hooks";
import {
  ThreadSelector,
  ChatHeader,
  ChatMessages,
  ChatInput,
} from "@/components/chat";
import type { ModelOption } from "@/components/chat";
import {
  listThreads,
  createThread,
  archiveThread,
  setThreadModel,
  listMessages,
  listModels,
} from "@/lib/chat/actions";
import type { ChatThread, ChatMessage, Project } from "@prisma/client";

type ChatThreadWithProject = ChatThread & { project: Project | null };

export function ChatClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const threadIdParam = searchParams.get("threadId");

  const [threads, setThreads] = useState<ChatThreadWithProject[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [nextCursor, setNextCursor] = useState<{ id: string; createdAt: Date } | null>(null);
  const [isCreatingThread, startCreateTransition] = useTransition();
  const [isArchivingThread, startArchiveTransition] = useTransition();
  const [isUpdatingModel, startModelTransition] = useTransition();
  const [modelError, setModelError] = useState<string | null>(null);
  const pageSize = 30;

  // Derived state
  const effectiveThreadId = useMemo(() => {
    if (!threads.length) return null;
    const paramIsValid =
      !!threadIdParam && threads.some((thread) => thread.id === threadIdParam);
    return paramIsValid ? threadIdParam : threads[0]?.id ?? null;
  }, [threadIdParam, threads]);

  const activeThread = threads.find((thread) => thread.id === effectiveThreadId) ?? null;
  const activeModel = useMemo(() => {
    if (!activeThread?.modelKey) return undefined;
    return models.find((m) => m.key === activeThread.modelKey);
  }, [activeThread, models]);

  // URL state management
  const setThreadIdInUrl = useCallback(
    (threadId: string | null, replace = false) => {
      const params = new URLSearchParams(searchParams.toString());
      if (threadId) {
        params.set("threadId", threadId);
      } else {
        params.delete("threadId");
      }
      const url = `${pathname}?${params.toString()}`;
      if (replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [pathname, router, searchParams]
  );

  // Invalidation handler for streaming hook
  const handleInvalidate = useCallback(
    async (threadId: string) => {
      // Refetch messages
      try {
        const result = await listMessages({ threadId, limit: pageSize });
        setMessages(result.messages);
        setNextCursor(result.nextCursor);
        setHasNextPage(!!result.nextCursor);
      } catch (error) {
        console.error("Failed to refresh messages:", error);
      }
      // Refetch threads (for lastChattedAt updates)
      try {
        const threadResult = await listThreads();
        setThreads(threadResult);
      } catch (error) {
        console.error("Failed to refresh threads:", error);
      }
    },
    [pageSize]
  );

  // Streaming hook
  const {
    isStreaming,
    streamingThreadId,
    streamingContent,
    optimisticUserMessage,
    optimisticStatus,
    pendingAssistantId,
    streamError,
    handleStreamingSubmit,
    handleStopStreaming,
    handleRegenerate,
  } = useChatStreaming({
    pageSize,
    messages,
    onInvalidate: handleInvalidate,
  });

  // Scroll hook
  const { messagesContainerRef, handleScroll } = useChatScroll({
    threadId: effectiveThreadId,
    messagesLength: messages.length,
    isLoading: isLoadingMessages,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage: async () => {
      if (!effectiveThreadId || !nextCursor || isFetchingNextPage) return;
      setIsFetchingNextPage(true);
      try {
        const result = await listMessages({
          threadId: effectiveThreadId,
          cursor: nextCursor,
          limit: pageSize,
        });
        setMessages((prev) => [...result.messages, ...prev]);
        setNextCursor(result.nextCursor);
        setHasNextPage(!!result.nextCursor);
      } catch (error) {
        console.error("Failed to fetch more messages:", error);
      } finally {
        setIsFetchingNextPage(false);
      }
    },
    isPending: isStreaming,
    streamingContent,
  });

  const isPending = isStreaming;
  const isActiveThreadStreaming = isStreaming && streamingThreadId === effectiveThreadId;
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "ASSISTANT") {
        return messages[i]?.id ?? null;
      }
    }
    return null;
  }, [messages]);

  // Load initial data
  useEffect(() => {
    async function loadInitialData() {
      setIsLoadingThreads(true);
      setIsLoadingModels(true);
      try {
        const [threadsResult, modelsResult] = await Promise.all([
          listThreads(),
          listModels(),
        ]);
        setThreads(threadsResult);
        setModels(modelsResult);
      } catch (error) {
        console.error("Failed to load initial data:", error);
      } finally {
        setIsLoadingThreads(false);
        setIsLoadingModels(false);
      }
    }
    loadInitialData();
  }, []);

  // Load messages when thread changes
  useEffect(() => {
    if (!effectiveThreadId) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      setIsLoadingMessages(true);
      try {
        const result = await listMessages({
          threadId: effectiveThreadId!,
          limit: pageSize,
        });
        setMessages(result.messages);
        setNextCursor(result.nextCursor);
        setHasNextPage(!!result.nextCursor);
      } catch (error) {
        console.error("Failed to load messages:", error);
      } finally {
        setIsLoadingMessages(false);
      }
    }
    loadMessages();
  }, [effectiveThreadId, pageSize]);

  // Sync URL with effective thread ID
  useEffect(() => {
    if (isLoadingThreads) return;
    if (!effectiveThreadId) return;
    const paramIsValid =
      !!threadIdParam && threads.some((thread) => thread.id === threadIdParam);
    if (!paramIsValid) {
      setThreadIdInUrl(effectiveThreadId, true);
    }
  }, [effectiveThreadId, setThreadIdInUrl, threadIdParam, threads, isLoadingThreads]);

  // Handlers
  const handleSubmit = async (
    e?: React.SyntheticEvent,
    contentOverride?: string
  ) => {
    e?.preventDefault();
    const content = contentOverride || input.trim();
    if (!content || isPending || !effectiveThreadId) return;

    handleStreamingSubmit(content, effectiveThreadId);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleCreateThread = () => {
    startCreateTransition(async () => {
      try {
        const thread = await createThread();
        setThreads((prev) => [thread, ...prev]);
        setThreadIdInUrl(thread.id);
      } catch (error) {
        console.error("Failed to create thread:", error);
      }
    });
  };

  const handleArchiveThread = () => {
    if (!effectiveThreadId) return;
    startArchiveTransition(async () => {
      try {
        await archiveThread({ threadId: effectiveThreadId });
        setThreads((prev) => prev.filter((t) => t.id !== effectiveThreadId));
        setThreadIdInUrl(null, true);
      } catch (error) {
        console.error("Failed to archive thread:", error);
      }
    });
  };

  const handleModelChange = (modelKey: string | null) => {
    if (
      activeThread?.modelKey === modelKey ||
      isUpdatingModel ||
      !effectiveThreadId
    ) {
      return;
    }
    setModelError(null);
    startModelTransition(async () => {
      try {
        const updated = await setThreadModel({
          threadId: effectiveThreadId,
          modelKey,
        });
        setThreads((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
      } catch (error) {
        setModelError(error instanceof Error ? error.message : "Failed to update model");
      }
    });
  };

  const handleRegenerateClick = useCallback(
    (messageId: string) => {
      if (!effectiveThreadId || isPending) return;
      handleRegenerate(messageId, effectiveThreadId);
    },
    [effectiveThreadId, handleRegenerate, isPending]
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col sm:flex-row rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <ThreadSelector
          threads={threads}
          value={effectiveThreadId}
          onChange={(threadId) => setThreadIdInUrl(threadId)}
          onCreate={handleCreateThread}
          onArchive={handleArchiveThread}
          isCreating={isCreatingThread}
          isArchiving={isArchivingThread}
          isLocked={false}
          isStreaming={isStreaming}
          streamingThreadId={streamingThreadId}
          layout="side"
        />

        <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader
          threadTitle={activeThread?.name}
          activeModel={activeModel}
        />

        <ChatMessages
          messages={messages}
          isLoading={isLoadingMessages || isLoadingThreads}
          isFetchingNextPage={isFetchingNextPage}
          effectiveThreadId={effectiveThreadId}
          lastMessageId={lastMessageId}
          lastAssistantMessageId={lastAssistantMessageId}
          activeModel={activeModel}
          optimisticUserMessage={optimisticUserMessage}
          optimisticStatus={optimisticStatus}
          isActiveThreadStreaming={isActiveThreadStreaming}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          pendingAssistantId={pendingAssistantId}
          streamError={streamError}
          isPending={isPending}
          messagesContainerRef={messagesContainerRef}
          onScroll={handleScroll}
          onRegenerate={handleRegenerateClick}
          onStopStreaming={handleStopStreaming}
          onSelectPrompt={(prompt) => handleSubmit(undefined, prompt)}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          isPending={isPending}
          effectiveThreadId={effectiveThreadId}
          models={models}
          activeModelKey={activeThread?.modelKey ?? null}
          onModelChange={handleModelChange}
          modelsLoading={isLoadingModels}
          modelUpdating={isUpdatingModel}
          modelErrorMessage={modelError ?? undefined}
        />
      </div>
    </div>
  );
}
