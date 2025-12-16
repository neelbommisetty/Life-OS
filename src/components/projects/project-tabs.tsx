'use client';

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Fragment } from 'react';
import { getProjectTheme } from '@/lib/project-theme';

type Props = {
  overview: ReactNode;
  tasks: ReactNode;
  brainstorm: ReactNode;
  artifacts: ReactNode;
  accentColor?: string | null;
};

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'brainstorm', label: 'Brainstorm' },
  { key: 'artifacts', label: 'Artifacts' },
];

export function ProjectTabs({ overview, tasks, brainstorm, artifacts, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasColor = !!accentColor;

  return (
    <TabGroup>
      <TabList
        className="relative flex w-full border-b border-border bg-background"
        style={themeStyle}
      >
        {tabs.map((tab) => (
          <Tab as={Fragment} key={tab.key}>
            {({ selected }) => (
              <button
                className={cn(
                  "relative px-4 py-3 text-sm font-medium transition-colors focus:outline-none",
                  selected
                    ? (hasColor ? "text-[rgb(var(--project-accent))]" : "text-primary")
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                {selected && (
                  <motion.div
                    layoutId="activeTab"
                    className={cn(
                      "absolute bottom-0 left-0 right-0 h-0.5",
                      hasColor ? "bg-[rgb(var(--project-accent))]" : "bg-primary"
                    )}
                  />
                )}
              </button>
            )}
          </Tab>
        ))}
      </TabList>
      <TabPanels className="mt-6">
        <TabPanel className="focus:outline-none">{overview}</TabPanel>
        <TabPanel className="focus:outline-none">{tasks}</TabPanel>
        <TabPanel className="focus:outline-none">{brainstorm}</TabPanel>
        <TabPanel className="focus:outline-none">{artifacts}</TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
