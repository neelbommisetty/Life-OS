import { notFound } from "next/navigation";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { StatusTimeline } from "@/components/projects/status-timeline";
import { ProjectTasksBoard } from "@/components/projects/project-tasks-board";
import { ProjectChat } from "@/components/projects/project-chat";
import { ProjectArtifacts } from "@/components/projects/project-artifacts";
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
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <ProjectHeader
        project={project}
        actions={<EditProjectDialog project={project} />}
      />

      <ProjectTabs
        accentColor={project.color}
        overview={
          <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">
                Description
              </h2>
              <p className="text-sm text-muted-foreground">
                {project.description || "No description yet."}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 rounded-lg border border-border bg-muted p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Created
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(project.createdAt)}
                </p>
              </div>
              <div className="space-y-1 rounded-lg border border-border bg-muted p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Last updated
                </p>
                <p className="text-sm text-foreground">
                  {formatDate(project.updatedAt)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold text-foreground">
                Status history
              </h3>
              <StatusTimeline
                history={project.statusHistory}
                accentColor={project.color}
              />
            </div>
          </div>
        }
        tasks={<ProjectTasksBoard projectId={project.id} accentColor={project.color} />}
        brainstorm={<ProjectChat projectId={project.id} accentColor={project.color} />}
        artifacts={
          <ProjectArtifacts projectId={project.id} accentColor={project.color} />
        }
      />
    </main>
  );
}
