'use client';

import { motion } from 'framer-motion';
import { Layers, Play, Lightbulb, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  total: number;
  inProgress: number;
  ideas: number;
  completed: number;
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

export function StatsCards({ total, inProgress, ideas, completed }: Props) {
  const stats = [
    {
      label: 'Total Projects',
      value: total,
      icon: Layers,
      color: 'text-foreground',
      bg: 'bg-muted/50',
    },
    {
      label: 'In Progress',
      value: inProgress,
      icon: Play,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-900/10',
    },
    {
      label: 'Ideas',
      value: ideas,
      icon: Lightbulb,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-900/10',
    },
    {
      label: 'Completed',
      value: completed,
      icon: CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-900/10',
    },
  ];

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 gap-4 sm:grid-cols-4"
    >
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          variants={item}
          className={cn(
            "flex flex-col rounded-xl border border-border p-4 transition-colors",
            stat.bg
          )}
        >
          <div className="flex items-center gap-2">
            <stat.icon className={cn("h-4 w-4", stat.color)} />
            <p className="text-xs font-medium text-muted-foreground">
              {stat.label}
            </p>
          </div>
          <p className={cn("mt-2 text-2xl font-bold", stat.color)}>
            {stat.value}
          </p>
        </motion.div>
      ))}
    </motion.div>
  );
}

