'use client';

import { Grid3x3, List } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  value: 'grid' | 'list';
  onChange: (mode: 'grid' | 'list') => void;
};

export function ViewToggle({ value, onChange }: Props) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-card p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md transition-all",
          value === 'grid'
            ? "bg-muted text-foreground shadow-inner"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
        title="Grid view"
      >
        <Grid3x3 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md transition-all",
          value === 'list'
            ? "bg-muted text-foreground shadow-inner"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
        title="List view"
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}
