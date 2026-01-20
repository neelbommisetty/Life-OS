"use client";

import { useRef, useEffect } from "react";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ModelSelector, type ModelOption } from "./model-selector";

type Props = {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e?: React.SyntheticEvent, contentOverride?: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isPending: boolean;
  effectiveThreadId: string | null;
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
  models,
  activeModelKey,
  onModelChange,
  modelsLoading,
  modelUpdating,
  modelErrorMessage,
  isDrawer,
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
          <Textarea
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
              "focus:border-primary focus:ring-primary/30"
            )}
          />

          <Button
            type="submit"
            disabled={!input.trim() || isPending || !effectiveThreadId}
            size="icon"
            className={cn(
              "absolute right-2 bottom-2 h-8 w-8 rounded-lg",
              "focus:ring-primary/30"
            )}
            aria-label="Send message"
          >
            <SendIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2 text-center">
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-50">
          Press <Kbd>Enter</Kbd> to send •{" "}
          <Kbd>Shift + Enter</Kbd> for new line
        </p>
      </div>
    </form>
  );
}
