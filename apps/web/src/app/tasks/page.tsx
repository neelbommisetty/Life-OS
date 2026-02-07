import { TasksClient } from "./tasks-client";
import { listTasks } from "@/lib/tasks/actions";
import { Suspense } from "react";
import { TasksSkeleton } from "./tasks-skeleton";
import { requireApiSessionUser } from "@/lib/api/session";

export default async function TasksPage() {
  await requireApiSessionUser();

  // Pre-fetch tasks on the server
  const tasks = await listTasks();

  return (
    <Suspense fallback={<TasksSkeleton />}>
      <TasksClient initialTasks={tasks} />
    </Suspense>
  );
}
