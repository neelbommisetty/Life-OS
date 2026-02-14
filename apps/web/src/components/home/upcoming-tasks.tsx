import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format, isBefore } from "date-fns";
import { cn } from "@/lib/utils";
import { getUpcomingTasks } from "@/lib/home/actions";

export async function UpcomingTasks() {
  const tasks = await getUpcomingTasks();
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">Upcoming Tasks</h2>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tasks">
            <Plus className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed space-y-2">
            <p>No tasks due soon.</p>
            <Button variant="link" className="h-auto p-0 text-muted-foreground" asChild>
              <Link href="/tasks">Add a task</Link>
            </Button>
          </div>
        ) : (
          tasks.map((task) => (
            <Card key={task.id} className="p-4 flex items-center gap-4 hover:bg-secondary/5 transition-colors">
              <div className="shrink-0">
                <Circle className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{task.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  {task.project && (
                    <span className="text-primary/80">{task.project.name}</span>
                  )}
                  {task.project && <span>•</span>}
                  {task.dueDate ? (
                    <span className={cn(isBefore(task.dueDate, now) && "text-destructive font-medium")}>
                      {format(task.dueDate, "MMM d, h:mm a")}
                    </span>
                  ) : (
                    <span>No deadline</span>
                  )}
                </div>
              </div>
              <Badge variant={task.priority === "HIGH" ? "destructive" : task.priority === "MEDIUM" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0.5 uppercase">
                {task.priority}
              </Badge>
            </Card>
          ))
        )}
        <Button variant="link" className="w-full text-muted-foreground" asChild>
          <Link href="/tasks">View all</Link>
        </Button>
      </div>
    </div>
  );
}
