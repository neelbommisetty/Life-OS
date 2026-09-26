import { useEffect, useRef, useState, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Inbox,
  CalendarDays,
  CalendarRange,
  ListTodo,
  CheckCheck,
  Trash2,
  Hash,
  Tag,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  LayoutList,
  Columns3,
  Check,
  Flag,
  Repeat2,
  MessageSquare,
  CornerDownRight,
  RefreshCw,
  AlertCircle,
  CircleCheck,
  ArrowUpRight,
  X,
  Pencil,
  Archive,
  Sparkles,
} from "lucide-react";
import { api, context, loadWorkspace, recordOf } from "./data";
import type { Task, Project, Section } from "./data";
import type { Receipt } from "../../../packages/tools/src/contract.ts";
import {
  localDate,
  completedOn,
  dateLabel,
  addDays,
  isOpen,
  isCommitted,
  baseTasks,
  sortTasks,
} from "./model";
import type { View, Sort } from "./model";
import { Shell } from "./Shell";
import { Badge, Button, IconButton, Modal, Menu, MenuItem } from "./ui";
import { TaskEditor } from "./TaskEditor";
import type { Draft } from "./TaskEditor";

const titles: Record<string, string> = {
  today: "Today",
  inbox: "Inbox",
  upcoming: "Upcoming",
  all: "All tasks",
  completed: "Completed",
  trash: "Trash",
  search: "Search",
  labels: "Filters & labels",
  proposed: "For review",
};
function readView(): View {
  return (new URLSearchParams(location.search).get("view") as View) || "today";
}
export function App() {
  const [view, setView] = useState<View>(readView);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [organize, setOrganize] = useState<{
    kind: "project" | "section" | "label" | "filter";
    project?: Project;
  } | null>(null);
  const [move, setMove] = useState<Task | null>(null);
  const [decision, setDecision] = useState<{
    task: Task;
    kind: "complete" | "delete";
  } | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<Sort>("default");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [today, setToday] = useState(localDate);
  const busyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: loadWorkspace,
    refetchInterval: 60_000,
  });
  const data = workspace.data;
  const projects = data?.projects.map((p) => p.project) ?? [];
  const sections = data?.projects.flatMap((p) => p.sections) ?? [];
  const tasks = data?.tasks ?? [];
  const project = projects.find((p) => view === `project:${p.id}`);
  const inbox = projects.find((p) => p.system);
  const label = data?.labels.find((l) => view === `label:${l.id}`);
  const filter = data?.filters.find((f) => view === `filter:${f.id}`);
  const title =
    project?.name ?? label?.name ?? filter?.name ?? titles[view] ?? "Tasks";
  const remote = useQuery({
    queryKey: ["task-view", view, deferredSearch],
    enabled:
      !!data &&
      (view.startsWith("label:") ||
        view.startsWith("filter:") ||
        (view === "search" && !!deferredSearch)),
    queryFn: () =>
      view.startsWith("label:")
        ? api.views.label(view.slice(6))
        : view.startsWith("filter:")
          ? api.filter.run(view.slice(7))
          : api.views.search(deferredSearch),
  });
  const usesRemote =
    view.startsWith("label:") ||
    view.startsWith("filter:") ||
    view === "search";
  const shown = sortTasks(
    usesRemote ? (remote.data ?? []) : baseTasks(tasks, view, today, inbox?.id),
    sort,
  );
  const navigate = (next: View) => {
    setView(next);
    setMobileOpen(false);
    setError("");
    history.pushState(
      {},
      "",
      `/todo${next === "today" ? "" : `?view=${encodeURIComponent(next)}`}`,
    );
  };
  const newDraft = (): Draft => ({
    project: project?.id,
    due: view === "today" ? today : undefined,
    labels: label ? [label.name] : undefined,
  });
  const saved = (message: string) => {
    setToast(message);
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    void queryClient.invalidateQueries({ queryKey: ["task-view"] });
  };
  useEffect(() => {
    const pop = () => setView(readView());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    document.title = `${title} · Life OS`;
  }, [title]);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDate()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        navigate("search");
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (!event.metaKey && !event.ctrlKey && event.key === "q") {
        event.preventDefault();
        setDraft(newDraft());
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function mutate(
    label: string,
    call: () => Promise<Receipt<Task> | Receipt<Project>>,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      recordOf((await call()) as Receipt<unknown>);
      saved(label);
      return true;
    } catch (e) {
      setError((e as Error).message);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function complete(task: Task) {
    if (task.status === "done") {
      void mutate("Task reopened", () =>
        api.task.uncomplete(task.id, context(task.version)),
      );
      return;
    }
    if (tasks.some((t) => t.parentId === task.id && isOpen(t))) {
      setDecision({ task, kind: "complete" });
      return;
    }
    void mutate(
      task.repeat
        ? "Occurrence completed · next date scheduled"
        : "Task completed",
      () => api.task.complete(task.id, context(task.version)),
    );
  }
  const sidebar = (
    <>
      <button className="quick-add" onClick={() => setDraft(newDraft())}>
        <span>
          <Plus size={17} />
        </span>
        Add task<kbd>Q</kbd>
      </button>
      <nav className="main-nav" aria-label="Task views">
        {(
          [
            ["search", "Search", Search],
            ["inbox", "Inbox", Inbox],
            ["today", "Today", CalendarDays],
            ["upcoming", "Upcoming", CalendarRange],
            ["all", "All tasks", ListTodo],
            ["labels", "Filters & labels", Tag],
          ] as const
        ).map(([id, name, Icon]) => (
          <button
            key={id}
            className={`nav-item ${view === id ? "active" : ""}`}
            aria-current={view === id ? "page" : undefined}
            onClick={() => navigate(id)}
          >
            <Icon size={19} />
            <span>{name}</span>
            {id === "search" ? (
              <kbd>⌘ K</kbd>
            ) : ["today", "inbox", "all"].includes(id) && data ? (
              <span className="nav-count">
                {baseTasks(tasks, id, today, inbox?.id).length || ""}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-section-title">
        <span>My projects</span>
        <IconButton
          aria-label="Add project"
          onClick={() => setOrganize({ kind: "project" })}
        >
          <Plus size={17} />
        </IconButton>
      </div>
      <nav className="project-nav" aria-label="Projects">
        {data?.projects
          .filter((p) => !p.project.system)
          .map(({ project: p, depth }) => (
            <button
              key={p.id}
              className={`nav-item ${project?.id === p.id ? "active" : ""}`}
              aria-current={project?.id === p.id ? "page" : undefined}
              style={{ paddingLeft: 13 + depth * 14 }}
              onClick={() => navigate(`project:${p.id}`)}
            >
              <Hash size={18} style={{ color: p.color || "var(--accent)" }} />
              <span>{p.name}</span>
              <span className="nav-count">
                {tasks.filter((t) => t.projectId === p.id && isOpen(t))
                  .length || ""}
              </span>
            </button>
          ))}
        {data && projects.filter((p) => !p.system).length === 0 && (
          <button
            className="sidebar-empty"
            onClick={() => setOrganize({ kind: "project" })}
          >
            Create your first project <Plus size={14} />
          </button>
        )}
      </nav>
      <div className="sidebar-secondary">
        {tasks.some((t) => t.status === "proposed" && isOpen(t)) && (
          <button
            className={`nav-item ${view === "proposed" ? "active" : ""}`}
            aria-current={view === "proposed" ? "page" : undefined}
            onClick={() => navigate("proposed")}
          >
            <Sparkles size={18} />
            <span>For review</span>
            <span className="nav-count">
              {tasks.filter((t) => t.status === "proposed" && isOpen(t)).length}
            </span>
          </button>
        )}
        <button
          className={`nav-item ${view === "completed" ? "active" : ""}`}
          aria-current={view === "completed" ? "page" : undefined}
          onClick={() => navigate("completed")}
        >
          <CheckCheck size={18} />
          <span>Completed</span>
        </button>
        <button
          className={`nav-item ${view === "trash" ? "active" : ""}`}
          aria-current={view === "trash" ? "page" : undefined}
          onClick={() => navigate("trash")}
        >
          <Trash2 size={18} />
          <span>Trash</span>
        </button>
      </div>
    </>
  );
  function groupTasks(): {
    id: string;
    name: string;
    tasks: Task[];
    overdue?: boolean;
    section?: string;
    due?: string;
  }[] {
    if (view === "today")
      return [
        {
          id: "overdue",
          name: "Overdue",
          tasks: shown.filter((t) => t.due!.date < today),
          overdue: true,
        },
        {
          id: "today",
          name: `${new Date(today + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Today`,
          tasks: shown.filter((t) => t.due!.date === today),
          due: today,
        },
      ].filter((g) => g.id === "today" || g.tasks.length);
    if (view === "upcoming") {
      const dates = [
        ...new Set([
          ...Array.from({ length: 7 }, (_, i) => addDays(today, i)),
          ...shown.map((t) => t.due!.date).filter((d) => d >= today),
        ]),
      ].sort();
      return [
        ...(shown.some((t) => t.due!.date < today)
          ? [
              {
                id: "overdue",
                name: "Overdue",
                tasks: shown.filter((t) => t.due!.date < today),
                overdue: true,
              },
            ]
          : []),
        ...dates.map((date) => ({
          id: date,
          name: `${dateLabel(date)} · ${new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" })}`,
          tasks: shown.filter((t) => t.due!.date === date),
          due: date,
        })),
      ];
    }
    if (project) {
      const activeSections = sections.filter(
        (s) => s.projectId === project.id && !s.archived,
      );
      const ids = new Set(activeSections.map((s) => s.id));
      return [
        {
          id: "unsectioned",
          name: "Tasks",
          tasks: shown.filter((t) => !t.sectionId || !ids.has(t.sectionId)),
        },
        ...activeSections.map((s) => ({
          id: s.id,
          name: s.name,
          tasks: shown.filter((t) => t.sectionId === s.id),
          section: s.id,
        })),
      ];
    }
    return [{ id: "tasks", name: "", tasks: shown }];
  }
  const canAdd = !["completed", "trash", "search", "labels"].includes(view);
  const selectedTask = draft?.task
    ? (tasks.find((t) => t.id === draft.task!.id) ?? draft.task)
    : undefined;
  return (
    <Shell
      sidebar={sidebar}
      mobileOpen={mobileOpen}
      setMobileOpen={setMobileOpen}
    >
      <main
        id="main"
        tabIndex={-1}
        className={`main-content ${layout === "board" ? "board-width" : ""}`}
      >
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {view === "today"
                ? new Date(today + "T12:00:00").toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })
                : project
                  ? "MY PROJECTS"
                  : "YOUR WORKSPACE"}
            </div>
            <h1>
              {project && (
                <Hash
                  size={28}
                  style={{ color: project.color || "var(--accent)" }}
                />
              )}
              {title}
            </h1>
            {view !== "today" && (
              <p className="page-description">
                {view === "inbox"
                  ? "A place for everything on your mind."
                  : view === "upcoming"
                    ? "Make space for the days ahead."
                    : view === "completed"
                      ? "Look at how far you’ve come."
                      : view === "trash"
                        ? "Deleted tasks stay here until you restore them."
                        : project
                          ? `${shown.length} open ${shown.length === 1 ? "task" : "tasks"} · One step at a time.`
                          : view === "labels"
                            ? "Find your focus across projects."
                            : view === "search"
                              ? "Find a task, a detail, or a conversation."
                              : "Your commitments, all in one place."}
              </p>
            )}
          </div>
          <div className="heading-actions">
            {canAdd && (
              <Button onClick={() => setDraft(newDraft())}>
                <Plus size={16} />
                Add task
              </Button>
            )}
            <IconButton
              aria-label="Refresh tasks"
              onClick={() => {
                void workspace.refetch();
                if (usesRemote) void remote.refetch();
              }}
            >
              <RefreshCw
                size={17}
                className={workspace.isFetching ? "spinning" : ""}
              />
            </IconButton>
            {project && (
              <Menu label="Project options">
                <MenuItem
                  action={() => setOrganize({ kind: "project", project })}
                >
                  <Pencil size={16} />
                  Edit project
                </MenuItem>
                <MenuItem
                  action={() => setOrganize({ kind: "section", project })}
                >
                  <Plus size={16} />
                  Add section
                </MenuItem>
                <MenuItem
                  action={() => {
                    void mutate("Project archived", () =>
                      api.project.archive(project.id, context(project.version)),
                    ).then((ok) => {
                      if (ok) navigate("all");
                    });
                  }}
                >
                  <Archive size={16} />
                  Archive project
                </MenuItem>
              </Menu>
            )}
          </div>
        </div>
        {view === "today" && data && (
          <div className="daily-summary">
            <span className="summary-icon">
              <Check size={16} />
            </span>
            <span>
              <strong>{shown.length}</strong>{" "}
              {shown.length === 1 ? "task" : "tasks"} due or overdue
            </span>
            <span className="summary-divider" />
            <span className="muted">
              {completedOn(tasks, today)} completed today
            </span>
          </div>
        )}
        {view === "search" && (
          <div className="search-box">
            <Search size={20} />
            <input
              ref={searchRef}
              autoFocus
              placeholder="Search tasks, descriptions, and comments"
              aria-label="Search tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={200}
            />
            {search && (
              <IconButton
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={17} />
              </IconButton>
            )}
          </div>
        )}
        {(workspace.error || (usesRemote && remote.error) || error) && (
          <div className="error-banner" role="alert">
            <AlertCircle size={19} />
            <div>
              <strong>We couldn’t finish that request.</strong>
              <p>
                {error || ((workspace.error ?? remote.error) as Error).message}
              </p>
              <button
                className="text-button"
                onClick={() => {
                  setError("");
                  void workspace.refetch();
                  if (usesRemote) void remote.refetch();
                }}
              >
                Refresh tasks
              </button>
            </div>
          </div>
        )}
        {workspace.isPending ? (
          <div className="loading" role="status">
            <span className="skeleton wide-line" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton short-line" />
            <p>Loading your workspace…</p>
          </div>
        ) : !data ? null : view === "labels" ? (
          <div className="organizer">
            <div className="section-heading">
              <h2>Filters</h2>
              <IconButton
                aria-label="Add filter"
                onClick={() => setOrganize({ kind: "filter" })}
              >
                <Plus size={18} />
              </IconButton>
            </div>
            {data.filters.length ? (
              data.filters.map((f) => (
                <button
                  className="organizer-row"
                  key={f.id}
                  onClick={() => navigate(`filter:${f.id}`)}
                >
                  <SlidersHorizontal size={18} />
                  <span>
                    {f.name}
                    <small>{f.query}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            ) : (
              <p className="muted">
                Save a filter for the tasks you return to often.
              </p>
            )}
            <div className="section-heading">
              <h2>Labels</h2>
              <IconButton
                aria-label="Add label"
                onClick={() => setOrganize({ kind: "label" })}
              >
                <Plus size={18} />
              </IconButton>
            </div>
            {data.labels.map((l) => (
              <button
                className="organizer-row"
                key={l.id}
                onClick={() => navigate(`label:${l.id}`)}
              >
                <Tag size={18} style={{ color: l.color || "var(--accent)" }} />
                <span>{l.name}</span>
                <ChevronRight size={17} />
              </button>
            ))}
            {!data.labels.length && (
              <p className="muted">
                Organize tasks across projects with labels.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="view-toolbar">
              <span>
                {view !== "today" && (
                  <>
                    {shown.length}{" "}
                    {view === "completed"
                      ? "completed"
                      : view === "trash"
                        ? "deleted"
                        : ""}{" "}
                    {shown.length === 1 ? "task" : "tasks"}
                  </>
                )}
                {usesRemote && remote.isFetching ? " · Searching…" : ""}
              </span>
              <div>
                <label className="sort-control">
                  <SlidersHorizontal size={15} />
                  <span className="sr-only">Sort tasks</span>
                  <select
                    aria-label="Sort tasks"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                  >
                    <option value="default">Sort: default</option>
                    <option value="priority">Priority</option>
                    <option value="date">Due date</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <div
                  className="view-switch"
                  role="group"
                  aria-label="Task layout"
                >
                  <button
                    aria-label="List view"
                    aria-pressed={layout === "list"}
                    onClick={() => setLayout("list")}
                  >
                    <LayoutList size={17} />
                  </button>
                  <button
                    aria-label="Board view"
                    aria-pressed={layout === "board"}
                    onClick={() => setLayout("board")}
                  >
                    <Columns3 size={17} />
                  </button>
                </div>
              </div>
            </div>
            {shown.length === 0 &&
            view !== "upcoming" &&
            !project &&
            !(usesRemote && remote.isFetching) ? (
              <div className="empty-state">
                <div className="empty-icon">
                  {view === "today" || view === "completed" ? (
                    <CircleCheck size={36} strokeWidth={1.3} />
                  ) : view === "search" ? (
                    <Search size={34} strokeWidth={1.3} />
                  ) : (
                    <Inbox size={36} strokeWidth={1.3} />
                  )}
                </div>
                <h2>
                  {view === "today"
                    ? "A little breathing room."
                    : view === "search"
                      ? search
                        ? "No matching tasks"
                        : "What are you looking for?"
                      : view === "completed"
                        ? "Your progress will live here."
                        : view === "trash"
                          ? "Nothing in the trash."
                          : "A fresh start."}
                </h2>
                <p>
                  {view === "today"
                    ? "Nothing is due today. Add a task, or enjoy the space."
                    : view === "search"
                      ? "Search by a word in a task, description, or comment."
                      : view === "completed"
                        ? "Check off a task to start building momentum."
                        : view === "trash"
                          ? "Tasks you delete can be restored from here."
                          : "Add your first task and take it from there."}
                </p>
                {canAdd && (
                  <Button
                    variant="primary"
                    onClick={() => setDraft(newDraft())}
                  >
                    <Plus size={16} />
                    Add a task
                  </Button>
                )}
              </div>
            ) : (
              <div className={`task-groups ${layout}`}>
                {groupTasks().map((group) => (
                  <section
                    key={group.id}
                    className={`task-group ${group.overdue ? "overdue-group" : ""}`}
                  >
                    {group.name && (
                      <div className="section-heading">
                        <button
                          className="section-toggle"
                          aria-expanded={!collapsed.has(group.id)}
                          onClick={() =>
                            setCollapsed((previous) => {
                              const next = new Set(previous);
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(group.id) ? (
                            <ChevronRight size={15} />
                          ) : (
                            <ChevronDown size={15} />
                          )}
                          <h2>{group.name}</h2>
                          <span>{group.tasks.length}</span>
                        </button>
                        {canAdd && (
                          <IconButton
                            aria-label={`Add task to ${group.name}`}
                            onClick={() =>
                              setDraft({
                                ...newDraft(),
                                section: group.section,
                                due: group.due,
                              })
                            }
                          >
                            <Plus size={16} />
                          </IconButton>
                        )}
                      </div>
                    )}
                    {!collapsed.has(group.id) && (
                      <>
                        <div className="task-list">
                          {group.tasks.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              parent={tasks.find((t) => t.id === task.parentId)}
                              project={projects.find(
                                (p) => p.id === task.projectId,
                              )}
                              showProject={!project}
                              today={today}
                              busy={busy}
                              complete={() => complete(task)}
                              edit={() => setDraft({ task })}
                              move={() => setMove(task)}
                              subtask={() => setDraft({ parent: task })}
                              remove={() =>
                                setDecision({ task, kind: "delete" })
                              }
                              restore={() =>
                                void mutate("Task restored", () =>
                                  api.task.restore(
                                    task.id,
                                    context(task.version),
                                  ),
                                )
                              }
                              accept={() =>
                                void mutate("Task accepted", () =>
                                  api.task.accept(
                                    task.id,
                                    context(task.version),
                                  ),
                                )
                              }
                              start={() =>
                                void mutate("Task started", () =>
                                  api.task.start(
                                    task.id,
                                    context(task.version),
                                  ),
                                )
                              }
                            />
                          ))}
                        </div>
                        {canAdd && (
                          <button
                            className="inline-add"
                            onClick={() =>
                              setDraft({
                                ...newDraft(),
                                section: group.section,
                                due: group.due,
                              })
                            }
                          >
                            <Plus size={18} />
                            Add task
                          </button>
                        )}
                        {!group.tasks.length && view === "upcoming" && (
                          <p className="day-empty">
                            A little space in your day.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                ))}
                {project && (
                  <button
                    className="add-section"
                    onClick={() => setOrganize({ kind: "section", project })}
                  >
                    <Plus size={17} />
                    Add section
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
      {draft && (
        <TaskEditor
          key={draft.task?.id ?? "new"}
          draft={{ ...draft, task: selectedTask }}
          projects={projects}
          sections={sections}
          tasks={tasks}
          close={() => setDraft(null)}
          saved={saved}
        />
      )}
      {organize && (
        <OrganizeDialog
          config={organize}
          close={() => setOrganize(null)}
          saved={saved}
        />
      )}
      {move && (
        <MoveDialog
          task={tasks.find((t) => t.id === move.id) ?? move}
          projects={projects}
          sections={sections}
          close={() => setMove(null)}
          saved={saved}
        />
      )}
      {decision && (
        <Modal
          title={
            decision.kind === "delete"
              ? "Delete task?"
              : "Complete subtasks too?"
          }
          close={() => setDecision(null)}
        >
          <p className="dialog-copy">
            {decision.kind === "delete"
              ? `“${decision.task.title}” will move to Trash. You can restore it later.`
              : "Choose what happens to this task’s open subtasks."}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            {tasks.some(
              (t) => t.parentId === decision.task.id && isOpen(t),
            ) && (
              <Button
                variant="secondary"
                onClick={() => {
                  const d = decision;
                  setDecision(null);
                  void mutate(
                    d.kind === "delete"
                      ? "Task deleted · subtasks kept"
                      : "Task completed · subtasks kept",
                    () =>
                      d.kind === "delete"
                        ? api.task.delete(d.task.id, context(d.task.version), {
                            subtasks: "leave",
                          })
                        : api.task.complete(
                            d.task.id,
                            context(d.task.version),
                            { subtasks: "leave" },
                          ),
                  );
                }}
              >
                Keep subtasks
              </Button>
            )}
            <Button
              variant={decision.kind === "delete" ? "destructive" : "primary"}
              onClick={() => {
                const d = decision;
                setDecision(null);
                void mutate(
                  d.kind === "delete"
                    ? "Task moved to Trash"
                    : "Task completed",
                  () =>
                    d.kind === "delete"
                      ? api.task.delete(d.task.id, context(d.task.version), {
                          subtasks: "delete",
                        })
                      : api.task.complete(d.task.id, context(d.task.version), {
                          subtasks: "complete",
                        }),
                );
              }}
            >
              {decision.kind === "delete" ? "Delete" : "Complete all"}
            </Button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <IconButton
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
    </Shell>
  );
}
function TaskRow({
  task,
  parent,
  project,
  showProject,
  today,
  busy,
  complete,
  edit,
  move,
  subtask,
  remove,
  restore,
  accept,
  start,
}: {
  task: Task;
  parent?: Task;
  project?: Project;
  showProject: boolean;
  today: string;
  busy: boolean;
  complete: () => void;
  edit: () => void;
  move: () => void;
  subtask: () => void;
  remove: () => void;
  restore: () => void;
  accept: () => void;
  start: () => void;
}) {
  const closed = task.status === "done";
  return (
    <article className={`task-row ${closed ? "is-completed" : ""}`}>
      <button
        className={`task-check priority-${task.priority ?? 4} ${task.deletedAt ? "is-restore" : ""}`}
        aria-label={
          task.deletedAt
            ? `Restore ${task.title}`
            : `${closed ? "Reopen" : "Complete"} ${task.title}`
        }
        disabled={busy}
        onClick={task.deletedAt ? restore : complete}
      >
        {task.deletedAt ? <RefreshCw size={12} /> : <Check size={12} />}
      </button>
      <div className="task-content">
        <button className="task-title" onClick={edit}>
          {task.title}
        </button>
        {task.notes && <p className="task-description">{task.notes}</p>}
        <div className="task-meta">
          {(task.priority ?? 4) < 4 && (
            <span className="task-priority">
              <Flag size={12} />
              <span className="sr-only">Priority </span>
              <span aria-hidden="true">P</span>
              {task.priority}
            </span>
          )}
          {task.due && (
            <span
              className={
                task.due.date < today && !closed
                  ? "overdue"
                  : task.due.date === today
                    ? "due-today"
                    : ""
              }
            >
              <CalendarDays size={12} />
              {dateLabel(task.due.date, today)}
              {task.due.time && ` · ${task.due.time}`}
              {task.repeat && <Repeat2 size={12} />}
            </span>
          )}
          {task.deadline && (
            <span className="deadline">
              <Flag size={12} />
              Deadline {dateLabel(task.deadline, today)}
            </span>
          )}
          {task.labels.map((label) => (
            <Badge tone="accent" key={label}>
              <Tag size={11} />
              {label}
            </Badge>
          ))}
          {task.comments.length > 0 && (
            <span>
              <MessageSquare size={12} />
              {task.comments.length}
            </span>
          )}
          {parent && (
            <span>
              <CornerDownRight size={12} />
              {parent.title}
            </span>
          )}
          {task.status === "proposed" && <Badge tone="info">For review</Badge>}
          {task.status === "in_progress" && (
            <Badge tone="info">In progress</Badge>
          )}
          {showProject && project && (
            <span className="task-project">
              {project.name}
              {project.system ? (
                <Inbox size={12} />
              ) : (
                <Hash
                  size={12}
                  style={{ color: project.color || "var(--accent)" }}
                />
              )}
            </span>
          )}
        </div>
      </div>
      <div className="task-actions">
        <Menu label={`Options for ${task.title}`}>
          {task.deletedAt ? (
            <MenuItem action={restore}>
              <RefreshCw size={15} />
              Restore task
            </MenuItem>
          ) : (
            <>
              <MenuItem action={edit}>
                <Pencil size={15} />
                Edit task
              </MenuItem>
              <MenuItem action={move}>
                <ArrowUpRight size={15} />
                Move to project
              </MenuItem>
              <MenuItem action={subtask}>
                <Plus size={15} />
                Add subtask
              </MenuItem>
              {task.status === "proposed" && (
                <MenuItem action={accept}>
                  <Check size={15} />
                  Accept task
                </MenuItem>
              )}
              {task.status === "accepted" && (
                <MenuItem action={start}>
                  <ArrowUpRight size={15} />
                  Start task
                </MenuItem>
              )}
              <MenuItem action={remove} danger>
                <Trash2 size={15} />
                Delete task
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </article>
  );
}
function OrganizeDialog({
  config,
  close,
  saved,
}: {
  config: {
    kind: "project" | "section" | "label" | "filter";
    project?: Project;
  };
  close: () => void;
  saved: (message: string) => void;
}) {
  const editing = config.kind === "project" && !!config.project;
  const [name, setName] = useState(editing ? config.project!.name : "");
  const [color, setColor] = useState(config.project?.color ?? "#4c7664");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef({ payload: "", key: crypto.randomUUID() });
  return (
    <Modal
      title={`${editing ? "Edit" : "Add"} ${config.kind}`}
      close={() => !pending && close()}
    >
      <form
        className="organize-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          const payload = JSON.stringify({ name, color, query });
          if (attempt.current.payload !== payload)
            attempt.current = { payload, key: crypto.randomUUID() };
          try {
            const ctx = context(
              editing ? config.project!.version : undefined,
              attempt.current.key,
            );
            const result =
              config.kind === "project"
                ? editing
                  ? await api.project.update(
                      config.project!.id,
                      { name, color },
                      ctx,
                    )
                  : await api.project.add({ name, color }, ctx)
                : config.kind === "section"
                  ? await api.section.add(
                      { name, project: config.project!.id },
                      ctx,
                    )
                  : config.kind === "label"
                    ? await api.label.add({ name, color }, ctx)
                    : await api.filter.add({ name, query }, ctx);
            recordOf(result as Receipt<unknown>);
            saved(
              `${config.kind[0].toUpperCase() + config.kind.slice(1)} ${editing ? "updated" : "added"}`,
            );
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Name
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={config.kind === "label" ? 64 : 4000}
            pattern={
              config.kind === "label" ? "[a-z0-9]+(-[a-z0-9]+)*" : undefined
            }
          />
        </label>
        {(config.kind === "project" || config.kind === "label") && (
          <label>
            Color
            <select value={color} onChange={(e) => setColor(e.target.value)}>
              {[
                ["#4c7664", "Forest"],
                ["#6d82aa", "Blue"],
                ["#c49350", "Amber"],
                ["#aa6966", "Rose"],
                ["#8d78a9", "Violet"],
                ["#7d827b", "Stone"],
              ].map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
              {![
                "#4c7664",
                "#6d82aa",
                "#c49350",
                "#aa6966",
                "#8d78a9",
                "#7d827b",
              ].includes(color) && <option value={color}>{color}</option>}
            </select>
          </label>
        )}
        {config.kind === "filter" && (
          <label>
            Filter query
            <input
              required
              placeholder="p1 & status:accepted"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <small className="muted">
              Combine conditions with &amp; (and) or | (or).
            </small>
          </label>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : editing ? "Save" : "Add"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function MoveDialog({
  task,
  projects,
  sections,
  close,
  saved,
}: {
  task: Task;
  projects: Project[];
  sections: Section[];
  close: () => void;
  saved: (message: string) => void;
}) {
  const [project, setProject] = useState(task.projectId);
  const [section, setSection] = useState(task.sectionId ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const key = useRef(crypto.randomUUID());
  const expectedVersion = useRef(task.version);
  return (
    <Modal title="Move task" close={() => !pending && close()}>
      <form
        className="organize-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          try {
            recordOf(
              await api.task.move(
                task.id,
                { project, section: section || null, parent: null },
                context(expectedVersion.current, key.current),
              ),
            );
            saved("Task moved");
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Project
          <select
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setSection("");
              key.current = crypto.randomUUID();
            }}
          >
            {projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Section
          <select
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              key.current = crypto.randomUUID();
            }}
          >
            <option value="">No section</option>
            {sections
              .filter((s) => s.projectId === project && !s.archived)
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        {task.parentId && (
          <p className="muted">Moving makes this a top-level task.</p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="primary" disabled={pending}>
            {pending ? "Moving…" : "Move task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
