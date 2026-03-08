import type { ChatThread, Note, Task } from "@life-os/db";
import { brand } from "@/lib/brand";

type ProjectOverviewCountsInput = {
  chatThreads: ChatThread[];
  notes: Note[];
  tasks: Task[];
};

export function getProjectOverviewStats({
  chatThreads,
  notes,
  tasks,
}: ProjectOverviewCountsInput) {
  const openTaskCount = tasks.filter((task) => task.status !== "DONE").length;

  return [
    {
      label: brand.terms.assistant,
      value: chatThreads.length,
      detail:
        chatThreads.length === 1
          ? "1 conversation in this project"
          : `${chatThreads.length} conversations in this project`,
    },
    {
      label: "Open tasks",
      value: openTaskCount,
      detail:
        openTaskCount === 1
          ? "1 task still in progress"
          : `${openTaskCount} tasks still in progress`,
    },
    {
      label: brand.terms.library,
      value: notes.length,
      detail:
        notes.length === 1
          ? "1 note saved in this project"
          : `${notes.length} notes saved in this project`,
    },
  ];
}
