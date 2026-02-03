import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import { TasksClient } from "./tasks-client";
import { listTasks } from "@/lib/tasks/actions";
import { Suspense } from "react";
import { TasksSkeleton } from "./tasks-skeleton";

export default async function TasksPage() {
  const { data: session } = await authServer.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  // Pre-fetch tasks on the server
  const tasks = await listTasks();

  return (
    <Suspense fallback={<TasksSkeleton />}>
      <TasksClient initialTasks={tasks} />
    </Suspense>
  );
}
