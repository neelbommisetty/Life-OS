"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  startTransition,
} from "react";
import { api } from "@/trpc/client";
import { cn } from "@/lib/utils";
import { useProjectTheme } from "@/lib/hooks/use-project-theme";
import { useChatStreaming } from "./hooks/use-chat-streaming";
import { useChatTasks } from "./hooks/use-chat-tasks";
import { useChatScroll } from "./hooks/use-chat-scroll";
import { pushUrl, replaceUrl } from "@/lib/url-state";
import { usePathname, useSearchParams } from "next/navigation";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { ThreadSelector } from "./thread-selector";
import { type ModelOption } from "./model-selector";
import { ChatHeader } from "./chat/chat-header";
import { ChatMessages } from "./chat/chat-messages";
import { ChatInput } from "./chat/chat-input";

type Props = {
  projectId: string;
  accentColor?: string | null;
  layout?: "default" | "drawer";
  className?: string;
};

export function ProjectChat({
  projectId,
  accentColor,
  layout = "default",
  className,
}: Props) {
  const { style: themeStyle, hasColor: hasAccentColor } = useProjectTheme(accentColor);
  const isDrawer = layout === "drawer";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [threadIdParam, setThreadIdParam] = useSearchParamState<string | null>("threadId", null);
  const [chatDraftParam, setChatDraftParam] = useSearchParamState<string | null>("chatDraft", null);
  const [input, setInput] = useState("");
  const pageSize = 30;

  const projectQuery = api.project.getById.useQuery(
    { id: projectId },
    { staleTime: 1000 * 60 * 5 } // Cache project info for 5 mins
  );

  const threadsQuery = api.chat.listThreads.useQuery({
    projectId,
  });

  const modelsQuery = api.chat.listModels.useQuery(undefined, {
    staleTime: 1000 * 60 * 60, // Models don't change often
  });

  const utils = api.useUtils();
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);

  const effectiveThreadId = useMemo(() => {
    if (!threads.length) return null;
    const paramIsValid =
      !!threadIdParam && threads.some((thread) => thread.id === threadIdParam);
    return paramIsValid ? threadIdParam : threads[0]?.id ?? null;
  }, [threadIdParam, threads]);
  const activeThread =
    threads.find((thread) => thread.id === effectiveThreadId) ?? null;

  const messagesQuery = api.chat.listMessages.useInfiniteQuery(
    { projectId, threadId: effectiveThreadId ?? "", limit: pageSize },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      enabled: !!effectiveThreadId,
    }
  );

  // Send message mutation
  const sendMessageMutation = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      setInput("");
      if (effectiveThreadId) {
        utils.chat.listMessages.invalidate({
          projectId,
          threadId: effectiveThreadId,
          limit: pageSize,
        });
      }
      utils.chat.listThreads.invalidate({ projectId });
    },
  });

  const createArtifactMutation = api.artifact.create.useMutation({
    onSuccess: () => {
      utils.artifact.list.invalidate({ projectId });
    },
  });

  const [artifactStatusByMessageId, setArtifactStatusByMessageId] = useState<
    Record<string, "saving" | "saved" | "error">
  >({});

  const setThreadIdInUrl = useCallback(
    (threadId: string | null, replace = false) => {
      setThreadIdParam(threadId, replace);
    },
    [setThreadIdParam]
  );

  const setThreadModelMutation = api.chat.setThreadModel.useMutation({
    onSuccess: (updatedThread) => {
      utils.chat.listThreads.setData({ projectId }, (existing) => {
        if (!existing) return [updatedThread];
        return existing.map((thread) =>
          thread.id === updatedThread.id ? updatedThread : thread
        );
      });
    },
  });

  const setThreadReasoningMutation = api.chat.setThreadReasoning.useMutation({
    onSuccess: (updatedThread) => {
      utils.chat.listThreads.setData({ projectId }, (existing) => {
        if (!existing) return [updatedThread];
        return existing.map((thread) =>
          thread.id === updatedThread.id ? updatedThread : thread
        );
      });
    },
  });

  const createThreadMutation = api.chat.createThread.useMutation({
    onSuccess: (thread) => {
      utils.chat.listThreads.setData({ projectId }, (existing) => {
        if (!existing) return [thread];
        return [thread, ...existing.filter((item) => item.id !== thread.id)];
      });
      setThreadIdInUrl(thread.id);
    },
  });

  const archiveThreadMutation = api.chat.archiveThread.useMutation({
    onSuccess: () => {
      utils.chat.listThreads.invalidate({ projectId });
      setThreadIdInUrl(null, true);
    },
  });

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    return pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages);
  }, [messagesQuery.data]);

  const modelLookup = useMemo(() => {
    const entries = (modelsQuery.data ?? []).map(
      (model) => [model.key, model] as const
    );
    return new Map<string, ModelOption>(entries);
  }, [modelsQuery.data]);

  const activeModel = useMemo(() => {
    if (!activeThread?.modelKey) return undefined;
    const key = activeThread.modelKey as ModelOption["key"];
    return modelLookup.get(key);
  }, [activeThread, modelLookup]);

  // Custom hooks
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
    projectId,
    pageSize,
    messages,
    sendMessageMutation,
  });

  const {
    handleApproveTask,
    handleApproveAll,
    isPending: tasksPending,
  } = useChatTasks({
    projectId,
    threadId: effectiveThreadId,
    pageSize,
  });

  const { messagesContainerRef, handleScroll } = useChatScroll({
    threadId: effectiveThreadId,
    messagesLength: messages.length,
    isLoading: messagesQuery.isLoading,
    isFetchingNextPage: messagesQuery.isFetchingNextPage,
    hasNextPage: messagesQuery.hasNextPage ?? false,
    fetchNextPage: messagesQuery.fetchNextPage,
    isPending: sendMessageMutation.isPending || isStreaming,
    streamingContent,
  });

  const isPending = sendMessageMutation.isPending || isStreaming;
  const isActiveThreadStreaming =
    isStreaming && streamingThreadId === effectiveThreadId;
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "ASSISTANT") {
        return messages[i]?.id ?? null;
      }
    }
    return null;
  }, [messages]);

  const handleSubmit = async (
    e?: React.SyntheticEvent,
    contentOverride?: string
  ) => {
    e?.preventDefault();
    const content = contentOverride || input.trim();
    if (!content || isPending || !effectiveThreadId) return;

    // Use streaming by default
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

  const modelErrorMessage =
    setThreadModelMutation.error?.message ?? modelsQuery.error?.message;

  const handleModelChange = (modelKey: string | null) => {
    if (
      activeThread?.modelKey === modelKey ||
      setThreadModelMutation.isPending ||
      !effectiveThreadId
    ) {
      return;
    }
    setThreadModelMutation.mutate({
      projectId,
      threadId: effectiveThreadId,
      modelKey,
    });
  };

  const handleReasoningToggle = (nextEnabled: boolean) => {
    if (
      !effectiveThreadId ||
      !activeModel?.supportsReasoning ||
      setThreadReasoningMutation.isPending
    ) {
      return;
    }
    setThreadReasoningMutation.mutate({
      projectId,
      threadId: effectiveThreadId,
      reasoningEnabled: nextEnabled,
    });
  };

  const handleRegenerateClick = useCallback(
    (messageId: string) => {
      if (!effectiveThreadId || isPending) return;
      handleRegenerate(messageId, effectiveThreadId);
    },
    [effectiveThreadId, handleRegenerate, isPending]
  );

  const handleMessagesKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const container = messagesContainerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>("[data-message-id]")
      );
      if (!items.length) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = items.findIndex((item) => item === activeElement);
      const fallbackIndex = items.length - 1;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const nextIndex =
        currentIndex === -1
          ? fallbackIndex
          : Math.max(0, Math.min(items.length - 1, currentIndex + direction));
      const nextItem = items[nextIndex];
      if (nextItem) {
        event.preventDefault();
        nextItem.focus();
      }
    },
    [messagesContainerRef]
  );

  useEffect(() => {
    if (threadsQuery.isLoading) {
      return;
    }
    if (!effectiveThreadId) {
      return;
    }
    const paramIsValid =
      !!threadIdParam && threads.some((thread) => thread.id === threadIdParam);
    if (!paramIsValid) {
      setThreadIdInUrl(effectiveThreadId, true);
    }
  }, [
    effectiveThreadId,
    setThreadIdInUrl,
    threadIdParam,
    threads,
    threadsQuery.isLoading,
  ]);

  useEffect(() => {
    if (!chatDraftParam) {
      return;
    }
    if (!input.trim()) {
      startTransition(() => {
        setInput(chatDraftParam);
      });
    }
    setChatDraftParam(null, true);
  }, [chatDraftParam, input, setChatDraftParam]);

  const stripJsonBlock = useCallback((content: string) => {
    return content.replace(/```json[\s\S]*?```/g, "").trim();
  }, []);

  const deriveArtifactTitle = useCallback((content: string) => {
    const firstLine =
      content.split("\n").find((line) => line.trim().length > 0) ?? "";
    return firstLine.trim().slice(0, 80) || "Brainstorm note";
  }, []);

  const handleSaveArtifact = useCallback(
    (messageId: string, content: string) => {
      const cleaned = stripJsonBlock(content);
      if (!cleaned) {
        setArtifactStatusByMessageId((prev) => ({
          ...prev,
          [messageId]: "error",
        }));
        return;
      }
      const title = deriveArtifactTitle(cleaned);
      setArtifactStatusByMessageId((prev) => ({
        ...prev,
        [messageId]: "saving",
      }));
      createArtifactMutation.mutate(
        {
          projectId,
          type: "TEXT",
          title,
          content: cleaned,
        },
        {
          onSuccess: () => {
            setArtifactStatusByMessageId((prev) => ({
              ...prev,
              [messageId]: "saved",
            }));
          },
          onError: () => {
            setArtifactStatusByMessageId((prev) => ({
              ...prev,
              [messageId]: "error",
            }));
          },
        }
      );
    },
    [createArtifactMutation, deriveArtifactTitle, projectId, stripJsonBlock]
  );

  return (
    <div
      className={cn(
        "flex min-h-0",
        isDrawer
          ? "h-full flex-col bg-transparent"
          : "h-[600px] flex-col sm:flex-row rounded-xl border border-border bg-card shadow-sm",
        className
      )}
    >
      <ThreadSelector
        threads={threads}
        value={effectiveThreadId}
        onChange={(threadId) => {
          setThreadIdInUrl(threadId);
        }}
        onCreate={() => createThreadMutation.mutate({ projectId })}
        onArchive={() => {
          if (!effectiveThreadId) return;
          archiveThreadMutation.mutate({
            projectId,
            threadId: effectiveThreadId,
          });
        }}
        isCreating={createThreadMutation.isPending}
        isArchiving={archiveThreadMutation.isPending}
        isLocked={false}
        isStreaming={isStreaming}
        streamingThreadId={streamingThreadId}
        layout={isDrawer ? "stacked" : "side"}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader
          projectName={projectQuery.data?.name}
          projectEmoji={projectQuery.data?.icon}
          threadTitle={activeThread?.name}
          activeModel={activeModel}
          reasoningEnabled={activeThread?.reasoningEnabled ?? false}
          showReasoningToggle={Boolean(activeModel?.supportsReasoning)}
          reasoningUpdating={setThreadReasoningMutation.isPending}
          onToggleReasoning={handleReasoningToggle}
          themeStyle={themeStyle}
          hasAccentColor={hasAccentColor}
          isDrawer={isDrawer}
        />

        <ChatMessages
          messages={messages}
          isLoading={messagesQuery.isLoading || threadsQuery.isLoading}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          hasAccentColor={hasAccentColor}
          themeStyle={themeStyle}
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
          tasksPending={tasksPending}
          isPending={isPending}
          messagesContainerRef={messagesContainerRef}
          onScroll={handleScroll}
          onKeyDown={handleMessagesKeyDown}
          onApproveTask={handleApproveTask}
          onApproveAll={handleApproveAll}
          onRegenerate={handleRegenerateClick}
          onSaveArtifact={handleSaveArtifact}
          onStopStreaming={handleStopStreaming}
          onSelectPrompt={(prompt) => handleSubmit(undefined, prompt)}
          artifactStatusByMessageId={artifactStatusByMessageId}
        />

        <ChatInput
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          isPending={isPending}
          effectiveThreadId={effectiveThreadId}
          hasAccentColor={hasAccentColor}
          themeStyle={themeStyle}
          models={modelsQuery.data ?? []}
          activeModelKey={activeThread?.modelKey ?? null}
          onModelChange={handleModelChange}
          modelsLoading={modelsQuery.isLoading}
          modelUpdating={setThreadModelMutation.isPending}
          modelErrorMessage={modelErrorMessage}
          isDrawer={isDrawer}
        />
      </div>
    </div>
  );
}
