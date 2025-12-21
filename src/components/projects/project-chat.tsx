"use client";

import { useState, useRef, useMemo, useLayoutEffect } from "react";
import { api } from "@/trpc/client";
import { SendIcon, LoaderIcon, CheckCircle2Icon, CalendarIcon, AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@prisma/client";
import { extractTasksFromMessage } from "@/lib/chat-utils";
import { PriorityBadge } from "./priority-badge";
import { ModelSelector } from "./model-selector";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectChat({ projectId, accentColor }: Props) {
  const [input, setInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const previousScrollHeightRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
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
  const isPending = sendMessageMutation.isPending;

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
  }, [messages.length, messagesQuery.isLoading, messagesQuery.isFetchingNextPage, isPending]);

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

  const handleSubmit = async (e: React.FormEvent, contentOverride?: string) => {
    e?.preventDefault();
    const content = contentOverride || input.trim();
    if (!content || sendMessageMutation.isPending) return;

    shouldAutoScrollRef.current = true;
    sendMessageMutation.mutate({
      projectId,
      content,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const handleApproveTask = (task: any) => {
    createTaskMutation.mutate({
      projectId,
      title: task.title,
      description: task.description,
      status: task.status ?? "BACKLOG",
      priority: task.priority ?? "MEDIUM",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : undefined,
    });
  };

  const handleApproveAll = (tasks: any[]) => {
    if (!tasks || tasks.length === 0) return;
    createManyTasksMutation.mutate({
      projectId,
      tasks: tasks.map((t: any) => ({
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
            accentColor={accentColor}
            onApproveTask={handleApproveTask}
            onApproveAll={handleApproveAll}
            isPending={isPending || createTaskMutation.isPending || createManyTasksMutation.isPending}
          />
        ))}

        {isPending && (
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              AI
            </div>
            <div className="flex-1 rounded-lg bg-muted px-4 py-3">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
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
              accentColor
                ? "focus:ring-[rgb(var(--project-accent))]"
                : "focus:ring-primary"
            )}
            style={
              accentColor
                ? ({ "--project-accent": accentColor } as React.CSSProperties)
                : undefined
            }
          />
          <button
            type="submit"
            disabled={!input.trim() || isPending}
            className={cn(
              "flex h-[48px] w-[48px] items-center justify-center rounded-lg font-medium text-sm",
              "transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              accentColor
                ? "bg-[rgb(var(--project-accent))] text-white hover:opacity-90 focus:ring-[rgb(var(--project-accent))]"
                : "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary"
            )}
            style={
              accentColor
                ? ({ "--project-accent": accentColor } as React.CSSProperties)
                : undefined
            }
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
  accentColor,
  onApproveTask,
  onApproveAll,
  isPending,
}: {
  message: ChatMessage;
  accentColor?: string | null;
  onApproveTask: (task: any) => void;
  onApproveAll: (tasks: any[]) => void;
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
              ? accentColor
                ? "bg-[rgb(var(--project-accent))] text-white"
                : "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
          style={
            isUser && accentColor
              ? ({ "--project-accent": accentColor } as React.CSSProperties)
              : undefined
          }
        >
          {isUser ? "You" : "AI"}
        </div>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm shadow-sm",
            isUser
              ? accentColor
                ? "bg-[rgb(var(--project-accent))] text-white"
                : "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
          style={
            isUser && accentColor
              ? ({ "--project-accent": accentColor } as React.CSSProperties)
              : undefined
          }
        >
          <p className="whitespace-pre-wrap break-words">{displayContent}</p>
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
              {proposedTasks.map((task: any, i: number) => (
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
