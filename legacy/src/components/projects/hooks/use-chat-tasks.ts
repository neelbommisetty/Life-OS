import { api } from "@/trpc/client";
import type { ProposedTask } from "@/lib/chat-utils";

type UseChatTasksParams = {
  projectId: string;
  threadId: string | null;
  pageSize: number;
};

export function useChatTasks({ projectId, threadId, pageSize }: UseChatTasksParams) {
  const utils = api.useUtils();

  const createTaskFromChatMutation = api.chat.createTaskFromChat.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate({ projectId });
      if (threadId) {
        utils.chat.listMessages.invalidate({
          projectId,
          threadId,
          limit: pageSize,
        });
      }
    },
  });

  const createTasksFromChatMutation = api.chat.createTasksFromChat.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate({ projectId });
      if (threadId) {
        utils.chat.listMessages.invalidate({
          projectId,
          threadId,
          limit: pageSize,
        });
      }
    },
  });

  const handleApproveTask = (messageId: string, task: ProposedTask) => {
    createTaskFromChatMutation.mutate({
      messageId,
      task: {
        projectId,
        title: task.title,
        description: task.description,
        status: task.status ?? "BACKLOG",
        priority: task.priority ?? "MEDIUM",
        dueDate: task.dueDate
          ? new Date(task.dueDate).toISOString()
          : undefined,
      },
    });
  };

  const handleApproveAll = (messageId: string, tasks: ProposedTask[]) => {
    if (!tasks || tasks.length === 0) return;
    createTasksFromChatMutation.mutate({
      messageId,
      tasks: {
        projectId,
        tasks: tasks.map((t) => ({
          ...t,
          status: t.status ?? "BACKLOG",
          priority: t.priority ?? "MEDIUM",
          dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : undefined,
        })),
      },
    });
  };

  return {
    handleApproveTask,
    handleApproveAll,
    isPending:
      createTaskFromChatMutation.isPending ||
      createTasksFromChatMutation.isPending,
  };
}
