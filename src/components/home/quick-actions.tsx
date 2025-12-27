'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ListTodo, MessageSquarePlus } from 'lucide-react';
import { CreateProjectDialog } from '@/components/projects/create-project-dialog';

export function QuickActions() {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const item = {
    hidden: { opacity: 0, scale: 0.95 },
    show: { opacity: 1, scale: 1 }
  };

  return (
    <div className="mb-10">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Quick Actions
      </h2>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <motion.div variants={item}>
          <CreateProjectDialog />
        </motion.div>

        <motion.div variants={item}>
          <Link
            href="/projects"
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-purple-600 dark:text-purple-400 group-hover:bg-purple-50 dark:group-hover:bg-purple-900/20">
              <ListTodo className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold text-foreground">View All Tasks</span>
          </Link>
        </motion.div>

        <motion.div variants={item}>
          <Link
            href="/projects"
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/20 hover:shadow-sm group"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/20">
              <MessageSquarePlus className="h-5 w-5" />
            </div>
            <span className="text-sm font-semibold text-foreground">Quick Brainstorm</span>
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
