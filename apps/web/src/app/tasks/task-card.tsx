"use client";

import { useDrag } from "react-dnd";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectBadge } from "@/components/projects/project-badge";
import type { Task, Project, Priority, TaskStatus } from "@life-os/db";
import { getTaskCardActionLabels } from "./task-card-copy";
import { getTaskMoveOptions } from "./task-move-options";

export type TaskWithProject = Task & { project: Project | null };

interface TaskCardProps {
  task: TaskWithProject;
  onEdit: (task: TaskWithProject) => void;
  onDelete: (task: TaskWithProject) => void;
  onMove: (taskId: string, newStatus: TaskStatus) => void;
}

const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-100",
  MEDIUM: "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-100",
  HIGH: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-100",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

function formatDateDisplay(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function TaskCard({ task, onEdit, onDelete, onMove }: TaskCardProps) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "TASK",
    item: { id: task.id, status: task.status },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }));
  const actionLabels = getTaskCardActionLabels(task.title);
  const moveOptions = getTaskMoveOptions(task.status);

  return (
    <div
      ref={drag as unknown as React.Ref<HTMLDivElement>}
      className={cn(
        "touch-none",
        isDragging ? "opacity-50" : "opacity-100"
      )}
    >
      <Card
        className={cn(
          "mb-3 overflow-hidden border-l-4 transition-shadow hover:border-primary/50 hover:shadow-md",
          task.status === "TODO" && "border-l-blue-500",
          task.status === "IN_PROGRESS" && "border-l-yellow-500",
          task.status === "DONE" && "border-l-green-500 opacity-75"
        )}
        onClick={() => onEdit(task)}
      >
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-2">
            <h3 className={cn(
              "flex-1 text-sm font-semibold line-clamp-2",
              task.status === "DONE" && "line-through text-muted-foreground"
            )}>
              {task.title}
            </h3>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge className={cn("text-[10px] px-1.5 py-0.5 h-5", PRIORITY_COLORS[task.priority])}>
              {PRIORITY_LABELS[task.priority]}
            </Badge>
            {task.project && (
              <ProjectBadge
                projectId={task.project.id}
                projectName={task.project.name}
                className="text-[10px] px-1.5 py-0.5 h-5"
              />
            )}
          </div>

          {task.dueDate && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{formatDateDisplay(task.dueDate)}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="xs"
              className="flex-1 rounded-full"
              aria-label={actionLabels.edit}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
            >
              <Pencil className="h-3 w-3" />
              <span>{actionLabels.editCta}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full"
                  aria-label={actionLabels.move}
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <span>{actionLabels.moveCta}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <DropdownMenuLabel>Move task</DropdownMenuLabel>
                {moveOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.status}
                    onSelect={() => {
                      onMove(task.id, option.status);
                    }}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    onDelete(task);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
