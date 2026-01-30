"use client";

import { useMemo } from "react";
import type { ChatMessage } from "@prisma/client";
import { RotateCcwIcon, SparklesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    const now = new Date();
    const messageDate = new Date(message.createdAt);
    
    // Check if message is from today
    const isToday =
      now.getDate() === messageDate.getDate() &&
      now.getMonth() === messageDate.getMonth() &&
      now.getFullYear() === messageDate.getFullYear();
    
    // Check if message is from yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      yesterday.getDate() === messageDate.getDate() &&
      yesterday.getMonth() === messageDate.getMonth() &&
      yesterday.getFullYear() === messageDate.getFullYear();
    
    const timeString = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(messageDate);
    
    if (isToday) {
      return timeString;
    } else if (isYesterday) {
      return `Yesterday at ${timeString}`;
    } else {
      // Show full date for older messages
      const dateString = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: now.getFullYear() !== messageDate.getFullYear() ? "numeric" : undefined,
      }).format(messageDate);
      return `${dateString} at ${timeString}`;
    }
  }, [message.createdAt]);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <Badge variant="secondary" className="text-xs px-3 py-1 rounded-full">
          {message.content}
        </Badge>
      </div>
    );
  }

  // User message - right-aligned blue bubble
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1 w-full">
        <div className="flex justify-end max-w-[85%]">
          <div className="rounded-2xl px-4 py-3 text-sm bg-primary text-primary-foreground">
            <ChatMarkdown content={message.content} tone="inverted" />
          </div>
        </div>
        {statusLabel && (
          <div
            className={cn(
              "text-[11px] px-2",
              messageStatus === "failed"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
            role="status"
            aria-live="polite"
          >
            {statusLabel}
          </div>
        )}
      </div>
    );
  }

  // AI message - left-aligned with avatar
  return (
    <div className="flex flex-col items-start gap-2 w-full">
      <div className="flex items-start gap-3 max-w-[85%]">
        {/* AI Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <SparklesIcon className="h-4 w-4" />
        </div>

        {/* Message Content */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              Life-OS AI
            </span>
            <span className="text-[11px] text-muted-foreground">
              {timestampLabel}
            </span>
          </div>
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm bg-muted">
            <ChatMarkdown content={message.content} tone="default" />
          </div>
        </div>
      </div>

      {/* AI Message Metadata */}
      <div className="ml-11 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
          {modelLabelText}
        </Badge>
        {onRegenerate && (
          <Button
            type="button"
            onClick={() => onRegenerate(message.id)}
            disabled={!canRegenerate || isPending}
            variant="ghost"
            size="xs"
            className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium"
            title="Regenerate response"
          >
            <RotateCcwIcon className="h-3 w-3" />
            Regenerate
          </Button>
        )}
      </div>
    </div>
  );
}
