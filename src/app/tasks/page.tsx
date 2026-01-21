import { redirect } from "next/navigation";
import { authServer } from "@/lib/auth/server";
import { TasksClient } from "./tasks-client";

export default async function TasksPage() {
  const { data: session } = await authServer.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  return <TasksClient />;
}
