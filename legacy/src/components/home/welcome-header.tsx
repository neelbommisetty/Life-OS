'use client';

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
      <h1
        className="text-3xl font-bold tracking-tight text-foreground opacity-0 animate-slide-up"
      >
        {greeting}, maker
      </h1>
      <p
        className="mt-2 text-muted-foreground opacity-0 animate-slide-up"
        style={{ animationDelay: '100ms' }}
      >
        {nudge}
      </p>
    </div>
  );
}

