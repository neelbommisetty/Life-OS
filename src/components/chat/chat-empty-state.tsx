"use client";

import {
  LightbulbIcon,
  BookOpenIcon,
  SparklesIcon,
  MessageSquareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type PromptSuggestion = {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SUGGESTIONS: PromptSuggestion[] = [
  {
    label: "Brainstorm ideas",
    prompt: "Help me brainstorm creative ideas for a new project I'm working on.",
    icon: LightbulbIcon,
  },
  {
    label: "Learn something",
    prompt: "Explain how quantum computing works in simple terms.",
    icon: BookOpenIcon,
  },
  {
    label: "Get creative",
    prompt: "Write a short story about a robot discovering emotions for the first time.",
    icon: SparklesIcon,
  },
];

type Props = {
  onSelectPrompt: (prompt: string) => void;
};

export function ChatEmptyState({ onSelectPrompt }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 backdrop-blur-sm">
        <MessageSquareIcon className="h-8 w-8 text-primary" />
      </div>

      <div className="max-w-md text-center">
        <h3 className="text-lg font-semibold text-foreground">
          Welcome to AI Chat
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          I'm here to help you brainstorm ideas, answer questions, learn new things,
          or just have a creative conversation. What would you like to explore?
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => onSelectPrompt(suggestion.prompt)}
            className={cn(
              "group flex flex-col items-start rounded-xl border border-border bg-card/50 p-4 text-left transition-all",
              "hover:bg-muted/50 hover:shadow-md hover:border-primary/50"
            )}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-background text-primary">
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
