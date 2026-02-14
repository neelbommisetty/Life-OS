"use client";

import {
  LightbulbIcon,
  MessageSquareIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { brand } from "@/lib/brand";

type PromptSuggestion = {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
};

const SUGGESTIONS: PromptSuggestion[] = [
  {
    label: "Plan today",
    prompt:
      "Turn these tasks and deadlines into a plan with 2–3 focus blocks:\n\n- \n- \n- ",
    icon: LightbulbIcon,
  },
  {
    label: "Draft a message",
    prompt:
      "Draft an email/message to [person] about [topic]. Keep it concise and actionable.",
    icon: MessageSquareIcon,
  },
  {
    label: "Summarize into next steps",
    prompt:
      "Summarize this and list the next actions (with owners and due dates if stated):\n\n",
    icon: MessageSquareIcon,
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
          {brand.terms.assistant}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Share what you&apos;re working on. I can draft, summarize, and turn deadlines
          into a plan. You can review and edit anything.
        </p>
      </div>

      <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => (
          <Card
            key={suggestion.label}
            onClick={() => onSelectPrompt(suggestion.prompt)}
            className={cn(
              "group cursor-pointer transition-all",
              "hover:bg-muted/50 hover:shadow-md hover:border-primary/50",
              "bg-card/50"
            )}
          >
            <CardContent className="p-4">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-background text-primary">
                <suggestion.icon className="h-5 w-5" />
              </div>
              <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                {suggestion.label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                {suggestion.prompt}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
