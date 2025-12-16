'use client';

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useState, useEffect } from 'react';
import { Palette, Check, X, Pipette } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  value?: string;
  onChange: (color: string) => void;
  className?: string;
};

const PRESET_COLORS = [
  { name: 'Slate', value: '#64748b' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Sky', value: '#0ea5e9' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Fuchsia', value: '#d946ef' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Rose', value: '#f43f5e' },
];

export function ProjectColorPicker({ value, onChange, className }: Props) {
  // Local state for the custom hex input to allow typing without jitter
  const [customHex, setCustomHex] = useState(value || '');

  useEffect(() => {
    setCustomHex(value || '');
  }, [value]);

  const handleCustomHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setCustomHex(newVal);

    // Only trigger update if it's a valid hex (3 or 6 chars, optional #)
    if (/^#?([0-9A-F]{3}){1,2}$/i.test(newVal)) {
       const formatted = newVal.startsWith('#') ? newVal : `#${newVal}`;
       onChange(formatted);
    } else if (newVal === '') {
       onChange('');
    }
  };

  const handleCustomBlur = () => {
    if (!customHex) {
      onChange('');
      return;
    }
    if (!customHex.startsWith('#')) {
      const withHash = `#${customHex}`;
      if (/^#([0-9A-F]{3}){1,2}$/i.test(withHash)) {
        onChange(withHash);
        setCustomHex(withHash);
      }
    }
  };

  return (
    <Popover>
      <PopoverButton
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          !value && "text-muted-foreground",
          className
        )}
      >
        <div className="flex items-center gap-2 flex-1 truncate">
          {value ? (
            <>
              <div
                className="h-4 w-4 rounded-full border border-border shadow-sm shrink-0"
                style={{ backgroundColor: value }}
              />
              <span className="font-medium">{value}</span>
            </>
          ) : (
            <>
              <Palette className="h-4 w-4 shrink-0" />
              <span>Select color</span>
            </>
          )}
        </div>
      </PopoverButton>

      <PopoverPanel
        anchor="bottom start"
        transition
        className="z-50 mt-1 w-64 rounded-xl border border-border bg-popover p-4 shadow-lg ring-1 ring-black/5 transition duration-200 ease-out data-[closed]:translate-y-1 data-[closed]:opacity-0"
      >
        <div className="space-y-4">
          {/* Presets Grid */}
          <div className="grid grid-cols-6 gap-2">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setCustomHex('');
              }}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border border-input hover:bg-muted transition-colors",
                !value ? "ring-2 ring-primary ring-offset-2" : ""
              )}
              title="No color"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>

            {PRESET_COLORS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => {
                  onChange(color.value);
                  setCustomHex(color.value);
                }}
                className={cn(
                  "h-8 w-8 rounded-full border border-border transition-transform hover:scale-110 focus:outline-none",
                  value?.toLowerCase() === color.value.toLowerCase() ? "ring-2 ring-primary ring-offset-2" : ""
                )}
                style={{ backgroundColor: color.value }}
                title={color.name}
              >
                <span className="sr-only">{color.name}</span>
                {value?.toLowerCase() === color.value.toLowerCase() && (
                  <Check className="mx-auto h-4 w-4 text-white drop-shadow-md" />
                )}
              </button>
            ))}
          </div>

          {/* Custom Input */}
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <div className="relative flex-1">
              <Pipette className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={customHex}
                onChange={handleCustomHexChange}
                onBlur={handleCustomBlur}
                placeholder="#000000"
                className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-8 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div className="relative h-9 w-9 overflow-hidden rounded-md border border-input shadow-sm">
              <input
                type="color"
                value={value && /^#[0-9A-F]{6}$/i.test(value) ? value : '#000000'}
                onChange={(e) => {
                  onChange(e.target.value);
                  setCustomHex(e.target.value);
                }}
                className="absolute -top-2 -left-2 h-16 w-16 cursor-pointer border-none p-0"
              />
            </div>
          </div>
        </div>
      </PopoverPanel>
    </Popover>
  );
}
