"use client";

import { LoaderIcon, SparklesIcon, StopCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "./chat-markdown";

type Props = {
  isStreaming: boolean;
  streamingContent: string;
  pendingAssistantId: string | null;
  onStopStreaming: () => void;
};

export function StreamingMessage({
  isStreaming,
  streamingContent,
  pendingAssistantId,
  onStopStreaming,
}: Props) {
  // Only show if we are actively streaming OR we have streaming content but are still waiting for the DB message
  if (!isStreaming && (!streamingContent || !pendingAssistantId)) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-2 w-full animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="flex items-start gap-3 max-w-[85%]">
        {/* AI Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <SparklesIcon className="h-4 w-4" />
        </div>

        {/* Message Content */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              Assistant
            </span>
            {isStreaming && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <LoaderIcon className="h-3 w-3 animate-spin" />
                drafting…
              </span>
            )}
          </div>
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm bg-muted">
            {streamingContent ? (
              <div className="relative">
                <ChatMarkdown content={streamingContent} tone="default" />
                {/* Pulsing cursor only while actively streaming */}
                {isStreaming && (
                  <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse rounded-sm align-middle" />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
                <LoaderIcon className="h-4 w-4 animate-spin" />
                <span className="text-xs">Drafting…</span>
              </div>
            )}
          </div>
        </div>

        {/* Stop button (only while actively streaming) */}
        {isStreaming && (
          <Button
            onClick={onStopStreaming}
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive text-muted-foreground focus:ring-destructive/20"
            title="Stop"
            aria-label="Stop"
          >
            <StopCircleIcon className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
