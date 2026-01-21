import { listProjects } from "@/lib/projects";
import { ProjectsClient } from "./projects-client";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return <ProjectsClient initialProjects={projects} />;
}
