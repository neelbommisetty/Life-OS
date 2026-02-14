import { RecentProjects } from "@/components/home/recent-projects";
import { UpcomingTasks } from "@/components/home/upcoming-tasks";
import { RecentNotes } from "@/components/home/recent-notes";
import type { Metadata } from "next";
import { Suspense } from "react";
import { requireApiSessionUser } from "@/lib/api/session";
import {
  RecentProjectsSkeleton,
  UpcomingTasksSkeleton,
  RecentNotesSkeleton
} from "@/components/home/home-skeletons";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Home",
  description: `Review what’s next across projects, tasks, and ${brand.terms.library.toLowerCase()}.`,
};

export default async function Page() {
  const sessionUser = await requireApiSessionUser();
  const fullUserName = sessionUser.name || "there";
  const firstName = fullUserName.split(" ")[0];

  const now = new Date();
  const hour = now.getHours();
  let greeting = "Good evening";
  if (hour >= 5 && hour < 12) greeting = "Good morning";
  else if (hour >= 12 && hour < 17) greeting = "Good afternoon";

  const dateString = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="h-full w-full bg-background p-8 overflow-auto">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              {greeting}, {firstName}
            </h1>
            <p className="text-lg text-muted-foreground">
              Here’s what’s next.
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/50 border border-border w-fit h-fit mt-2">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {dateString}
            </span>
          </div>
        </header>

        <Suspense fallback={<RecentProjectsSkeleton />}>
          <RecentProjects />
        </Suspense>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Suspense fallback={<UpcomingTasksSkeleton />}>
            <UpcomingTasks />
          </Suspense>
          <Suspense fallback={<RecentNotesSkeleton />}>
            <RecentNotes />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
