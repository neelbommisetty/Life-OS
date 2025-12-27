"use client";

import { useRef, useEffect } from "react";
import { LoaderIcon, AlertCircleIcon } from "lucide-react";
import { MessageBubble } from "../message-bubble";
import { ChatEmptyState } from "./chat-empty-state";
import { StreamingMessage } from "./streaming-message";
import type { CSSProperties, RefObject } from "react";
import type { ChatMessage } from "@prisma/client";
import type { ModelOption } from "../model-selector";
import type { ProposedTask } from "@/lib/chat-utils";
import { formatDateTime } from "@/lib/project-utils";

type Props = {
  messages: any[]; // Using any[] to match the complex infinite query return type for now
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasAccentColor: boolean;
  themeStyle: CSSProperties;
  effectiveThreadId: string | null;
  lastMessageId: string | null;
  lastAssistantMessageId: string | null;
  activeModel?: ModelOption;
  optimisticUserMessage: string | null;
  optimisticStatus: "sending" | "delivered" | "failed" | null;
  isActiveThreadStreaming: boolean;
  isStreaming: boolean;
  streamingContent: string;
  pendingAssistantId: string | null;
  streamError: string | null;
  tasksPending: boolean;
  isPending: boolean;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onApproveTask: (messageId: string, task: ProposedTask) => void;
  onApproveAll: (messageId: string, tasks: ProposedTask[]) => void;
  onRegenerate: (messageId: string) => void;
  onSaveArtifact: (messageId: string, content: string) => void;
  onStopStreaming: () => void;
  onSelectPrompt: (prompt: string) => void;
  artifactStatusByMessageId: Record<string, "saving" | "saved" | "error">;
};

export function ChatMessages({
  messages,
  isLoading,
  isFetchingNextPage,
  hasAccentColor,
  themeStyle,
  effectiveThreadId,
  lastMessageId,
  lastAssistantMessageId,
  activeModel,
  optimisticUserMessage,
  optimisticStatus,
  isActiveThreadStreaming,
  isStreaming,
  streamingContent,
  pendingAssistantId,
  streamError,
  tasksPending,
  isPending,
  messagesContainerRef,
  onScroll,
  onKeyDown,
  onApproveTask,
  onApproveAll,
  onRegenerate,
  onSaveArtifact,
  onStopStreaming,
  onSelectPrompt,
  artifactStatusByMessageId,
}: Props) {


  const isEmpty = messages.length === 0;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderIcon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEmpty && !optimisticUserMessage && !isActiveThreadStreaming) {
    return (
      <ChatEmptyState
        onSelectPrompt={onSelectPrompt}
        themeStyle={themeStyle}
        hasAccentColor={hasAccentColor}
      />
    );
  }

  return (
    <div
      ref={messagesContainerRef}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4"
      role="list"
      aria-label="Chat messages"
      aria-live="polite"
      tabIndex={0}
    >
      {isFetchingNextPage && (
        <div className="flex justify-center">
          <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
            <LoaderIcon className="h-3 w-3 animate-spin" />
            Loading older messages...
          </div>
        </div>
      )}

      {messages.map((message) => (
        <div
          key={message.id}
          data-message-id={message.id}
          role="listitem"
          tabIndex={message.id === lastMessageId ? 0 : -1}
          aria-label={`${message.role.toLowerCase()} message at ${formatDateTime(
            message.createdAt
          )}`}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
        >
          <MessageBubble
            message={message}
            themeStyle={themeStyle}
            hasAccentColor={hasAccentColor}
            onApproveTask={onApproveTask}
            onApproveAll={onApproveAll}
            onRegenerate={onRegenerate}
            onSaveArtifact={(content) => onSaveArtifact(message.id, content)}
            artifactStatus={artifactStatusByMessageId[message.id] ?? "idle"}
            canRegenerate={
              message.role === "ASSISTANT" &&
              message.id === lastAssistantMessageId &&
              !isPending
            }
            modelLabel={activeModel?.label}
            modelProvider={activeModel?.provider}
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
              onApproveTask={onApproveTask}
              onApproveAll={onApproveAll}
              messageStatus={optimisticStatus ?? "sending"}
              isPending={isPending || tasksPending}
            />
          </div>
        )}

      {/* Streaming AI response */}
      {isActiveThreadStreaming && (
        <StreamingMessage
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          pendingAssistantId={pendingAssistantId}
          onStopStreaming={onStopStreaming}
        />
      )}

      {/* Blocking mutation pending state (fallback) */}
      {isPending && !isActiveThreadStreaming && (
        <div className="flex items-start gap-3 animate-in fade-in duration-300">
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
        <div className="flex justify-center my-2 animate-in zoom-in-95 duration-300">
          <div className="flex items-center gap-2 rounded-full bg-destructive/10 text-destructive px-4 py-1.5 text-xs border border-destructive/20 shadow-sm">
            <AlertCircleIcon className="h-3 w-3" />
            {streamError}
          </div>
        </div>
      )}

      {tasksPending && (
        <div className="flex justify-center my-2">
          <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground animate-pulse">
            <LoaderIcon className="h-3 w-3 animate-spin" />
            Creating tasks...
          </div>
        </div>
      )}
    </div>
  );
}
