import type { TaskWithProject } from "./task-card";

type SelectDisplayedTasksInput = {
  fetchedTasks: TaskWithProject[];
};

export function selectDisplayedTasks({
  fetchedTasks,
}: SelectDisplayedTasksInput): TaskWithProject[] {
  return fetchedTasks;
}
