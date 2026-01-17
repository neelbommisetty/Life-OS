import Link from "next/link";
import { serverCaller } from "@/server/trpc/server";
import { StatsCards } from "@/components/home/stats-cards";
import { RecentProjects } from "@/components/home/recent-projects";
import { WelcomeHeader } from "@/components/home/welcome-header";
import { ContinueCard } from "@/components/home/continue-card";
import { QuickActions } from "@/components/home/quick-actions";
import { ArrowRight } from "lucide-react";

export default async function Home() {
  const data = await serverCaller().dashboard.getSummary();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-12">
      {/* Header and Welcome */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <WelcomeHeader
          upcomingTaskCount={data.upcomingTasks.length}
          lastEditedProject={data.lastEdited}
        />
        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/projects"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all projects
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Primary Context: Continue Working */}
      {data.lastEdited && (
        <ContinueCard project={data.lastEdited} />
      )}

      {/* Quick Access */}
      <QuickActions />

      {/* Insights and Progress */}
      <div>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Project Insights
        </h2>
        <StatsCards stats={data.stats} />
      </div>

      {/* Recent Activity Grid */}
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">
            Recent Activity
          </h2>
        </div>
        <RecentProjects projects={data.recentProjects} />
      </div>
    </main>
  );
}
