'use client';

import Link from 'next/link';
import { ListTodo, MessageSquarePlus } from 'lucide-react';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';

export function QuickActions() {
  return (
    <div className="mb-10">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Quick Actions
      </h2>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <div className="opacity-0 animate-fade-in" style={{ animationDelay: '0ms' }}>
          <CreateProjectDialog />
        </div>

        <div className="opacity-0 animate-fade-in" style={{ animationDelay: '50ms' }}>
          <Link
            href="/projects"
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-purple-600 dark:text-purple-400 group-hover:bg-purple-50 dark:group-hover:bg-purple-900/20">
              <ListTodo className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold text-foreground">View All Tasks</span>
          </Link>
        </div>

        <div className="opacity-0 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <Link
            href="/projects"
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/20">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold text-foreground">Quick Brainstorm</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
