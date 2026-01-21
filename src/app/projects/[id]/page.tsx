import { getProjectWithItems } from "@/lib/projects";
import { ProjectDetailClient } from "./project-detail-client";
import { notFound } from "next/navigation";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;

  try {
    const project = await getProjectWithItems({ id });
    return <ProjectDetailClient project={project} />;
  } catch (error) {
    console.error("Failed to load project:", error);
    notFound();
  }
}
