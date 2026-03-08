import type { Metadata } from "next";
import { ProjectCreatePageClient } from "./project-create-page-client";

export const metadata: Metadata = {
  title: "Create project",
  description: "Create a project for related assistant work, tasks, and notes.",
};

export default function ProjectCreatePage() {
  return <ProjectCreatePageClient />;
}
