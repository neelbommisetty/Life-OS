import type { Metadata } from "next";
import { getProjectWithItems } from "@/lib/projects";
import { ProjectDetailClient } from "./project-detail-client";
import { notFound } from "next/navigation";
import { brand } from "@/lib/brand";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: ProjectDetailPageProps): Promise<Metadata> {
  const { id } = await params;

  return {
    title: `Project ${id}`,
    description: `Review project details, tasks, notes, and the ${brand.terms.assistant.toLowerCase()}.`,
  };
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;

  const project = await getProjectWithItems({ id }).catch((error) => {
    console.error("Failed to load project:", error);
    notFound();
  });

  return <ProjectDetailClient project={project} />;
}
