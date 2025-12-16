import Link from "next/link";
import { serverCaller } from "@/server/trpc/server";
import { StatsCards } from "@/components/home/stats-cards";
import { RecentProjects } from "@/components/home/recent-projects";
import { WelcomeHeader } from "@/components/home/welcome-header";
import { ArrowRight } from "lucide-react";

export default async function Home() {
  const projects = await serverCaller().project.list();

  // Compute summary stats
  const total = projects.length;
  const inProgress = projects.filter((p) => p.status === "IN_PROGRESS").length;
  const completed = projects.filter((p) => p.status === "COMPLETE").length;
  const ideas = projects.filter((p) => p.status === "IDEA").length;

  // Recent projects (top 6)
  const recentProjects = projects.slice(0, 6);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <WelcomeHeader />
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all projects
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-10">
        <StatsCards
          total={total}
          inProgress={inProgress}
          ideas={ideas}
          completed={completed}
        />
      </div>

      {/* Recent Projects */}
      <div>
        <h2 className="mb-6 text-xl font-semibold text-foreground">
          Recent Activity
        </h2>
        <RecentProjects projects={recentProjects} />
      </div>
    </main>
  );
}
