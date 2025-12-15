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
      <TabList className="flex gap-2 rounded-lg bg-zinc-100 p-1 text-sm font-semibold text-zinc-600">
        {tabs.map((tab) => (
          <Tab
            key={tab.key}
            className="flex-1 rounded-md px-3 py-2 ui-selected:bg-white ui-selected:text-zinc-900 ui-selected:shadow-sm focus:outline-none"
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

