'use client';

import { useCallback } from "react";

import { useQueryState } from "@/hooks/use-query-state";
import { api } from "@/trpc/client";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { ProjectToolbar } from "@/components/projects/project-toolbar";
import { ProjectListView } from "@/components/projects/project-list-view";
import type { ProjectStatus } from "@prisma/client";
import type { SortBy, SortOrder } from "@/components/projects/sort-menu";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function ProjectsClient() {
  const router = useRouter();
  const [search, setSearch] = useQueryState<string>('q', '');
  const [status, setStatus] = useQueryState<ProjectStatus>('status');
  const [sortBy] = useQueryState<SortBy>('sort', 'updatedAt');
  const [sortOrder] = useQueryState<SortOrder>('order', 'desc');
  const [viewMode, setViewMode] = useQueryState<'grid' | 'list'>('view', 'grid');

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = api.project.list.useInfiniteQuery(
    {
      status: status || undefined,
      search: search || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      limit: 12
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    }
  );

  const projects = data?.pages.flatMap((page) => page.items) ?? [];

  const handleSearchChange = useCallback((val: string) => setSearch(val), [setSearch]);
  const handleStatusChange = useCallback((val: ProjectStatus | null) => setStatus(val), [setStatus]);
  const handleSortChange = useCallback((newSort: SortBy, newOrder: SortOrder) => {
    const params = new URLSearchParams(window.location.search);

    // Update sortBy
    if (newSort === 'updatedAt') params.delete('sort');
    else params.set('sort', newSort);

    // Update sortOrder
    if (newOrder === 'desc') params.delete('order');
    else params.set('order', newOrder);

    const queryString = params.toString();
    const url = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    router.push(url, { scroll: false });
  }, [router]);
  const handleViewModeChange = useCallback((mode: 'grid' | 'list') => setViewMode(mode), [setViewMode]);

  return (
    <div className="space-y-8 pb-20">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Projects</h1>
          <p className="text-sm font-medium text-muted-foreground">
            Manage your workspace and track project status in real-time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CreateProjectDialog />
        </div>
      </div>

      {/* Control Toolbar */}
      <ProjectToolbar
        search={search || ''}
        onSearchChange={handleSearchChange}
        status={status}
        onStatusChange={handleStatusChange}
        sortBy={sortBy as SortBy}
        sortOrder={sortOrder as SortOrder}
        onSortChange={handleSortChange}
        viewMode={viewMode as 'grid' | 'list' || 'grid'}
        onViewModeChange={handleViewModeChange}
      />

      {/* Main Content */}
      <div className="relative min-h-[400px]">
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-2xl border border-border bg-muted/30"
              />
            ))}
          </div>
        ) : projects.length > 0 ? (
          <div
            key={viewMode}
            className="animate-slide-up"
          >
            {viewMode === 'list' ? (
              <ProjectListView projects={projects} />
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-border bg-muted/10 p-20 text-center animate-fade-in"
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 text-3xl">
              {search ? '🔍' : '📂'}
            </div>
            <h3 className="text-lg font-bold text-foreground">
              {search ? `No results for "${search}"` : "No projects found"}
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {search
                ? "Try adjusting your search or filters to find what you're looking for."
                : "Get started by creating your first project using the button above."}
            </p>
          </div>
        )}

        {/* Loading More & Sentinel */}
        {hasNextPage && (
          <div className="mt-12 flex justify-center">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="group flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-bold text-foreground shadow-sm transition-all hover:bg-muted hover:shadow-md disabled:opacity-50"
            >
              {isFetchingNextPage ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more...
                </>
              ) : (
                <>
                  Load More Projects
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

