'use client';

import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { Smile, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  value?: string;
  onChange: (emoji: string) => void;
  className?: string;
  compact?: boolean;
};

// Curated list of emojis
const EMOJI_LIST = [
  '🚀', '💡', '✨', '🔥', '🚧', '✅', '📅', '📌',
  '📝', '📊', '🎨', '🛠️', '⚙️', '💻', '📱', '⌚',
  '📦', '🎁', '🛒', '💰', '💎', '🏆', '🏠', '🏢',
  '🚗', '✈️', '🌍', '❤️', '👍', '🎓', '🔬', '⚖️',
  '⚡', '⭐', '🌈', '🍀', '🎵', '🎮', '🧩', '🔒',
  '🔑', '🔔', '📣', '📢', '💬', '💭', '👁️', '🧠'
];

export function ProjectEmojiPicker({ value, onChange, className, compact }: Props) {
  return (
    <Listbox value={value} onChange={onChange}>
      <ListboxButton
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-input bg-background text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          compact ? "h-12 w-12 justify-center rounded-xl p-0" : "px-3 py-2",
          !value && "text-muted-foreground",
          className
        )}
      >
        <div className={cn("flex items-center gap-2 flex-1", compact && "justify-center")}>
          {value ? (
            <span className="text-lg leading-none">{value}</span>
          ) : (
            <Smile className="h-4 w-4 shrink-0" />
          )}
          {compact ? (
            <span className="sr-only">{value ? "Selected icon" : "Select icon"}</span>
          ) : (
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value ? "Selected icon" : "Select icon"}
            </span>
          )}
        </div>
      </ListboxButton>

      <ListboxOptions
        anchor="bottom start"
        transition
        className="z-50 mt-1 max-h-60 w-[18rem] overflow-auto rounded-xl border border-border bg-popover p-2 shadow-lg ring-1 ring-black/5 focus:outline-none transition ease-in duration-100 data-[closed]:opacity-0"
      >
        <div className="grid grid-cols-6 gap-1">
            <ListboxOption
            value=""
            className={({ active, selected }) =>
              cn(
                "relative flex cursor-pointer select-none items-center justify-center rounded-md p-2 text-sm transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-popover-foreground",
                selected ? "bg-accent/50" : ""
              )
            }
            title="No icon"
          >
              <X className="h-4 w-4" />
          </ListboxOption>

          {EMOJI_LIST.map((emoji) => (
            <ListboxOption
              key={emoji}
              value={emoji}
              className={({ active, selected }) =>
                cn(
                  "relative flex cursor-pointer select-none items-center justify-center rounded-md p-2 text-xl transition-transform",
                  active ? "bg-accent scale-110" : "",
                  selected ? "bg-primary/10 ring-1 ring-primary/30" : ""
                )
              }
            >
              {emoji}
            </ListboxOption>
          ))}
        </div>
      </ListboxOptions>
    </Listbox>
  );
}
