import type { Metadata } from "next";
import { listProjects } from "@/lib/projects";
import { ProjectsClient } from "./projects-client";

export const metadata: Metadata = {
  title: "Projects",
  description: "Group related tasks and knowledge by project.",
};

export default async function ProjectsPage() {
  const projects = await listProjects();

  return <ProjectsClient initialProjects={projects} />;
}
