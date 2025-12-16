import { notFound } from "next/navigation";
import { EditProjectDialog } from "@/components/projects/edit-project-dialog";
import { ProjectHeader } from "@/components/projects/project-header";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { StatusTimeline } from "@/components/projects/status-timeline";
import { formatDate } from "@/lib/project-utils";
import { serverCaller } from "@/server/trpc/server";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  const project = await serverCaller()
    .project.getById({ id })
    .catch(() => null);

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <ProjectHeader
        project={project}
        actions={<EditProjectDialog project={project} />}
      />

      <ProjectTabs
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
              <StatusTimeline history={project.statusHistory} />
            </div>
          </div>
        }
        tasks={
          <PlaceholderCard title="Tasks">
            Task management coming soon. Define tasks, owners, and progress.
          </PlaceholderCard>
        }
        brainstorm={
          <PlaceholderCard title="Brainstorm">
            Capture notes, ideas, and research artifacts for this project.
          </PlaceholderCard>
        }
        artifacts={
          <PlaceholderCard title="Artifacts">
            Store links to docs, designs, and deliverables in one place.
          </PlaceholderCard>
        }
      />
    </main>
  );
}

function PlaceholderCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
      <h3 className="mb-2 text-base font-semibold text-foreground">{title}</h3>
      <p>{children}</p>
    </div>
  );
}
