import { notFound } from "next/navigation";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { StatusTimeline } from "@/components/projects/status-timeline";
import { ProjectTasksBoard } from "@/components/projects/project-tasks-board";
import { ProjectArtifacts } from "@/components/projects/project-artifacts";
import { ProjectSystemContextCard } from "@/components/projects/project-system-context-card";
import { ProjectBrainstormDrawer } from "@/components/projects/project-brainstorm-drawer";
import { formatDate } from "@/lib/project-utils";
import { serverCaller } from "@/server/trpc/server";

type Props = {
  id: string;
};

export async function ProjectDetail({ id }: Props) {
  const project = await serverCaller()
    .project.getById({ id })
    .catch(() => null);

  if (!project) {
    notFound();
  }

  // Ensure chat thread exists for this project (create if it doesn't)
  await serverCaller()
    .chat.getThread({ projectId: id })
    .catch((error) => {
      // Log error but don't block page render if thread creation fails
      console.error("Failed to initialize chat thread:", error);
    });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 space-y-6">
      <ProjectHeader
        project={project}
        actions={<EditProjectDialog project={project} />}
      />

      <section className="space-y-6">
        <ProjectTabs
          accentColor={project.color}
          overview={
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
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

                  <div className="mt-5 border-t border-border pt-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Status history
                    </p>
                    <div className="mt-3">
                      <StatusTimeline
                        history={project.statusHistory}
                        accentColor={project.color}
                      />
                    </div>
                  </div>
                </div>

                <ProjectSystemContextCard projectId={project.id} />
              </div>
            </div>
          }
          tasks={
            <ProjectTasksBoard
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
      </section>

      <ProjectBrainstormDrawer
        projectId={project.id}
        accentColor={project.color}
      />
    </main>
  );
}
