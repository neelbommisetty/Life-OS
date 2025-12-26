'use client';

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

export const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Last Updated' },
  { value: 'createdAt', label: 'Date Created' },
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'dueDate', label: 'Due Date' },
  { value: 'priority', label: 'Priority' },
] as const;

export type SortBy = typeof SORT_OPTIONS[number]['value'];
export type SortOrder = 'asc' | 'desc';

type Props = {
  value: { sortBy: SortBy; sortOrder: SortOrder };
  onChange: (sortBy: SortBy, sortOrder: SortOrder) => void;
};

export function SortMenu({ value, onChange }: Props) {
  const currentOption = SORT_OPTIONS.find((opt) => opt.value === value.sortBy) || SORT_OPTIONS[0];

  return (
    <Menu as="div" className="relative inline-block text-left">
      <div>
        <MenuButton className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-all hover:bg-muted hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <span>{currentOption.label}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </MenuButton>
      </div>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <MenuItems className="absolute right-0 mt-2 w-56 origin-top-right rounded-xl border border-border bg-card p-1 shadow-xl focus:outline-none z-50">
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sort by
          </div>
          <div className="space-y-0.5">
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.value}>
                {({ active }) => (
                  <button
                    onClick={() => onChange(option.value as SortBy, value.sortOrder)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                      value.sortBy === option.value
                        ? "bg-primary/10 text-primary font-semibold"
                        : active ? "bg-muted text-foreground" : "text-foreground"
                    )}
                  >
                    {option.label}
                    {value.sortBy === option.value && <Check className="h-4 w-4" />}
                  </button>
                )}
              </MenuItem>
            ))}
          </div>

          <div className="my-1 border-t border-border" />

          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Order
          </div>
          <div className="flex p-1 gap-1">
            <button
              onClick={() => onChange(value.sortBy, 'desc')}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                value.sortOrder === 'desc' ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              Descending
            </button>
            <button
              onClick={() => onChange(value.sortBy, 'asc')}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                value.sortOrder === 'asc' ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              Ascending
            </button>
          </div>
        </MenuItems>
      </Transition>
    </Menu>
  );
}
