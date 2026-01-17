"use client";

import {
  SparklesIcon,
  ChevronRightIcon,
  BotIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";
import type { ModelOption } from "../model-selector";

type Props = {
  projectName?: string;
  projectEmoji?: string | null;
  threadTitle?: string;
  activeModel?: ModelOption;
  themeStyle?: CSSProperties;
  hasAccentColor?: boolean;
  isDrawer?: boolean;
};

export function ChatHeader({
  projectName,
  projectEmoji,
  threadTitle,
  activeModel,
  themeStyle,
  hasAccentColor,
  isDrawer
}: Props) {
  return (
    <div className={cn(
      "flex items-center justify-between border-b border-border px-4 py-3 bg-background/50 backdrop-blur-sm",
      isDrawer && "sticky top-0 z-10"
    )}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base",
          hasAccentColor && "bg-[rgb(var(--project-accent))/0.1]"
        )}>
          {projectEmoji || "📁"}
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-sm font-semibold text-foreground">
              {projectName || "Loading project..."}
            </span>
            <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs text-muted-foreground">
              {threadTitle || "New Conversation"}
            </span>
          </div>

          {activeModel && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              <BotIcon className="h-2.5 w-2.5" />
              <span>{activeModel.label}</span>
              <span className="opacity-50">•</span>
              <span>{activeModel.provider}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {hasAccentColor && (
          <div
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-tight"
            style={{
              backgroundColor: `rgba(var(--project-accent), 0.1)`,
              color: `rgb(var(--project-accent))`
            }}
          >
            <SparklesIcon className="h-2.5 w-2.5" />
            <span>AI Assistant</span>
          </div>
        )}
      </div>
    </div>
  );
}
