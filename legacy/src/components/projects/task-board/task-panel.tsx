import { Dialog } from '@/components/ui/native-dialog';
import { Trash2 } from 'lucide-react';
import type { TaskStatus, Priority } from '@prisma/client';
import type { TaskDraft } from './types';
import { TASK_STATUS_LABELS } from '@/lib/task-utils';

export type TaskPanelProps = {
  open: boolean;
  onClose: () => void;
  draft: TaskDraft;
  setDraft: (draft: TaskDraft) => void;
  onSave: (e: React.FormEvent) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
  statusOptions: TaskStatus[];
  priorityOptions: string[];
  priorityLabels: Record<string, string>;
};

export function TaskPanel({
  open,
  onClose,
  draft,
  setDraft,
  onSave,
  onDelete,
  isSaving,
  isDeleting,
  statusOptions,
  priorityOptions,
  priorityLabels,
}: TaskPanelProps) {
  const isEdit = draft.mode === 'edit';

  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      title={isEdit ? 'Edit task' : 'Create task'}
      description="Set details, status, and timing."
      variant="sheet"
      size="md"
    >
      <form className="flex flex-1 flex-col gap-4 h-full" onSubmit={onSave}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Title</label>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Short task summary"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Description
          </label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="What needs to get done?"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Status</label>
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Priority</label>
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Due Date</label>
          <input
            type="date"
            value={draft.dueDate}
            onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-6">
          {isEdit && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
