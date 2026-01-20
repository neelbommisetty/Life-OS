"use client";

import { LoaderIcon, StopCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground text-xs font-semibold shadow-sm">
        AI
      </div>
      <Card className="flex-1 rounded-lg shadow-sm transition-all">
        <CardContent className="px-4 py-3 text-sm">
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
        </CardContent>
      </Card>

      {/* Stop button (only while actively streaming) */}
      {isStreaming && (
        <Button
          onClick={onStopStreaming}
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive text-muted-foreground focus:ring-destructive/20"
          title="Stop generating"
          aria-label="Stop generating"
        >
          <StopCircleIcon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
