'use client';

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import type { ReactNode } from 'react';

type Props = {
  overview: ReactNode;
  tasks: ReactNode;
  brainstorm: ReactNode;
  artifacts: ReactNode;
};

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'brainstorm', label: 'Brainstorm' },
  { key: 'artifacts', label: 'Artifacts' },
];

export function ProjectTabs({ overview, tasks, brainstorm, artifacts }: Props) {
  return (
    <TabGroup>
      <TabList className="flex gap-2 rounded-lg bg-muted p-1 text-sm font-semibold text-muted-foreground">
        {tabs.map((tab) => (
          <Tab
            key={tab.key}
            className="flex-1 rounded-md px-3 py-2 ui-selected:bg-card ui-selected:text-foreground ui-selected:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {tab.label}
          </Tab>
        ))}
      </TabList>
      <TabPanels className="mt-4">
        <TabPanel>{overview}</TabPanel>
        <TabPanel>{tasks}</TabPanel>
        <TabPanel>{brainstorm}</TabPanel>
        <TabPanel>{artifacts}</TabPanel>
      </TabPanels>
    </TabGroup>
  );
}

