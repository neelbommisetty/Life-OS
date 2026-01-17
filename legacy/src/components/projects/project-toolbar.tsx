'use client';

import { Search, X } from 'lucide-react';
import { StatusFilter } from './status-filter';
import { SortMenu, type SortBy, type SortOrder } from './sort-menu';
import { ViewToggle } from './view-toggle';
import type { ProjectStatus } from '@prisma/client';
import { useState, useEffect } from 'react';
import { useDebounce } from '@/hooks/use-debounce';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  status: ProjectStatus | null;
  onStatusChange: (value: ProjectStatus | null) => void;
  sortBy: SortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: SortBy, sortOrder: SortOrder) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
};

export function ProjectToolbar({
  search,
  onSearchChange,
  status,
  onStatusChange,
  sortBy,
  sortOrder,
  onSortChange,
  viewMode,
  onViewModeChange,
}: Props) {
  const [localSearch, setLocalSearch] = useState(search);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    // Only trigger if debounced value is different from current prop
    if (debouncedSearch !== search) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch, onSearchChange, search]);

  // Sync local search when external search changes (e.g. from URL)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="group relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search projects by name or description..."
          className="h-12 w-full rounded-xl border border-border bg-card pl-12 pr-12 text-base transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 group-hover:border-primary/30"
        />
        {localSearch && (
          <button
            onClick={() => setLocalSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filters and Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="overflow-x-auto pb-1 lg:pb-0">
          <StatusFilter value={status} onChange={onStatusChange} />
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <SortMenu value={{ sortBy, sortOrder }} onChange={onSortChange} />
          <div className="h-6 w-px bg-border hidden sm:block" />
          <ViewToggle value={viewMode} onChange={onViewModeChange} />
        </div>
      </div>
    </div>
  );
}
