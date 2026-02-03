import type { TaskWithProject } from "./task-card";

type SelectDisplayedTasksInput = {
  search: string;
  initialTasks: TaskWithProject[];
  fetchedTasks: TaskWithProject[];
};

export function selectDisplayedTasks({
  search,
  initialTasks,
  fetchedTasks,
}: SelectDisplayedTasksInput): TaskWithProject[] {
  if (search) return fetchedTasks;
  if (initialTasks.length > 0) return initialTasks;
  return fetchedTasks;
}
