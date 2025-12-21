'use client';

import { ProjectCard } from '@/components/projects/project-card';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import type { Project } from '@prisma/client';
import { motion } from 'framer-motion';
import { FolderPlus } from 'lucide-react';

type Props = {
  projects: Project[];
};

export function RecentProjects({ projects }: Props) {
  if (projects.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FolderPlus className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-medium text-foreground">
          No projects yet
        </h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
          Get started by creating your first project to track your ideas and progress.
        </p>
        <div className="mt-6">
          <CreateProjectDialog />
        </div>
      </motion.div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
