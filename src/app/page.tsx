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
          <h1 className="text-3xl font-bold text-zinc-900">Project OS</h1>
          <p className="text-zinc-600">
            Manage your ideas, tasks, and progress in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
          >
            View all projects &rarr;
          </Link>
          <CreateProjectDialog />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-zinc-500">Total Projects</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{total}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-blue-600">In Progress</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{inProgress}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-zinc-500">Ideas</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{ideas}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-sm font-medium text-emerald-600">Completed</p>
          <p className="mt-2 text-2xl font-bold text-zinc-900">{completed}</p>
        </div>
      </div>

      {/* Recent Projects */}
      <div>
        <h2 className="mb-4 text-xl font-semibold text-zinc-900">
          Recent Activity
        </h2>
        {recentProjects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="group flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {project.icon ? (
                        <span>{project.icon}</span>
                      ) : (
                        <div className="h-6 w-6 rounded bg-zinc-100" />
                      )}
                      <h3 className="font-semibold text-zinc-900 group-hover:text-blue-600">
                        {project.name}
                      </h3>
                    </div>
                    <StatusBadge status={project.status} />
                  </div>
                  {project.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-500">
                      {project.description}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-400 italic">
                      No description
                    </p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
                  <div className="flex gap-2">
                    <PriorityBadge priority={project.priority} />
                  </div>
                  <span className="text-xs text-zinc-400">
                    {formatDate(project.updatedAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-12 text-center">
            <h3 className="text-lg font-medium text-zinc-900">
              No projects yet
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
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
