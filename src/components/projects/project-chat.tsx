"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/trpc/client";
import {
  SendIcon,
  LoaderIcon,
  AlertCircleIcon,
  StopCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getProjectTheme } from "@/lib/project-theme";
import { MessageBubble } from "./message-bubble";
import { ModelSelector, type ModelOption } from "./model-selector";
import { ChatMarkdown } from "./chat-markdown";
import { ThreadSelector } from "./thread-selector";
import { useChatStreaming } from "./hooks/use-chat-streaming";
import { useChatTasks } from "./hooks/use-chat-tasks";
import { useChatScroll } from "./hooks/use-chat-scroll";
import { useUrlState, pushUrl, replaceUrl } from "@/lib/url-state";

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
  const themeStyle = getProjectTheme(accentColor);
  const hasAccentColor = !!accentColor && Object.keys(themeStyle).length > 0;
  const isDrawer = layout === "drawer";
  const urlState = useUrlState();
  const searchParams = useMemo(() => new URLSearchParams(urlState.search), [urlState.search]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageSize = 30;
  const threadsQuery = api.chat.listThreads.useQuery({
    projectId,
  });

  const modelsQuery = api.chat.listModels.useQuery();

  const utils = api.useUtils();
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);
  const threadIdParam = searchParams.get("threadId");
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
      const nextParams = new URLSearchParams(searchParams.toString());
      if (threadId) {
        nextParams.set("threadId", threadId);
      } else {
        nextParams.delete("threadId");
      }
      const query = nextParams.toString();
      const basePath = urlState.pathname || `/projects/${projectId}`;
      const nextUrl = query ? `${basePath}?${query}` : basePath;
      if (replace) {
        replaceUrl(nextUrl);
        return;
      }
      pushUrl(nextUrl);
    },
    [projectId, searchParams, urlState.pathname]
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

  const messageTimestampFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    []
  );

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
  }, [activeThread?.modelKey, modelLookup]);

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

  const isEmpty = messages.length === 0;
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
    const draftParam = searchParams.get("chatDraft");
    if (!draftParam) {
      return;
    }
    if (!input.trim()) {
      setInput(draftParam);
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("chatDraft");
    const query = nextParams.toString();
    const basePath = urlState.pathname || `/projects/${projectId}`;
    replaceUrl(query ? `${basePath}?${query}` : basePath);
  }, [input, projectId, searchParams, urlState.pathname]);

  const stripJsonBlock = useCallback((content: string) => {
    return content.replace(/```json[\s\S]*?```/g, "").trim();
  }, []);

  const deriveArtifactTitle = useCallback((content: string) => {
    const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
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
        "flex min-h-0 flex-col",
        isDrawer
          ? "h-full bg-transparent"
          : "h-[600px] rounded-xl border border-border bg-card shadow-sm",
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
          archiveThreadMutation.mutate({ projectId, threadId: effectiveThreadId });
        }}
        isCreating={createThreadMutation.isPending}
        isArchiving={archiveThreadMutation.isPending}
        isLocked={false}
        isStreaming={isStreaming}
        streamingThreadId={streamingThreadId}
        layout={isDrawer ? "stacked" : "side"}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          onKeyDown={handleMessagesKeyDown}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
          role="list"
          aria-label="Chat messages"
          aria-live="polite"
          tabIndex={0}
        >
        {messagesQuery.isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="h-3 w-3 animate-spin" />
              Loading older messages...
            </div>
          </div>
        )}

        {(threadsQuery.isLoading || messagesQuery.isLoading) && (
          <div className="flex h-full items-center justify-center">
            <LoaderIcon className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!messagesQuery.isLoading && !threadsQuery.isLoading && isEmpty && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Start a conversation
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask questions, brainstorm ideas, or get help with your project
              </p>
            </div>
          </div>
        )}

        {!messagesQuery.isLoading &&
          messages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            role="listitem"
            tabIndex={message.id === lastMessageId ? 0 : -1}
            aria-label={`${message.role.toLowerCase()} message at ${messageTimestampFormatter.format(
              new Date(message.createdAt)
            )}`}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
          >
            <MessageBubble
              message={message}
              themeStyle={themeStyle}
              hasAccentColor={hasAccentColor}
              onApproveTask={handleApproveTask}
              onApproveAll={handleApproveAll}
              onRegenerate={handleRegenerateClick}
              onSaveArtifact={(content) => handleSaveArtifact(message.id, content)}
              artifactStatus={artifactStatusByMessageId[message.id] ?? "idle"}
              canRegenerate={
                message.role === "ASSISTANT" &&
                message.id === lastAssistantMessageId &&
                !isPending
              }
              modelLabel={
                activeModel?.label
              }
              modelProvider={
                activeModel?.provider ?? null
              }
              messageStatus={message.role === "USER" ? "delivered" : undefined}
              isPending={isPending || tasksPending}
            />
          </div>
        ))}

        {/* Optimistic user message during streaming */}
        {optimisticUserMessage &&
          (isActiveThreadStreaming || optimisticStatus === "failed") && (
            <div className="flex flex-col gap-2 items-end">
              <MessageBubble
                message={{
                  id: "optimistic-user-message",
                  threadId: effectiveThreadId ?? "",
                  role: "USER",
                  content: optimisticUserMessage,
                  taskResolution: null,
                  createdAt: new Date(),
                  modelKey: null,
                  modelLabel: null,
                  modelProvider: null,
                }}
                themeStyle={themeStyle}
                hasAccentColor={hasAccentColor}
                onApproveTask={handleApproveTask}
                onApproveAll={handleApproveAll}
                messageStatus={optimisticStatus ?? "sending"}
                isPending={isPending || tasksPending}
              />
            </div>
          )}

        {/* Streaming AI response (and post-stream optimistic assistant bubble until DB message arrives) */}
        {isActiveThreadStreaming &&
          (isStreaming || (streamingContent && pendingAssistantId)) && (
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground text-xs font-semibold">
              AI
            </div>
            <div className="flex-1 rounded-lg bg-card border border-border px-4 py-3 text-sm shadow-sm">
              {streamingContent ? (
                <div className="relative">
                  <ChatMarkdown content={streamingContent} tone="default" />
                  {/* Pulsing cursor only while actively streaming */}
                  {isStreaming && (
                    <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse rounded-sm" />
                  )}
                  {isStreaming && (
                    <div
                      className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      <LoaderIcon className="h-3 w-3 animate-spin" />
                      AI is typing...
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderIcon className="h-4 w-4 animate-spin" />
                  <span className="text-xs">Thinking...</span>
                </div>
              )}
            </div>
            {/* Stop button (only while actively streaming) */}
            {isStreaming && (
              <button
                onClick={handleStopStreaming}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <StopCircleIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Blocking mutation pending state (fallback) */}
        {sendMessageMutation.isPending && !isStreaming && (
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground text-xs font-semibold">
              AI
            </div>
            <div className="flex-1 rounded-lg bg-muted px-4 py-3">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {/* Stream error message */}
        {streamError && streamingThreadId === effectiveThreadId && (
          <div className="flex justify-center my-2">
            <div className="flex items-center gap-2 rounded-full bg-red-100 dark:bg-red-900/30 px-4 py-1.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircleIcon className="h-3 w-3" />
              {streamError}
            </div>
          </div>
        )}

        {tasksPending && (
          <div className="flex justify-center my-2">
            <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="h-3 w-3 animate-spin" />
              Creating tasks...
            </div>
          </div>
        )}
        </div>

        {/* Input area */}
        <form
          onSubmit={(e) => handleSubmit(e)}
          className={cn(
            "border-t border-border p-4",
            isDrawer ? "bg-card" : "bg-muted/50"
          )}
        >
          <div className="flex items-end gap-2">
            <ModelSelector
              models={modelsQuery.data ?? []}
              value={activeThread?.modelKey ?? null}
              onChange={handleModelChange}
              isLoading={modelsQuery.isLoading}
              isUpdating={setThreadModelMutation.isPending}
              errorMessage={modelErrorMessage}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Shift+Enter for new line, Ctrl/Cmd+Enter to send)"
              aria-label="Message input"
              disabled={isPending || !effectiveThreadId}
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                hasAccentColor
                  ? "focus:ring-[rgb(var(--project-accent))]"
                  : "focus:ring-primary"
              )}
              style={hasAccentColor ? themeStyle : undefined}
            />
            <button
              type="submit"
              disabled={!input.trim() || isPending || !effectiveThreadId}
              className={cn(
                "flex h-[48px] w-[48px] items-center justify-center rounded-lg font-medium text-sm",
                "transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                hasAccentColor
                  ? "bg-[rgb(var(--project-accent))] text-white hover:opacity-90 focus:ring-[rgb(var(--project-accent))]"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary"
              )}
              style={hasAccentColor ? themeStyle : undefined}
              aria-label="Send message"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
