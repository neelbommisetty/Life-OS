"use client";

import { useState, useRef, useMemo, useLayoutEffect, useCallback, useEffect } from "react";
import type { CSSProperties } from "react";
import { api } from "@/trpc/client";
import { SendIcon, LoaderIcon, CheckCircle2Icon, CalendarIcon, AlertCircleIcon, StopCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProjectTheme } from "@/lib/project-theme";
import type { ChatMessage } from "@prisma/client";
import type { ProposedTask } from "@/lib/chat-utils";
import { extractTasksFromMessage, parseSSEChunk, handleStreamError } from "@/lib/chat-utils";
import { PriorityBadge } from "./priority-badge";
import { ModelSelector } from "./model-selector";
import { ChatMarkdown } from "./chat-markdown";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectChat({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasAccentColor = !!accentColor && Object.keys(themeStyle).length > 0;
  const [input, setInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const previousScrollHeightRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const pageSize = 30;

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<string | null>(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const didInvalidateAfterStreamRef = useRef(false);

  // Fetch thread and messages
  const threadQuery = api.chat.getThread.useQuery({
    projectId,
  });

  const messagesQuery = api.chat.listMessages.useInfiniteQuery(
    { projectId, limit: pageSize },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }
  );

  const modelsQuery = api.chat.listModels.useQuery();

  const utils = api.useUtils();
  const thread = threadQuery.data;

  // Task creation mutation for direct approval
  const createTaskMutation = api.task.create.useMutation({
    onSuccess: () => {
      // Invalidate project tasks to update board
      utils.task.list.invalidate({ projectId });
    },
  });

  const createManyTasksMutation = api.task.createMany.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate({ projectId });
    },
  });

  // Send message mutation
  const sendMessageMutation = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      setInput("");
      // Refetch messages to get updated list
      utils.chat.listMessages.invalidate({ projectId, limit: pageSize });
      utils.chat.getThread.invalidate({ projectId });
    },
  });

  const setThreadModelMutation = api.chat.setThreadModel.useMutation({
    onSuccess: (updatedThread) => {
      utils.chat.getThread.setData({ projectId }, updatedThread);
    },
  });

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    return pages.slice().reverse().flatMap((page) => page.messages);
  }, [messagesQuery.data]);
  const isPending = sendMessageMutation.isPending || isStreaming;

  // Clear optimistic/streaming UI once we observe the saved assistant message in the query data.
  useEffect(() => {
    if (!pendingAssistantId) return;
    const found = messages.some((m) => m.id === pendingAssistantId);
    if (!found) return;

    setPendingAssistantId(null);
    setStreamingContent("");
    setOptimisticUserMessage(null);
    setStreamError(null);
    didInvalidateAfterStreamRef.current = false;
  }, [messages, pendingAssistantId]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;

    if (
      container.scrollTop < 80 &&
      messagesQuery.hasNextPage &&
      !messagesQuery.isFetchingNextPage
    ) {
      previousScrollHeightRef.current = container.scrollHeight;
      previousScrollTopRef.current = container.scrollTop;
      messagesQuery.fetchNextPage();
    }
  };

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!hasAutoScrolledRef.current && !messagesQuery.isLoading) {
      container.scrollTop = container.scrollHeight;
      hasAutoScrolledRef.current = true;
      return;
    }

    if (shouldAutoScrollRef.current && !messagesQuery.isFetchingNextPage) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, messagesQuery.isLoading, messagesQuery.isFetchingNextPage, isPending, streamingContent]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (previousScrollHeightRef.current === null) return;
    if (messagesQuery.isFetchingNextPage) return;

    const previousScrollHeight = previousScrollHeightRef.current;
    const previousScrollTop = previousScrollTopRef.current;
    container.scrollTop =
      container.scrollHeight - previousScrollHeight + previousScrollTop;
    previousScrollHeightRef.current = null;
  }, [messages.length, messagesQuery.isFetchingNextPage]);

  // Stop streaming
  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Streaming submit handler
  const handleStreamingSubmit = useCallback(async (content: string) => {
    setIsStreaming(true);
    setStreamingContent("");
    setOptimisticUserMessage(content);
    setPendingAssistantId(null);
    setStreamError(null);
    setInput("");
    didInvalidateAfterStreamRef.current = false;

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, content }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process only complete SSE events (delimited by blank line).
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const events = parseSSEChunk(part);

          for (const event of events) {
            if (event.type === "chunk" && event.text) {
              setStreamingContent((prev) => prev + event.text);
            } else if (event.type === "error") {
              setStreamError(event.error || "Stream error occurred");
            } else if (event.type === "message_saved" && event.messageId) {
              // Mark stream as finished, but keep the streamed bubble visible until the DB-backed message arrives.
              setIsStreaming(false);
              setPendingAssistantId(event.messageId);

              if (!didInvalidateAfterStreamRef.current) {
                didInvalidateAfterStreamRef.current = true;
                utils.chat.listMessages.invalidate({ projectId, limit: pageSize });
                utils.chat.getThread.invalidate({ projectId });
              }
            } else if (event.type === "done") {
              // Server finished sending. If we haven't invalidated yet, do it once now.
              setIsStreaming(false);
              if (!didInvalidateAfterStreamRef.current) {
                didInvalidateAfterStreamRef.current = true;
                utils.chat.listMessages.invalidate({ projectId, limit: pageSize });
                utils.chat.getThread.invalidate({ projectId });
              }
            }
          }
        }
      }

      // Stream ended. Keep the optimistic bubbles until the saved message shows up.
      setIsStreaming(false);
      abortControllerRef.current = null;
    } catch (error) {
      // Handle abort gracefully
      if (error instanceof Error && error.name === "AbortError") {
        // User cancelled - keep whatever we've rendered, and refresh in background.
        setIsStreaming(false);
        if (!didInvalidateAfterStreamRef.current) {
          didInvalidateAfterStreamRef.current = true;
          utils.chat.listMessages.invalidate({ projectId, limit: pageSize });
          utils.chat.getThread.invalidate({ projectId });
        }
      } else {
        // On error, fall back to blocking mutation
        const errorMessage = handleStreamError(error);
        setStreamError(errorMessage);

        // Fallback to blocking mutation
        console.warn("Streaming failed, falling back to blocking mutation:", error);
        sendMessageMutation.mutate({
          projectId,
          content,
        });
      }

      setIsStreaming(false);
      setStreamingContent("");
      setOptimisticUserMessage(null);
      setPendingAssistantId(null);
      abortControllerRef.current = null;
    }
  }, [projectId, utils.chat.listMessages, utils.chat.getThread, sendMessageMutation, pageSize]);

  const handleSubmit = async (
    e?: React.SyntheticEvent,
    contentOverride?: string
  ) => {
    e?.preventDefault();
    const content = contentOverride || input.trim();
    if (!content || isPending) return;

    shouldAutoScrollRef.current = true;

    // Use streaming by default
    handleStreamingSubmit(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleApproveTask = (task: ProposedTask) => {
    createTaskMutation.mutate({
      projectId,
      title: task.title,
      description: task.description,
      status: task.status ?? "BACKLOG",
      priority: task.priority ?? "MEDIUM",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
    });
  };

  const handleApproveAll = (tasks: ProposedTask[]) => {
    if (!tasks || tasks.length === 0) return;
    createManyTasksMutation.mutate({
      projectId,
      tasks: tasks.map((t) => ({
        ...t,
        status: t.status ?? "BACKLOG",
        priority: t.priority ?? "MEDIUM",
        dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : undefined,
      })),
    });
  };

  if (threadQuery.isLoading || messagesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12 shadow-sm">
        <LoaderIcon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isEmpty = messages.length === 0;
  const modelErrorMessage =
    setThreadModelMutation.error?.message ?? modelsQuery.error?.message;

  const handleModelChange = (modelKey: string | null) => {
    if (thread?.modelKey === modelKey || setThreadModelMutation.isPending) {
      return;
    }
    setThreadModelMutation.mutate({
      projectId,
      modelKey,
    });
  };

  return (
    <div className="flex h-[600px] flex-col rounded-xl border border-border bg-card shadow-sm">
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messagesQuery.isFetchingNextPage && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="h-3 w-3 animate-spin" />
              Loading older messages...
            </div>
          </div>
        )}

        {isEmpty && (
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

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            themeStyle={themeStyle}
            hasAccentColor={hasAccentColor}
            onApproveTask={handleApproveTask}
            onApproveAll={handleApproveAll}
            isPending={isPending || createTaskMutation.isPending || createManyTasksMutation.isPending}
          />
        ))}

        {/* Optimistic user message during streaming */}
        {optimisticUserMessage && (
          <div className="flex flex-col gap-2 items-end">
            <div className="flex items-start gap-3 max-w-[85%] flex-row-reverse">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  hasAccentColor
                    ? "bg-[rgb(var(--project-accent))] text-white"
                    : "bg-primary text-primary-foreground"
                )}
                style={hasAccentColor ? themeStyle : undefined}
              >
                You
              </div>
              <div
                className={cn(
                  "rounded-lg px-4 py-3 text-sm shadow-sm",
                  hasAccentColor
                    ? "bg-[rgb(var(--project-accent))] text-white"
                    : "bg-primary text-primary-foreground"
                )}
                style={hasAccentColor ? themeStyle : undefined}
              >
                <ChatMarkdown content={optimisticUserMessage} tone="inverted" />
              </div>
            </div>
          </div>
        )}

        {/* Streaming AI response (and post-stream optimistic assistant bubble until DB message arrives) */}
        {(isStreaming || (streamingContent && pendingAssistantId)) && (
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
        {streamError && (
          <div className="flex justify-center my-2">
            <div className="flex items-center gap-2 rounded-full bg-red-100 dark:bg-red-900/30 px-4 py-1.5 text-xs text-red-700 dark:text-red-300">
              <AlertCircleIcon className="h-3 w-3" />
              {streamError}
            </div>
          </div>
        )}

        {(createTaskMutation.isPending || createManyTasksMutation.isPending) && (
          <div className="flex justify-center my-2">
            <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="h-3 w-3 animate-spin" />
              Creating tasks...
            </div>
          </div>
        )}

        {(createTaskMutation.isSuccess || createManyTasksMutation.isSuccess) && (
           <div className="flex justify-center my-2">
            <div className="flex items-center gap-2 rounded-full bg-green-100 dark:bg-green-900/30 px-4 py-1.5 text-xs text-green-700 dark:text-green-300">
              <CheckCircle2Icon className="h-3 w-3" />
              Tasks created successfully
            </div>
          </div>
        )}

      </div>

      {/* Input area */}
      <form
        onSubmit={(e) => handleSubmit(e)}
        className="border-t border-border bg-muted/50 p-4"
      >
        <div className="flex items-end gap-2">
          <ModelSelector
            models={modelsQuery.data ?? []}
            value={threadQuery.data?.modelKey ?? null}
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
            placeholder="Type your message... (Shift+Enter for new line)"
            disabled={isPending}
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
            disabled={!input.trim() || isPending}
            className={cn(
              "flex h-[48px] w-[48px] items-center justify-center rounded-lg font-medium text-sm",
              "transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-white hover:opacity-90 focus:ring-[rgb(var(--project-accent))]"
                : "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary"
            )}
            style={hasAccentColor ? themeStyle : undefined}
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  themeStyle,
  hasAccentColor,
  onApproveTask,
  onApproveAll,
  isPending,
}: {
  message: ChatMessage;
  themeStyle: CSSProperties;
  hasAccentColor: boolean;
  onApproveTask: (task: ProposedTask) => void;
  onApproveAll: (tasks: ProposedTask[]) => void;
  isPending: boolean;
}) {
  const isUser = message.role === "USER";
  const isAssistant = message.role === "ASSISTANT";
  const isSystem = message.role === "SYSTEM";

  // Parse tasks if assistant message
  const proposedTasks = useMemo(() => {
    if (!isAssistant) return null;
    return extractTasksFromMessage(message.content);
  }, [message.content, isAssistant]);

  // Clean content by removing JSON block for display
  const displayContent = useMemo(() => {
    if (!isAssistant) return message.content;
    return message.content.replace(/```json[\s\S]*?```/, "").trim();
  }, [message.content, isAssistant]);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs bg-muted text-muted-foreground px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <div className={cn("flex items-start gap-3 max-w-[85%]", isUser && "flex-row-reverse")}>
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            isUser
              ? hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-white"
                : "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
          style={isUser && hasAccentColor ? themeStyle : undefined}
        >
          {isUser ? "You" : "AI"}
        </div>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm shadow-sm",
            isUser
              ? hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-white"
                : "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
          style={isUser && hasAccentColor ? themeStyle : undefined}
        >
          <ChatMarkdown content={displayContent} tone={isUser ? "inverted" : "default"} />
        </div>
      </div>

      {/* Task Proposals */}
      {proposedTasks && proposedTasks.length > 0 && (
        <div className="ml-11 max-w-[85%] w-full sm:w-96 space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertCircleIcon className="h-4 w-4 text-primary" />
                Proposed Tasks ({proposedTasks.length})
              </h4>
              {proposedTasks.length > 1 && (
                <button
                  onClick={() => onApproveAll(proposedTasks)}
                  disabled={isPending}
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                >
                  Approve All
                </button>
              )}
            </div>

            <div className="space-y-2">
              {proposedTasks.map((task: ProposedTask, i: number) => (
                <div
                  key={i}
                  className="group relative rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground break-words">
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground break-words line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <PriorityBadge priority={task.priority} />
                        {task.status && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                            {task.status}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <CalendarIcon className="h-3 w-3" />
                            {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => onApproveTask(task)}
                      disabled={isPending}
                      className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                      title="Create this task"
                    >
                      Create task
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => onApproveAll(proposedTasks)}
              disabled={isPending}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <CheckCircle2Icon className="h-4 w-4" />
              Approve & Create Tasks
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
