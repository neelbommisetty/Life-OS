"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search } from "lucide-react";
import { listArchivedTasks } from "@/lib/tasks/actions";
import { type TaskWithProject } from "../task-card";
import { cn } from "@/lib/utils";
import { toastApiError } from "@/lib/api/error-toast";
import Link from "next/link";
// We might need a separate permanent delete action or reuse the soft delete (which would just update timestamp if we wanted)
// But typically "archive" implies soft deleted.
// For now let's just display them.

export function ArchiveClient() {
  const [archivedTasks, setArchivedTasks] = useState<TaskWithProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      // The backend handles auto-archiving, so we just need to list archived tasks
      const archivedResult = await listArchivedTasks();
      setArchivedTasks(archivedResult);
    } catch (error) {
      toastApiError(error, "Failed to load archived tasks");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Filter archived tasks by search term on the client side since listArchivedTasks doesn't support search yet
  const filteredTasks = archivedTasks.filter(task => 
    search ? task.title.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/tasks">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Archived Tasks</h1>
            <p className="text-muted-foreground mt-1">
              View completed and deleted tasks
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search archive..."
            className="pl-9 w-[200px]"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">No archived tasks found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredTasks.map((task) => (
            <Card key={task.id} className="opacity-75 hover:opacity-100 transition-opacity">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    task.deletedAt ? "bg-red-400" : "bg-green-400"
                  )} />
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold line-through text-muted-foreground truncate">
                        {task.title}
                      </h3>
                      {task.project && (
                        <Badge variant="outline" className="text-xs shrink-0">
                          {task.project.name}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {task.deletedAt 
                        ? `Deleted ${new Date(task.deletedAt).toLocaleDateString()}` 
                        : `Done ${new Date(task.updatedAt).toLocaleDateString()}`
                      }
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
