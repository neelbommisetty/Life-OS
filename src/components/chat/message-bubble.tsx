"use client";

import { useMemo } from "react";
import type { ChatMessage } from "@prisma/client";
import { RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "./chat-markdown";

type MessageBubbleProps = {
  message: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  canRegenerate?: boolean;
  modelLabel?: string;
  modelProvider?: string | null;
  messageStatus?: "sending" | "delivered" | "failed";
  isPending: boolean;
};

export function MessageBubble({
  message,
  onRegenerate,
  canRegenerate,
  modelLabel,
  modelProvider,
  messageStatus,
  isPending,
}: MessageBubbleProps) {
  const isUser = message.role === "USER";
  const isAssistant = message.role === "ASSISTANT";
  const isSystem = message.role === "SYSTEM";

  const effectiveModelLabel = message.modelLabel ?? modelLabel ?? null;
  const effectiveModelProvider = message.modelProvider ?? modelProvider ?? null;

  const modelLabelText = useMemo(() => {
    // If no label is set, it's autorouting
    if (!effectiveModelLabel) return "Auto routing";
    if (!effectiveModelProvider) return effectiveModelLabel;
    const providerName =
      effectiveModelProvider === "openai"
        ? "OpenAI"
        : effectiveModelProvider === "anthropic"
        ? "Anthropic"
        : effectiveModelProvider === "google"
        ? "Google"
        : effectiveModelProvider === "xai"
        ? "xAI"
        : effectiveModelProvider;
    return `${effectiveModelLabel} (${providerName})`;
  }, [effectiveModelLabel, effectiveModelProvider]);

  const statusLabel = useMemo(() => {
    if (!messageStatus) return null;
    if (messageStatus === "sending") return "Sending...";
    if (messageStatus === "failed") return "Failed";
    return "Delivered";
  }, [messageStatus]);

  const timestampLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(message.createdAt);
  }, [message.createdAt]);

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
    <div
      className={cn(
        "flex flex-col gap-2",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 max-w-[85%]",
          isUser && "flex-row-reverse"
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {isUser ? "You" : "AI"}
        </div>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm shadow-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
        >
          <ChatMarkdown
            content={message.content}
            tone={isUser ? "inverted" : "default"}
          />
        </div>
      </div>

      {statusLabel && (
        <div
          className={cn(
            "text-[11px]",
            messageStatus === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
            isUser ? "mr-11 text-right" : "ml-11 text-left"
          )}
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </div>
      )}

      {isAssistant && (
        <div className="ml-11 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground/80">Model</span>
            <span>{modelLabelText}</span>
          </span>
          <span className="text-muted-foreground/60">•</span>
          <span title={timestampLabel}>{timestampLabel}</span>
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              disabled={!canRegenerate || isPending}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground/80 transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              title="Regenerate response"
            >
              <RotateCcwIcon className="h-3 w-3" />
              Regenerate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
