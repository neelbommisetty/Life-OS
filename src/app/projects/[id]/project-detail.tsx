import { notFound } from "next/navigation";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { StatusTimeline } from "@/components/projects/status-timeline";
import { ProjectTasksBoard } from "@/components/projects/project-tasks-board";
import { ProjectArtifacts } from "@/components/projects/project-artifacts";
import { ProjectSystemContextCard } from "@/components/projects/project-system-context-card";
import { ProjectStatsCard } from "@/components/projects/project-stats-card";
import { ProjectChat } from "@/components/projects/project-chat";
import { formatDate } from "@/lib/project-utils";
import { serverCaller } from "@/server/trpc/server";
import { Suspense } from "react";

type Props = {
  id: string;
};

export async function ProjectDetail({ id }: Props) {
  const [project, tasks] = await Promise.all([
    serverCaller()
      .project.getById({ id })
      .catch(() => null),
    serverCaller()
      .task.list({ projectId: id })
      .catch(() => []),
  ]);

  if (!project) {
    notFound();
  }

  // Compute task statistics
  const taskStats = {
    total: tasks.length,
    todo: tasks.filter(t => t.status === "BACKLOG" || t.status === "TODO").length,
    inProgress: tasks.filter(t => t.status === "IN_PROGRESS").length,
    done: tasks.filter(t => t.status === "DONE").length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 space-y-6">
      <ProjectHeader
        project={project}
        actions={<EditProjectDialog project={project} />}
      />

      <section className="space-y-6">
        <Suspense fallback={<div className="h-64 w-full animate-pulse bg-muted rounded-xl" />}>
          <ProjectTabs
            accentColor={project.color}
            overview={
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
                  {/* Main Content Column */}
                  <div className="space-y-6">
                    {/* Stats and Progress */}
                    <ProjectStatsCard stats={taskStats} accentColor={project.color} />

                    {/* Description Card */}
                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Project brief
                        </p>
                        <h2 className="text-lg font-semibold text-foreground">
                          Description
                        </h2>
                        <p className="text-sm text-muted-foreground line-clamp-6">
                          {project.description || "No description yet."}
                        </p>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="uppercase tracking-wide">Created</span>
                          <span className="text-foreground">
                            {formatDate(project.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="uppercase tracking-wide">Updated</span>
                          <span className="text-foreground">
                            {formatDate(project.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar Column */}
                  <div className="space-y-6">
                    <ProjectSystemContextCard projectId={project.id} />

                    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-4">
                        Status history
                      </p>
                      <StatusTimeline
                        history={project.statusHistory}
                        accentColor={project.color}
                      />
                    </div>
                  </div>
                </div>
              </div>
            }
            tasks={
              <ProjectTasksBoard
                projectId={project.id}
                accentColor={project.color}
              />
            }
            chat={
              <ProjectChat
                projectId={project.id}
                accentColor={project.color}
              />
            }
            artifacts={
              <ProjectArtifacts
                projectId={project.id}
                accentColor={project.color}
              />
            }
          />
        </Suspense>
      </section>
    </main>
  );
}
