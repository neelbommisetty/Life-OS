import Link from "next/link";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { PriorityBadge } from "@/components/projects/priority-badge";
import { StatusBadge } from "@/components/projects/status-badge";
import { formatDate } from "@/lib/project-utils";
import { serverCaller } from "@/server/trpc/server";

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
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Project OS</h1>
          <p className="text-muted-foreground">
            Manage your ideas, tasks, and progress in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            View all projects &rarr;
          </Link>
          <CreateProjectDialog />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">
            Total Projects
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{total}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-blue-600 dark:text-blue-300">
            In Progress
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {inProgress}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Ideas</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{ideas}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-300">
            Completed
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{completed}</p>
        </div>
      </div>

      {/* Recent Projects */}
      <div>
        <h2 className="mb-4 text-xl font-semibold text-foreground">
          Recent Activity
        </h2>
        {recentProjects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group flex flex-col justify-between rounded-xl border border-border bg-card p-4 transition hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {project.icon ? (
                        <span>{project.icon}</span>
                      ) : (
                        <div className="h-6 w-6 rounded bg-muted" />
                      )}
                      <h3 className="font-semibold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-300">
                        {project.name}
                      </h3>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>
                  {project.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {project.description}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground italic">
                      No description
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                  <div className="flex gap-2">
                    <PriorityBadge priority={project.priority} />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(project.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted p-12 text-center">
            <h3 className="text-lg font-medium text-foreground">
              No projects yet
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get started by creating your first project.
            </p>
            <div className="mt-6">
              <CreateProjectDialog />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
