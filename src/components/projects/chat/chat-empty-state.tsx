"use client";

import {
  ListTodoIcon,
  ClipboardListIcon,
  SparklesIcon,
  MessageSquareIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CSSProperties } from "react";

type PromptSuggestion = {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SUGGESTIONS: PromptSuggestion[] = [
  {
    label: "Generate tasks",
    prompt: "Based on the project description, what are the next 5 tasks I should complete?",
    icon: ListTodoIcon
  },
  {
    label: "Summarize status",
    prompt: "Analyze the current tasks and provide a high-level summary of the project's progress and any risks.",
    icon: ClipboardListIcon
  },
  {
    label: "What's next?",
    prompt: "I'm stuck. What is the most impactful thing I could work on next to move this project forward?",
    icon: SparklesIcon
  },
];

type Props = {
  onSelectPrompt: (prompt: string) => void;
  themeStyle?: CSSProperties;
  hasAccentColor?: boolean;
};

export function ChatEmptyState({ onSelectPrompt, themeStyle, hasAccentColor }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 backdrop-blur-sm">
        <MessageSquareIcon
          className={cn(
            "h-8 w-8 text-muted-foreground",
            hasAccentColor && "text-[rgb(var(--project-accent))]"
          )}
          style={hasAccentColor ? { color: themeStyle?.color } : undefined}
        />
      </div>

      <div className="max-w-md text-center">
        <h3 className="text-lg font-semibold text-foreground">
          Start a conversation
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask questions, brainstorm ideas, or get help with your project goals.
          The AI has context about your project description and tasks.
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => onSelectPrompt(suggestion.prompt)}
            className={cn(
              "group flex flex-col items-start rounded-xl border border-border bg-card/50 p-4 text-left transition-all hover:bg-muted/50 hover:shadow-md",
              hasAccentColor
                ? "hover:border-[rgb(var(--project-accent))/0.5]"
                : "hover:border-primary/50"
            )}
          >
            <div
              className={cn(
                "mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-background",
                hasAccentColor && "text-[rgb(var(--project-accent))]"
              )}
              style={hasAccentColor ? { color: themeStyle?.color } : undefined}
            >
              <suggestion.icon className="h-5 w-5" />
            </div>
            <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
              {suggestion.label}
            </div>
            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {suggestion.prompt}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
