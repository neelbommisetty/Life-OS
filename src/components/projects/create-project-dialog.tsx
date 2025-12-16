'use client';

import { Dialog, DialogPanel, DialogTitle, Transition, Listbox } from '@headlessui/react';
import { useState, Fragment } from 'react';
import { api } from '@/trpc/client';
import { projectStatusEnum, priorityEnum } from '@/lib/validations/project';
import {
  Plus, X, Calendar, Hash,
  Lightbulb, Play, Rocket, CheckCircle, Archive, Clock, XCircle,
  ArrowDown, Minus, ArrowUp, AlertOctagon, Check, ChevronsUpDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, PRIORITY_LABELS } from '@/lib/project-utils';
import { ProjectColorPicker } from './project-color-picker';
import { ProjectEmojiPicker } from './project-emoji-picker';

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

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const utils = api.useContext();

  const initialFormState = {
    name: '',
    description: '',
    status: projectStatusEnum.options[0], // IDEA
    priority: priorityEnum.options[1], // MEDIUM
    tags: '',
    dueDate: '',
    color: '',
    icon: '',
  };

  const [form, setForm] = useState(initialFormState);

  const { mutateAsync, isPending, error } = api.project.create.useMutation({
    onSuccess: async () => {
      await utils.project.list.invalidate();
      setOpen(false);
      setForm(initialFormState);
    },
  });

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tags = form.tags
      ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    await mutateAsync({
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      priority: form.priority,
      tags,
      color: form.color || undefined,
      icon: form.icon || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
    });
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
        <Dialog className="relative z-50" onClose={() => setOpen(false)}>
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
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-2xl transform rounded-2xl border border-border bg-card p-6 text-left align-middle shadow-xl transition-all">
                  <div className="flex items-center justify-between mb-6">
                    <DialogTitle className="text-xl font-semibold leading-6 text-foreground">
                      Create New Project
                    </DialogTitle>
                    <button
                      onClick={() => setOpen(false)}
                      className="rounded-full p-1 text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Main Info */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Name
                        </label>
                        <input
                          required
                          autoFocus
                          value={form.name}
                          onChange={(e) => handleChange('name', e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          placeholder="What are you building?"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                          Description
                        </label>
                        <textarea
                          value={form.description}
                          onChange={(e) => handleChange('description', e.target.value)}
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                          placeholder="Add some details about the project..."
                          rows={3}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Status Selection */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Status</label>
                        <Listbox value={form.status} onChange={(val) => handleChange('status', val)}>
                          <div className="relative mt-1">
                            <Listbox.Button className="relative w-full cursor-default rounded-md border border-input bg-background py-2 pl-3 pr-10 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                              <span className="flex items-center gap-2 truncate">
                                {(() => {
                                  const Icon = STATUS_ICONS[form.status as keyof typeof STATUS_ICONS];
                                  return (
                                    <>
                                      <Icon className="h-4 w-4 text-muted-foreground" />
                                      {STATUS_LABELS[form.status as keyof typeof STATUS_LABELS]}
                                    </>
                                  );
                                })()}
                              </span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-popover py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                                {projectStatusEnum.options.map((status) => {
                                  const Icon = STATUS_ICONS[status as keyof typeof STATUS_ICONS];
                                  return (
                                    <Listbox.Option
                                      key={status}
                                      className={({ active }) =>
                                        `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                          active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground'
                                        }`
                                      }
                                      value={status}
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`flex items-center gap-2 truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                            <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                                            {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
                                          </span>
                                          {selected ? (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary">
                                              <Check className="h-4 w-4" aria-hidden="true" />
                                            </span>
                                          ) : null}
                                        </>
                                      )}
                                    </Listbox.Option>
                                  );
                                })}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>

                      {/* Priority Selection */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Priority</label>
                        <Listbox value={form.priority} onChange={(val) => handleChange('priority', val)}>
                          <div className="relative mt-1">
                            <Listbox.Button className="relative w-full cursor-default rounded-md border border-input bg-background py-2 pl-3 pr-10 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                              <span className="flex items-center gap-2 truncate">
                                {(() => {
                                  const Icon = PRIORITY_ICONS[form.priority as keyof typeof PRIORITY_ICONS];
                                  return (
                                    <>
                                      <Icon className="h-4 w-4 text-muted-foreground" />
                                      {PRIORITY_LABELS[form.priority as keyof typeof PRIORITY_LABELS]}
                                    </>
                                  );
                                })()}
                              </span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-popover py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
                                {priorityEnum.options.map((priority) => {
                                  const Icon = PRIORITY_ICONS[priority as keyof typeof PRIORITY_ICONS];
                                  return (
                                    <Listbox.Option
                                      key={priority}
                                      className={({ active }) =>
                                        `relative cursor-default select-none py-2 pl-10 pr-4 ${
                                          active ? 'bg-accent text-accent-foreground' : 'text-popover-foreground'
                                        }`
                                      }
                                      value={priority}
                                    >
                                      {({ selected }) => (
                                        <>
                                          <span className={`flex items-center gap-2 truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                            <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                                            {PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS]}
                                          </span>
                                          {selected ? (
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary">
                                              <Check className="h-4 w-4" aria-hidden="true" />
                                            </span>
                                          ) : null}
                                        </>
                                      )}
                                    </Listbox.Option>
                                  );
                                })}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Tags</label>
                        <div className="relative">
                          <Hash className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <input
                            value={form.tags}
                            onChange={(e) => handleChange('tags', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            placeholder="nextjs, react, ui"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Due Date</label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <input
                            type="date"
                            value={form.dueDate}
                            onChange={(e) => handleChange('dueDate', e.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Theme Color</label>
                        <ProjectColorPicker
                          value={form.color}
                          onChange={(val) => handleChange('color', val)}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none">Icon</label>
                        <ProjectEmojiPicker
                          value={form.icon}
                          onChange={(val) => handleChange('icon', val)}
                        />
                      </div>
                    </div>

                    {error ? (
                      <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                        {error.message}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                      >
                        {isPending ? "Creating..." : "Create Project"}
                      </button>
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
