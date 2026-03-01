"use client";

import { useRef, useEffect, useState } from "react";
import { ArrowUpIcon, AlertCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const errorRef = useRef<HTMLDivElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setIsMac(
        typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent),
      );
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (modelErrorMessage && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [modelErrorMessage]);

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
        "p-4 transition-colors",
        isDrawer ? "bg-card" : "bg-background",
      )}
    >
      {modelErrorMessage && (
        <div
          ref={errorRef}
          className="flex justify-center mb-2 animate-in zoom-in-95 duration-300"
        >
          <Badge
            variant="destructive"
            className="flex items-center gap-2 rounded-full px-4 py-1.5 text-xs border border-destructive/20 shadow-sm"
          >
            <AlertCircleIcon className="h-3 w-3" />
            {modelErrorMessage}
          </Badge>
        </div>
      )}
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl border border-border w-full",
          "bg-background shadow-sm p-1.5 transition-all",
          "focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20",
        )}
      >
        <ModelSelector
          models={models}
          value={activeModelKey}
          onChange={onModelChange}
          isLoading={modelsLoading}
          isUpdating={modelUpdating}
          errorMessage={modelErrorMessage}
          displayMode="text"
          buttonClassName="shadow-none border-none bg-transparent hover:bg-muted/50"
        />

        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustHeight(e.target);
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask a question or describe what you need..."
          aria-label="Message input"
          disabled={isPending || !effectiveThreadId}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent border-0 shadow-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "placeholder:text-muted-foreground/60",
            "text-sm px-2 py-2.5",
            "min-h-[40px] max-h-[200px]",
          )}
        />

        <div className="flex items-center gap-3 pr-1 shrink-0">
          <span className="hidden sm:block text-[10px] text-muted-foreground/50 font-medium uppercase tracking-wider whitespace-nowrap">
            {isMac ? "⌘" : "Ctrl"} + Enter to send
          </span>

          <Button
            type="submit"
            disabled={!input.trim() || isPending || !effectiveThreadId}
            size="icon"
            className={cn(
              "h-8 w-8 rounded-full shrink-0 transition-all",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "shadow-sm",
            )}
            aria-label="Send message"
          >
            <ArrowUpIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2 text-center">
        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest">
          Verify important details.
        </p>
      </div>
    </form>
  );
}
