'use client';

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { getProjectTheme } from '@/lib/project-theme';
import { useParams } from 'next/navigation';
import {
  buildProjectTabUrl,
  defaultProjectTabKey,
  getProjectTabKeyFromPathname,
  normalizeProjectTabKey,
  projectTabs,
  resolveProjectTabKey,
  type ProjectTabKey,
} from '@/lib/project-tabs';
import { trackEvent } from '@/lib/analytics';
import { pushUrl, replaceUrl, useUrlState } from '@/lib/url-state';

type Props = {
  overview: ReactNode;
  tasks: ReactNode;
  artifacts: ReactNode;
  accentColor?: string | null;
};

export function ProjectTabs({ overview, tasks, artifacts, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasColor = !!accentColor;
  const params = useParams();
  const projectId = typeof params.id === 'string' ? params.id : params.id?.[0] ?? '';
  const urlState = useUrlState();
  const tabParam = getProjectTabKeyFromPathname(urlState.pathname);
  const searchParams = useMemo(() => new URLSearchParams(urlState.search), [urlState.search]);

  const tabIndexByKey = useMemo(() => {
    return projectTabs.reduce<Record<ProjectTabKey, number>>((acc, tab, index) => {
      acc[tab.key] = index;
      return acc;
    }, {} as Record<ProjectTabKey, number>);
  }, []);

  const selectedIndex = useMemo(() => {
    const initialKey = resolveProjectTabKey(tabParam);
    return tabIndexByKey[initialKey] ?? tabIndexByKey[defaultProjectTabKey];
  }, [tabIndexByKey, tabParam]);

  const lastTrackedKey = useRef<ProjectTabKey | null>(null);

  const selectedKey = projectTabs[selectedIndex]?.key ?? defaultProjectTabKey;

  useEffect(() => {
    if (!projectId) {
      return;
    }
    const normalizedTab = normalizeProjectTabKey(tabParam);
    if (!normalizedTab) {
      const nextUrl = buildProjectTabUrl(projectId, searchParams, defaultProjectTabKey);
      replaceUrl(nextUrl);
    }
  }, [projectId, searchParams, tabParam]);

  useEffect(() => {
    if (lastTrackedKey.current === selectedKey) {
      return;
    }
    lastTrackedKey.current = selectedKey;
    trackEvent('project_tab_opened', { tab: selectedKey });
  }, [selectedKey]);

  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={(index) => {
        const nextKey = projectTabs[index]?.key ?? defaultProjectTabKey;
        if (nextKey !== selectedKey) {
          const nextUrl = buildProjectTabUrl(projectId, searchParams, nextKey);
          pushUrl(nextUrl);
        }
      }}
    >
      <TabList
        className="relative flex w-full border-b border-border bg-background"
        style={themeStyle}
      >
        {projectTabs.map((tab) => (
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
        <TabPanel className="focus:outline-none">{artifacts}</TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
