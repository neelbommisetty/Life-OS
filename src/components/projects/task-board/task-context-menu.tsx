'use client';

import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import type { Task, TaskStatus, Priority } from '@prisma/client';
import { TASK_STATUS_LABELS, TASK_KANBAN_STATUS_ORDER } from '@/lib/task-utils';
import { PRIORITY_LABELS } from '@/lib/project-utils';
import { cn } from '@/lib/utils';
import { Edit, Trash2, ArrowRight, MoreVertical, Flag } from 'lucide-react';
import { Fragment } from 'react';

type Props = {
  task: Task;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange?: (priority: Priority) => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
};

export function TaskContextMenu({
  task,
  onStatusChange,
  onPriorityChange,
  onEdit,
  onDelete,
  children,
}: Props) {
  return (
    <Menu as="div" className="relative w-full">
      <MenuButton as="div" className="w-full" onContextMenu={(e) => {
        // We want this to trigger on right click, but Headless UI Menu usually triggers on click.
        // For a true context menu we might need a different approach or a wrapper.
        // However, for now, let's treat the card click as the trigger or add a trigger button.
        // To make it a REAL context menu, we'd need to position it at the mouse coordinates.
        // Given Headless UI v2 Menu limitations, I'll stick to a trigger button for now
        // OR use a custom context menu implementation if a real one is needed.
        // Let's use a trigger button 'MoreVertical' hidden until hover.
      }}>
        {children}
      </MenuButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <MenuItems className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-xl border border-border bg-card p-1.5 shadow-xl ring-1 ring-black/5 focus:outline-none">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Quick Actions
          </div>

          <MenuItem>
            {({ focus }) => (
              <button
                onClick={onEdit}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  focus ? "bg-muted text-foreground" : "text-muted-foreground"
                )}
              >
                <Edit className="h-4 w-4" />
                Edit Task
              </button>
            )}
          </MenuItem>

          <div className="my-1.5 h-px bg-border/60" />

          <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Move to Status
          </div>
          {TASK_KANBAN_STATUS_ORDER.filter(s => s !== task.status).map((status) => (
            <MenuItem key={status}>
              {({ focus }) => (
                <button
                  onClick={() => onStatusChange(status)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    focus ? "bg-muted text-foreground" : "text-muted-foreground"
                  )}
                >
                  <ArrowRight className="h-4 w-4 opacity-50" />
                  {TASK_STATUS_LABELS[status]}
                </button>
              )}
            </MenuItem>
          ))}

          <div className="my-1.5 h-px bg-border/60" />

          <MenuItem>
            {({ focus }) => (
              <button
                onClick={onDelete}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-500 transition-colors",
                  focus ? "bg-red-500/10" : ""
                )}
              >
                <Trash2 className="h-4 w-4" />
                Delete Task
              </button>
            )}
          </MenuItem>
        </MenuItems>
      </Transition>
    </Menu>
  );
}
