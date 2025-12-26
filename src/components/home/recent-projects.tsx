'use client';

import { ProjectCard } from '@/components/projects/project-card';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';
import type { Project } from '@prisma/client';
import { motion } from 'framer-motion';
import { FolderPlus } from 'lucide-react';
import Link from 'next/link';

type Props = {
  projects: Project[];
};

export function RecentProjects({ projects }: Props) {
  if (projects.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/20 p-16 text-center"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted/50 mb-6 group-hover:scale-110 transition-transform">
          <FolderPlus className="h-10 w-10 text-muted-foreground/50" />
        </div>
        <h3 className="text-xl font-bold text-foreground">
          Your creative space is empty
        </h3>
        <p className="mt-3 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
          Project OS is your companion for turning ideas into reality. Start by creating a project to track your goals, tasks, and AI brainstorms.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <CreateProjectDialog />
          <Link
            href="/docs/frontend_ux_review.md" // Example link to docs
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Learn how it works
          </Link>
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
