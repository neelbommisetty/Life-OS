"use client";

import { useRef, useEffect } from "react";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSelector, type ModelOption } from "../model-selector";
import type { CSSProperties } from "react";

type Props = {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e?: React.SyntheticEvent, contentOverride?: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isPending: boolean;
  effectiveThreadId: string | null;
  hasAccentColor: boolean;
  themeStyle: CSSProperties;
  models: ModelOption[];
  activeModelKey: string | null;
  onModelChange: (modelKey: string | null) => void;
  modelsLoading: boolean;
  modelUpdating: boolean;
  modelErrorMessage?: string;
  isDrawer?: boolean;
};

export function ChatInput({
  input,
  setInput,
  onSubmit,
  onKeyDown,
  isPending,
  effectiveThreadId,
  hasAccentColor,
  themeStyle,
  models,
  activeModelKey,
  onModelChange,
  modelsLoading,
  modelUpdating,
  modelErrorMessage,
  isDrawer
}: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize handler
  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    if (inputRef.current) {
      adjustHeight(inputRef.current);
    }
  }, [input]);

  return (
    <form
      onSubmit={(e) => onSubmit(e)}
      className={cn(
        "border-t border-border p-4 transition-colors",
        isDrawer ? "bg-card" : "bg-muted/20"
      )}
    >
      <div className="flex items-end gap-3 max-w-4xl mx-auto">
        <ModelSelector
          models={models}
          value={activeModelKey}
          onChange={onModelChange}
          isLoading={modelsLoading}
          isUpdating={modelUpdating}
          errorMessage={modelErrorMessage}
          buttonClassName="h-12 w-12 shadow-none border-border/60 bg-background/50 backdrop-blur-sm hover:bg-background transition-colors"
        />

        <div className="relative flex-1 group">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustHeight(e.target);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type your message..."
            aria-label="Message input"
            disabled={isPending || !effectiveThreadId}
            rows={1}
            className={cn(
              "w-full resize-none rounded-xl border border-border bg-background/50 backdrop-blur-sm px-4 py-3.5 text-sm transition-all",
              "focus:outline-none focus:ring-2 focus:ring-offset-0",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "min-h-[48px] max-h-[200px] pr-12",
              hasAccentColor
                ? "focus:border-[rgb(var(--project-accent))] focus:ring-[rgb(var(--project-accent))/0.3]"
                : "focus:border-primary focus:ring-primary/30"
            )}
            style={hasAccentColor ? { ...themeStyle } : undefined}
          />

          <button
            type="submit"
            disabled={!input.trim() || isPending || !effectiveThreadId}
            className={cn(
              "absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-lg font-medium text-sm transition-all",
              "focus:outline-none focus:ring-2",
              "disabled:cursor-not-allowed disabled:opacity-30",
              hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-[rgb(var(--project-accent-foreground))] hover:opacity-90 focus:ring-[rgb(var(--project-accent))/0.3]"
                : "bg-primary text-primary-foreground hover:bg-primary/90 focus:ring-primary/30"
            )}
            style={hasAccentColor ? themeStyle : undefined}
            aria-label="Send message"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 text-center">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-50">
          Press <kbd className="font-sans">Enter</kbd> to send • <kbd className="font-sans">Shift + Enter</kbd> for new line
        </p>
      </div>
    </form>
  );
}
