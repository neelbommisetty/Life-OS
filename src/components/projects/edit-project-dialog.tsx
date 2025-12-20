'use client';

import { Dialog, DialogPanel, DialogTitle, Disclosure, Menu, Transition } from '@headlessui/react';
import type { Project } from '@prisma/client';
import { Fragment, useMemo, useState } from 'react';
import { priorityEnum } from '@/lib/validations/project';
import { api } from '@/trpc/client';
import { ProjectColorPicker } from './project-color-picker';
import { ProjectEmojiPicker } from './project-emoji-picker';
import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/project-utils';
import {
  AlertOctagon,
  Archive,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckCircle,
  ChevronDown,
  Clock,
  Hash,
  Lightbulb,
  Minus,
  Play,
  Rocket,
  Tag,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProjectTheme } from '@/lib/project-theme';

type Props = {
  project: Project;
};

const STATUS_ICONS = {
  IDEA: Lightbulb,
  IN_PROGRESS: Play,
  MVP: Rocket,
  COMPLETE: CheckCircle,
  ARCHIVE: Archive,
  DEFER: Clock,
  NOT_INTERESTED: XCircle,
};

const PRIORITY_ICONS = {
  LOW: ArrowDown,
  MEDIUM: Minus,
  HIGH: ArrowUp,
  URGENT: AlertOctagon,
};

export function EditProjectDialog({ project }: Props) {
  const [open, setOpen] = useState(false);
  const utils = api.useContext();
  const initialFormState = useMemo(
    () => ({
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      priority: project.priority ?? '',
      tags: project.tags?.join(', ') ?? '',
      dueDate: project.dueDate
        ? new Date(project.dueDate).toISOString().slice(0, 10)
        : '',
      color: project.color ?? '',
      icon: project.icon ?? '',
    }),
    [project]
  );

  const [form, setForm] = useState(initialFormState);

  const { mutateAsync, isPending, error } = api.project.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.project.list.invalidate(),
        utils.project.getById.invalidate({ id: project.id }),
      ]);
      close();
    },
  });

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags
      ? form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    await mutateAsync({
      id: project.id,
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      priority: form.priority || undefined,
      tags,
      color: form.color || undefined,
      icon: form.icon || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
    });
  };

  const close = () => {
    setOpen(false);
    setForm(initialFormState);
  };

  const accentStyle = useMemo(() => getProjectTheme(form.color), [form.color]);

  const priorityOptions = useMemo(
    () =>
      priorityEnum.options.map((priority) => {
        const Icon = PRIORITY_ICONS[priority as keyof typeof PRIORITY_ICONS];
        return {
          value: priority,
          label: PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS],
          Icon,
        };
      }),
    []
  );

  const primaryStatuses = useMemo(
    () => ["IDEA", "IN_PROGRESS", "MVP", "COMPLETE"] as const,
    []
  );

  const moreStatuses = useMemo(
    () => ["ARCHIVE", "DEFER", "NOT_INTERESTED"] as const,
    []
  );

  const tagList = useMemo(() => {
    const tags = form.tags
      ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    return Array.from(new Set(tags));
  }, [form.tags]);

  const removeTag = (tag: string) => {
    const remaining = tagList.filter((t) => t !== tag);
    handleChange('tags', remaining.join(', '));
  };

  return (
    <>
      <button
        onClick={() => {
          setForm(initialFormState);
          setOpen(true);
        }}
        className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:bg-muted"
      >
        Edit
      </button>

      <Transition show={open} appear>
        <Dialog className="relative z-50" onClose={() => close()}>
          <Transition.Child
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center md:p-6">
            <Transition.Child
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={cn(
                  "w-full max-w-xl overflow-hidden rounded-3xl border bg-card/95 text-foreground shadow-2xl",
                  form.color ? "border-[rgb(var(--project-accent)/0.35)]" : "border-border/60"
                )}
                style={accentStyle}
              >
                <form onSubmit={handleSubmit} className="relative">
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0",
                      form.color
                        ? "bg-gradient-to-br from-[rgb(var(--project-accent)/0.18)] via-background/80 to-background"
                        : "bg-gradient-to-br from-primary/10 via-background/80 to-background"
                    )}
                    aria-hidden
                  />

                  <div className="relative space-y-5 p-6">
                    <div className="flex items-start justify-between gap-3">
                      <DialogTitle className="text-lg font-semibold text-foreground">Edit project</DialogTitle>
                      <button
                        type="button"
                        onClick={close}
                        className="rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground shadow-sm transition hover:scale-105 hover:text-foreground"
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <ProjectEmojiPicker
                        value={form.icon}
                        onChange={(val) => handleChange('icon', val)}
                        className="h-12 w-12"
                        compact
                      />
                      <div className="min-w-0 flex-1">
                        <input
                          required
                          value={form.name}
                          onChange={(e) => handleChange('name', e.target.value)}
                          className={cn(
                            "h-12 w-full rounded-2xl border bg-background/70 px-4 text-base font-medium text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                            form.color ? "border-[rgb(var(--project-accent)/0.25)]" : "border-border/70"
                          )}
                          placeholder="Project name"
                        />
                      </div>
                      <ProjectColorPicker
                        value={form.color}
                        onChange={(val) => handleChange('color', val)}
                        className="h-12 w-12"
                        compact
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Status
                        </label>
                        <Menu as="div" className="relative">
                          <Menu.Button className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground">
                            More
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Menu.Button>
                          <Transition
                            as={Fragment}
                            enter="transition ease-out duration-100"
                            enterFrom="opacity-0 translate-y-1"
                            enterTo="opacity-100 translate-y-0"
                            leave="transition ease-in duration-75"
                            leaveFrom="opacity-100 translate-y-0"
                            leaveTo="opacity-0 translate-y-1"
                          >
                            <Menu.Items className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1 text-left shadow-xl focus:outline-none">
                              {moreStatuses.map((status) => {
                                const Icon = STATUS_ICONS[status as keyof typeof STATUS_ICONS];
                                const label = STATUS_LABELS[status as keyof typeof STATUS_LABELS];
                                const isSelected = form.status === status;
                                return (
                                  <Menu.Item key={status}>
                                    {({ active }) => (
                                      <button
                                        type="button"
                                        onClick={() => handleChange('status', status)}
                                        className={cn(
                                          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
                                          active ? "bg-accent text-accent-foreground" : "text-popover-foreground",
                                          isSelected ? "font-semibold" : "font-medium"
                                        )}
                                      >
                                        <Icon className="h-4 w-4" />
                                        <span className="flex-1">{label}</span>
                                        {isSelected ? (
                                          <span className="text-xs text-muted-foreground">(current)</span>
                                        ) : null}
                                      </button>
                                    )}
                                  </Menu.Item>
                                );
                              })}
                            </Menu.Items>
                          </Transition>
                        </Menu>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {primaryStatuses.map((status) => {
                          const Icon = STATUS_ICONS[status as keyof typeof STATUS_ICONS];
                          const label = STATUS_LABELS[status as keyof typeof STATUS_LABELS];
                          const selected = form.status === status;
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() => handleChange('status', status)}
                              className={cn(
                                "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
                                selected
                                  ? "border-primary/50 bg-primary/10 text-foreground shadow-sm"
                                  : "border-border/70 bg-card/70 text-muted-foreground hover:border-border hover:text-foreground"
                              )}
                              aria-pressed={selected}
                            >
                              <Icon className="h-4 w-4" />
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Description
                      </label>
                      <textarea
                        autoFocus
                        value={form.description}
                        onChange={(e) => handleChange('description', e.target.value)}
                        className={cn(
                          "w-full rounded-2xl border bg-background/70 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 min-h-[160px]",
                          form.color ? "border-[rgb(var(--project-accent)/0.25)]" : "border-border/70"
                        )}
                        placeholder="What’s the goal, scope, and what “done” looks like?"
                        rows={6}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tags
                      </label>
                      <div className="relative">
                        <Tag className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <input
                          value={form.tags}
                          onChange={(e) => handleChange('tags', e.target.value)}
                          className={cn(
                            "h-11 w-full rounded-2xl border bg-background/70 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                            form.color ? "border-[rgb(var(--project-accent)/0.25)]" : "border-border/70"
                          )}
                          placeholder="ui, infra, client-x (comma separated)"
                        />
                      </div>
                      {tagList.length ? (
                        <div className="flex flex-wrap gap-2">
                          {tagList.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => removeTag(tag)}
                              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground transition hover:border-border hover:text-foreground"
                              title="Remove tag"
                            >
                              <Hash className="h-3.5 w-3.5" />
                              {tag}
                              <X className="h-3.5 w-3.5" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <Disclosure
                      as="div"
                      className="rounded-2xl border border-border/60 bg-background/60 shadow-inner"
                      defaultOpen={Boolean(form.priority || form.dueDate)}
                    >
                      {({ open: advancedOpen }) => (
                        <>
                          <Disclosure.Button className="flex w-full items-center justify-between px-4 py-3 text-left">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Advanced</p>
                              <p className="text-xs text-muted-foreground">Priority and due date (optional)</p>
                            </div>
                            <ChevronDown
                              className={cn(
                                "h-5 w-5 text-muted-foreground transition",
                                advancedOpen ? "rotate-180" : ""
                              )}
                            />
                          </Disclosure.Button>
                          <Disclosure.Panel className="space-y-4 px-4 pb-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <span>Priority (optional)</span>
                                {form.priority ? (
                                  <button
                                    type="button"
                                    onClick={() => handleChange('priority', '')}
                                    className="text-[11px] text-muted-foreground hover:text-foreground"
                                  >
                                    Clear
                                  </button>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {priorityOptions.map(({ value, label, Icon }) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => handleChange('priority', value)}
                                    className={cn(
                                      "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition",
                                      form.priority === value
                                        ? "border-primary/50 bg-primary/10 text-foreground shadow-sm"
                                        : "border-border/70 bg-card/70 text-muted-foreground hover:border-border hover:text-foreground"
                                    )}
                                    aria-pressed={form.priority === value}
                                  >
                                    <Icon className="h-4 w-4" />
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Due date
                              </label>
                              <div className="relative">
                                <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <input
                                  type="date"
                                  value={form.dueDate}
                                  onChange={(e) => handleChange('dueDate', e.target.value)}
                                  className={cn(
                                    "h-11 w-full rounded-2xl border bg-background/70 pl-10 pr-3 text-sm text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                                    form.color ? "border-[rgb(var(--project-accent)/0.25)]" : "border-border/70"
                                  )}
                                />
                              </div>
                            </div>
                          </Disclosure.Panel>
                        </>
                      )}
                    </Disclosure>

                    {error ? (
                      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive shadow-sm">
                        {error.message}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={close}
                        className="rounded-full border border-border/80 bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:-translate-y-0.5 hover:border-border hover:shadow-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition hover:-translate-y-0.5 hover:bg-primary/90 disabled:translate-y-0 disabled:opacity-70"
                      >
                        {isPending ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </div>
                </form>
              </DialogPanel>
            </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
