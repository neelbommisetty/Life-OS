"use client";

import { SparklesIcon, BotIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ModelOption } from "./model-selector";

type Props = {
  threadTitle?: string;
  activeModel?: ModelOption;
  isDrawer?: boolean;
};

export function ChatHeader({ threadTitle, activeModel, isDrawer }: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-4 py-3 bg-background/50 backdrop-blur-sm shrink-0",
        isDrawer && "sticky top-0 z-10"
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SparklesIcon className="h-4 w-4" />
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-semibold text-foreground shrink-0">
              AI Chat
            </span>
            {threadTitle && (
              <>
                <span className="text-muted-foreground shrink-0">•</span>
                <span className="truncate text-xs text-muted-foreground">
                  {threadTitle}
                </span>
              </>
            )}
          </div>

          {activeModel && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <BotIcon className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{activeModel.label}</span>
              <span className="opacity-50 shrink-0">•</span>
              <span className="truncate">{activeModel.provider}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="default" className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-tight bg-primary/10 text-primary whitespace-nowrap">
          <SparklesIcon className="h-2.5 w-2.5" />
          <span>AI Assistant</span>
        </Badge>
      </div>
    </div>
  );
}
