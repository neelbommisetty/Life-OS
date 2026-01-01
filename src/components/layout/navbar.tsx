'use client';

import Link from 'next/link';
import { LayoutDashboard, LineChart } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutDashboard className="h-5 w-5" />
            </div>
            <span className="hidden text-lg font-bold tracking-tight text-foreground sm:inline-block">
              Project OS
            </span>
          </Link>
          <Link
            href="/admin/analytics"
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            <LineChart className="h-4 w-4" />
            Analytics
          </Link>
          <Link
            href="/admin/analytics/pricing"
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            <LineChart className="h-4 w-4" />
            Pricing
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          <div className="h-6 w-px bg-border" aria-hidden="true" />
          <CreateProjectDialog />
        </div>
      </div>
    </header>
  );
}
