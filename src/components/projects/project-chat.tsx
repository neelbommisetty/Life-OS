"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "@/trpc/client";
import { SendIcon, LoaderIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@prisma/client";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectChat({ projectId, accentColor }: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch thread and messages
  const { data: thread, isLoading } = api.chat.getThread.useQuery({
    projectId,
  });

  // Send message mutation
  const sendMessageMutation = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      setInput("");
      // Refetch the thread to get updated messages
      utils.chat.getThread.invalidate({ projectId });
    },
  });

  const utils = api.useUtils();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMessageMutation.isPending) return;

    sendMessageMutation.mutate({
      projectId,
      content: input.trim(),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card p-12 shadow-sm">
        <LoaderIcon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const messages = thread?.messages || [];
  const isEmpty = messages.length === 0;
  const isPending = sendMessageMutation.isPending;

  return (
    <div className="flex h-[600px] flex-col rounded-xl border border-border bg-card shadow-sm">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-border bg-muted/50 p-4"
      >
        <div className="flex gap-2">
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
}: {
  message: ChatMessage;
  accentColor?: string | null;
}) {
  const isUser = message.role === "USER";
  const isAssistant = message.role === "ASSISTANT";

  if (!isUser && !isAssistant) {
    return null; // Skip system messages in UI
  }

  return (
    <div className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
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
          "flex-1 rounded-lg px-4 py-3 text-sm",
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
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}

