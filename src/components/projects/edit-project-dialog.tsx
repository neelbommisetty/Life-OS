'use client';

import { Dialog, DialogPanel, DialogTitle, Transition } from '@headlessui/react';
import type { Project } from '@prisma/client';
import { useState } from 'react';
import { projectStatusEnum, priorityEnum } from '@/lib/validations/project';
import { api } from '@/trpc/client';

type Props = {
  project: Project;
};

export function EditProjectDialog({ project }: Props) {
  const [open, setOpen] = useState(false);
  const utils = api.useContext();
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    priority: project.priority ?? priorityEnum.options[1],
    tags: project.tags?.join(', ') ?? '',
    dueDate: project.dueDate
      ? new Date(project.dueDate).toISOString().slice(0, 10)
      : '',
    color: project.color ?? '',
    icon: project.icon ?? '',
  });

  const { mutateAsync, isPending, error } = api.project.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.project.list.invalidate(),
        utils.project.getById.invalidate({ id: project.id }),
      ]);
      setOpen(false);
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
        className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
      >
        Edit
      </button>

      <Transition show={open} appear>
        <Dialog className="relative z-50" onClose={setOpen}>
          <Transition.Child
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/30" />
          </Transition.Child>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                <DialogTitle className="text-lg font-semibold">
                  Edit Project
                </DialogTitle>
                <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">
                      Name
                    </label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      placeholder="Project name"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700">
                      Description
                    </label>
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        handleChange('description', e.target.value)
                      }
                      className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Status
                      </label>
                      <select
                        value={form.status}
                        onChange={(e) => handleChange('status', e.target.value)}
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      >
                        {projectStatusEnum.options.map((status) => (
                          <option key={status} value={status}>
                            {status.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Priority
                      </label>
                      <select
                        value={form.priority}
                        onChange={(e) =>
                          handleChange('priority', e.target.value)
                        }
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      >
                        {priorityEnum.options.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Tags (comma separated)
                      </label>
                      <input
                        value={form.tags}
                        onChange={(e) => handleChange('tags', e.target.value)}
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Due date
                      </label>
                      <input
                        type="date"
                        value={form.dueDate}
                        onChange={(e) => handleChange('dueDate', e.target.value)}
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Color token
                      </label>
                      <input
                        value={form.color}
                        onChange={(e) => handleChange('color', e.target.value)}
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="#2563eb"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-zinc-700">
                        Icon (emoji)
                      </label>
                      <input
                        value={form.icon}
                        onChange={(e) => handleChange('icon', e.target.value)}
                        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                        placeholder="🚀"
                      />
                    </div>
                  </div>

                  {error ? (
                    <p className="text-sm text-rose-600">{error.message}</p>
                  ) : null}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isPending ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </form>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

