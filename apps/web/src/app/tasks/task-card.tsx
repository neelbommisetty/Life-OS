"use client";

import { useDrag } from "react-dnd";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectBadge } from "@/components/projects/project-badge";
import type { Task, Project, Priority } from "@prisma/client";

export type TaskWithProject = Task & { project: Project | null };

interface TaskCardProps {
  task: TaskWithProject;
  onEdit: (task: TaskWithProject) => void;
  onDelete: (task: TaskWithProject) => void;
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

export function TaskCard({ task, onEdit, onDelete }: TaskCardProps) {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "TASK",
    item: { id: task.id, status: task.status },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }));

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
          "mb-3 hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing hover:border-primary/50 overflow-hidden border-l-4",
          task.status === "TODO" && "border-l-blue-500",
          task.status === "IN_PROGRESS" && "border-l-yellow-500",
          task.status === "DONE" && "border-l-green-500 opacity-75"
        )}
        onClick={() => onEdit(task)}
      >
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className={cn(
              "font-semibold text-sm line-clamp-2",
              task.status === "DONE" && "line-through text-muted-foreground"
            )}>
              {task.title}
            </h3>
            <div className="flex gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
