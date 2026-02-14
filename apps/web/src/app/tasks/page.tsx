import type { Metadata } from "next";
import { TasksClient } from "./tasks-client";
import { listTasks } from "@/lib/tasks/actions";
import { Suspense } from "react";
import { TasksSkeleton } from "./tasks-skeleton";
import { requireApiSessionUser } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Tasks",
  description: "Track tasks and deadlines, with strong defaults.",
};

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
