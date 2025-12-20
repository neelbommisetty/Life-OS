"use client";

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Disclosure,
  Transition,
} from "@headlessui/react";
import { Fragment, useMemo, useState } from "react";
import { api } from "@/trpc/client";
import { projectStatusEnum, priorityEnum } from "@/lib/validations/project";
import type { z } from "zod";
import {
  Plus,
  X,
  Calendar,
  Hash,
  Lightbulb,
  ArrowDown,
  Minus,
  ArrowUp,
  AlertOctagon,
  ChevronDown,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITY_LABELS } from "@/lib/project-utils";
import { ProjectColorPicker } from "./project-color-picker";
import { ProjectEmojiPicker } from "./project-emoji-picker";
import { getProjectTheme } from "@/lib/project-theme";

const STATUS_ICONS = {
  IDEA: Lightbulb,
};

const PRIORITY_ICONS = {
  LOW: ArrowDown,
  MEDIUM: Minus,
  HIGH: ArrowUp,
  URGENT: AlertOctagon,
};

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const utils = api.useContext();

  const initialFormState = {
    name: "",
    description: "",
    priority: "",
    tags: "",
    dueDate: "",
    color: "",
    icon: "",
  };

  const [form, setForm] = useState(initialFormState);

  const { mutateAsync, isPending, error } = api.project.create.useMutation({
    onSuccess: async () => {
      await utils.project.list.invalidate();
      close();
    },
  });

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const close = () => {
    setOpen(false);
    setForm(initialFormState);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags
      ? form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    await mutateAsync({
      name: form.name,
      description: form.description || undefined,
      status: projectStatusEnum.options[0],
      priority:
        form.priority &&
        priorityEnum.options.includes(
          form.priority as z.infer<typeof priorityEnum>
        )
          ? (form.priority as z.infer<typeof priorityEnum>)
          : undefined,
      tags,
      color: form.color || undefined,
      icon: form.icon || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
    });
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

  const tagList = useMemo(() => {
    const tags = form.tags
      ? form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    return Array.from(new Set(tags));
  }, [form.tags]);

  const removeTag = (tag: string) => {
    const remaining = tagList.filter((t) => t !== tag);
    handleChange("tags", remaining.join(", "));
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Create Project
      </button>

      <Transition show={open} as={Fragment}>
        <Dialog className="relative z-50" onClose={() => close()}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center md:p-6">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel
                  className={cn(
                    "w-full max-w-xl overflow-hidden rounded-3xl border bg-card/95 text-left align-middle shadow-2xl transition-all",
                    form.color
                      ? "border-[rgb(var(--project-accent)/0.35)]"
                      : "border-border/60"
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
                        <div className="space-y-1">
                          <DialogTitle className="text-lg font-semibold text-foreground">
                            New project
                          </DialogTitle>
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-xs text-muted-foreground">
                            <STATUS_ICONS.IDEA className="h-3.5 w-3.5" />
                            Starts in Idea
                          </div>
                        </div>
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
                          onChange={(val) => handleChange("icon", val)}
                          className="h-12 w-12"
                          compact
                        />
                        <div className="min-w-0 flex-1">
                          <input
                            required
                            autoFocus
                            value={form.name}
                            onChange={(e) =>
                              handleChange("name", e.target.value)
                            }
                            className={cn(
                              "h-12 w-full rounded-2xl border bg-background/70 px-4 text-base font-medium text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                              form.color
                                ? "border-[rgb(var(--project-accent)/0.25)]"
                                : "border-border/70"
                            )}
                            placeholder="Project name"
                          />
                        </div>
                        <ProjectColorPicker
                          value={form.color}
                          onChange={(val) => handleChange("color", val)}
                          className="h-12 w-12"
                          compact
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Description
                        </label>
                        <textarea
                          value={form.description}
                          onChange={(e) =>
                            handleChange("description", e.target.value)
                          }
                          className={cn(
                            "w-full rounded-2xl border bg-background/70 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 min-h-[160px]",
                            form.color
                              ? "border-[rgb(var(--project-accent)/0.25)]"
                              : "border-border/70"
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
                            onChange={(e) =>
                              handleChange("tags", e.target.value)
                            }
                            className={cn(
                              "h-11 w-full rounded-2xl border bg-background/70 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                              form.color
                                ? "border-[rgb(var(--project-accent)/0.25)]"
                                : "border-border/70"
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
                      >
                        {({ open: advancedOpen }) => (
                          <>
                            <Disclosure.Button className="flex w-full items-center justify-between px-4 py-3 text-left">
                              <div>
                                <p className="text-sm font-semibold text-foreground">
                                  Advanced
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Priority and due date (optional)
                                </p>
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
                                      onClick={() =>
                                        handleChange("priority", "")
                                      }
                                      className="text-[11px] text-muted-foreground hover:text-foreground"
                                    >
                                      Clear
                                    </button>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {priorityOptions.map(
                                    ({ value, label, Icon }) => (
                                      <button
                                        key={value}
                                        type="button"
                                        onClick={() =>
                                          handleChange("priority", value)
                                        }
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
                                    )
                                  )}
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
                                    onChange={(e) =>
                                      handleChange("dueDate", e.target.value)
                                    }
                                    className={cn(
                                      "h-11 w-full rounded-2xl border bg-background/70 pl-10 pr-3 text-sm text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30",
                                      form.color
                                        ? "border-[rgb(var(--project-accent)/0.25)]"
                                        : "border-border/70"
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
                          {isPending ? "Creating..." : "Create project"}
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
