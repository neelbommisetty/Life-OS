'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';

type Props = {
  upcomingTaskCount?: number;
  lastEditedProject?: { id: string; name: string } | null;
};

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function WelcomeHeader({ upcomingTaskCount, lastEditedProject }: Props) {
  const greeting = useMemo(() => getTimeOfDayGreeting(), []);

  const nudge = useMemo(() => {
    if (upcomingTaskCount && upcomingTaskCount > 0) {
      return `You have ${upcomingTaskCount} task${upcomingTaskCount !== 1 ? 's' : ''} due this week`;
    }
    if (lastEditedProject) {
      return `Ready to continue working on ${lastEditedProject.name}?`;
    }
    return 'Manage your ideas, tasks, and progress in one place.';
  }, [upcomingTaskCount, lastEditedProject]);

  return (
    <div className="mb-8">
      <motion.h1
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-bold tracking-tight text-foreground"
      >
        {greeting}, maker
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-2 text-muted-foreground"
      >
        {nudge}
      </motion.p>
    </div>
  );
}

