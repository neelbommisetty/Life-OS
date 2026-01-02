"use client";

import { LoaderIcon, StopCircleIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { ChatMarkdown } from "../chat-markdown";
import { useState } from "react";

type Props = {
  isStreaming: boolean;
  streamingContent: string;
  streamingReasoning: string;
  pendingAssistantId: string | null;
  onStopStreaming: () => void;
};

export function StreamingMessage({
  isStreaming,
  streamingContent,
  streamingReasoning,
  pendingAssistantId,
  onStopStreaming,
}: Props) {
  const [showReasoning, setShowReasoning] = useState(false);
  // Only show if we are actively streaming OR we have streaming content but are still waiting for the DB message (pendingAssistantId)
  if (!isStreaming && (!streamingContent || !pendingAssistantId)) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground text-xs font-semibold shadow-sm">
        AI
      </div>
      <div className="flex-1 rounded-lg bg-card border border-border px-4 py-3 text-sm shadow-sm transition-all">
        {streamingContent ? (
          <div className="relative">
            <ChatMarkdown content={streamingContent} tone="default" />
            {/* Pulsing cursor only while actively streaming */}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-primary/70 animate-pulse rounded-sm align-middle" />
            )}
            {isStreaming && (
              <div
                className="mt-3 flex items-center gap-2 text-xs text-muted-foreground transition-opacity"
                role="status"
                aria-live="polite"
              >
                <LoaderIcon className="h-3 w-3 animate-spin" />
                AI is typing...
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
            <LoaderIcon className="h-4 w-4 animate-spin" />
            <span className="text-xs">Thinking...</span>
          </div>
        )}

        {streamingReasoning && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => setShowReasoning((prev) => !prev)}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 hover:text-foreground"
            >
              {showReasoning ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
              Reasoning
            </button>
            {showReasoning && (
              <div className="mt-2 whitespace-pre-wrap text-[11px] text-foreground/80">
                {streamingReasoning}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stop button (only while actively streaming) */}
      {isStreaming && (
        <button
          onClick={onStopStreaming}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all focus:outline-none focus:ring-2 focus:ring-destructive/20"
          title="Stop generating"
          aria-label="Stop generating"
        >
          <StopCircleIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
