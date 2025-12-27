'use client';

import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getProjectTheme } from '@/lib/project-theme';
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
import { pushUrl, replaceUrl } from '@/lib/url-state';

type Props = {
  overview: ReactNode;
  tasks: ReactNode;
  chat: ReactNode;
  artifacts: ReactNode;
  accentColor?: string | null;
};

export function ProjectTabs({
  overview,
  tasks,
  chat,
  artifacts,
  accentColor,
}: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const hasColor = !!accentColor;
  const params = useParams();
  const projectId = typeof params.id === 'string' ? params.id : params.id?.[0] ?? '';
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = getProjectTabKeyFromPathname(pathname);

  const tabIndexByKey = useMemo(() => {
    return projectTabs.reduce<Record<ProjectTabKey, number>>((acc, tab, index) => {
      acc[tab.key] = index;
      return acc;
    }, {} as Record<ProjectTabKey, number>);
  }, []);

  const selectedKey = useMemo(() => resolveProjectTabKey(tabParam), [tabParam]);
  const selectedIndex = useMemo(() => {
    return tabIndexByKey[selectedKey] ?? tabIndexByKey[defaultProjectTabKey];
  }, [tabIndexByKey, selectedKey]);

  const lastTrackedKey = useRef<ProjectTabKey | null>(null);

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
                  "relative px-4 py-3 text-sm font-medium transition-colors focus:outline-none flex items-center gap-1.5",
                  selected
                    ? (hasColor ? "text-[rgb(var(--project-accent))]" : "text-primary")
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                {tab.key === 'chat' && (
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none",
                    selected
                      ? (hasColor ? "bg-[rgb(var(--project-accent))/0.1] text-[rgb(var(--project-accent))]" : "bg-primary/10 text-primary")
                      : "bg-muted text-muted-foreground"
                  )}>
                    AI
                  </span>
                )}
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

      <AnimatePresence mode="wait">
        <TabPanels as={Fragment}>
          <TabPanel static className="focus:outline-none">
            {selectedKey === 'overview' && (
              <motion.div
                key="overview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="mt-6"
              >
                {overview}
              </motion.div>
            )}
          </TabPanel>
          <TabPanel static className="focus:outline-none">
            {selectedKey === 'tasks' && (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="mt-6"
              >
                {tasks}
              </motion.div>
            )}
          </TabPanel>
          <TabPanel static className="focus:outline-none">
            {selectedKey === 'chat' && (
              <motion.div
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="mt-6"
              >
                {chat}
              </motion.div>
            )}
          </TabPanel>
          <TabPanel static className="focus:outline-none">
            {selectedKey === 'artifacts' && (
              <motion.div
                key="artifacts"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="mt-6"
              >
                {artifacts}
              </motion.div>
            )}
          </TabPanel>
        </TabPanels>
      </AnimatePresence>
    </TabGroup>
  );
}
