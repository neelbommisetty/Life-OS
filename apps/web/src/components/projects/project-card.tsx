import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@prisma/client";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const truncatedDescription = project.description
    ? project.description.length > 150
      ? `${project.description.slice(0, 150)}...`
      : project.description
    : "No description";

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
          <CardDescription className="text-sm">
            {truncatedDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Updated {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
