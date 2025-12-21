"use client";

import { useState, useRef, useMemo } from "react";
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
import { ModelSelector } from "./model-selector";
import { ChatMarkdown } from "./chat-markdown";
import { useChatStreaming } from "./hooks/use-chat-streaming";
import { useChatTasks } from "./hooks/use-chat-tasks";
import { useChatScroll } from "./hooks/use-chat-scroll";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectChat({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasAccentColor = !!accentColor && Object.keys(themeStyle).length > 0;
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageSize = 30;

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

  // Send message mutation
  const sendMessageMutation = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      setInput("");
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
    return pages
      .slice()
      .reverse()
      .flatMap((page) => page.messages);
  }, [messagesQuery.data]);

  // Custom hooks
  const {
    isStreaming,
    streamingContent,
    optimisticUserMessage,
    pendingAssistantId,
    streamError,
    handleStreamingSubmit,
    handleStopStreaming,
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
    pageSize,
  });

  const { messagesContainerRef, handleScroll } = useChatScroll({
    messagesLength: messages.length,
    isLoading: messagesQuery.isLoading,
    isFetchingNextPage: messagesQuery.isFetchingNextPage,
    hasNextPage: messagesQuery.hasNextPage ?? false,
    fetchNextPage: messagesQuery.fetchNextPage,
    isPending: sendMessageMutation.isPending || isStreaming,
    streamingContent,
  });

  const isPending = sendMessageMutation.isPending || isStreaming;

  const handleSubmit = async (
    e?: React.SyntheticEvent,
    contentOverride?: string
  ) => {
    e?.preventDefault();
    const content = contentOverride || input.trim();
    if (!content || isPending) return;

    // Use streaming by default
    handleStreamingSubmit(content);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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
            isPending={isPending || tasksPending}
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
