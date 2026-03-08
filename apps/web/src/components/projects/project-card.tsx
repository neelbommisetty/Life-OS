import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@life-os/db";
import { formatRelativeTime } from "@/lib/utils";
import { getProjectCardLabels } from "./project-card-details";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const labels = getProjectCardLabels(project);
  const truncatedDescription = project.description
    ? project.description.length > 150
      ? `${project.description.slice(0, 150)}...`
      : project.description
    : "No description.";

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
          <CardDescription className="text-sm">
            {truncatedDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground">
              {labels.brief}
            </span>
            <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium text-foreground">
              {labels.instructions}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Updated {formatRelativeTime(project.updatedAt)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
