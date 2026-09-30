import { useRef, useState } from "react";
import {
  CalendarDays,
  Clock,
  Flag,
  Hash,
  Plus,
  Tag,
  Repeat2,
  MessageSquare,
} from "lucide-react";
import { api, context, recordOf, timezone } from "./data";
import type { Task, Project, Section } from "./data";
import { Button, IconButton, Modal } from "./ui";
export type Draft = {
  task?: Task;
  project?: string;
  section?: string;
  due?: string;
  parent?: Task;
  labels?: string[];
};
export function TaskEditor({
  draft,
  projects,
  sections,
  tasks,
  close,
  saved,
}: {
  draft: Draft;
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  close: () => void;
  saved: (message: string) => void;
}) {
  const task = draft.task;
  const expectedVersion = useRef(task?.version);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [project, setProject] = useState(
    task?.projectId ?? draft.parent?.projectId ?? draft.project ?? "inbox",
  );
  const [section, setSection] = useState(
    draft.section ?? draft.parent?.sectionId ?? "",
  );
  const [date, setDate] = useState(task?.due?.date ?? draft.due ?? "");
  const [time, setTime] = useState(task?.due?.time ?? "");
  const [duration, setDuration] = useState(task?.duration?.toString() ?? "");
  const [priority, setPriority] = useState(task?.priority ?? 4);
  const [labels, setLabels] = useState(
    task?.labels.join(", ") ?? draft.labels?.join(", ") ?? "",
  );
  const [repeat, setRepeat] = useState(task?.repeat ?? "");
  const [deadline, setDeadline] = useState(task?.deadline ?? "");
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(task || draft.labels?.length),
  );
  const attempt = useRef({ payload: "", key: crypto.randomUUID() });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const input = {
      title: title.trim(),
      notes,
      due: date
        ? {
            date,
            ...(time
              ? { time, timezone: task?.due?.timezone ?? timezone }
              : {}),
          }
        : null,
      priority,
      labels: labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      repeat: repeat || null,
      deadline: deadline || null,
      duration: duration === "" ? null : Number(duration),
    };
    const payload = JSON.stringify({
      input,
      project,
      section,
      allowDuplicate,
      version: expectedVersion.current,
    });
    if (attempt.current.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    try {
      if (task)
        recordOf(
          await api.task.update(
            task.id,
            input,
            context(expectedVersion.current, attempt.current.key),
          ),
        );
      else
        recordOf(
          await api.task.add(
            {
              ...input,
              duration: input.duration ?? undefined,
              repeat: repeat || undefined,
              project,
              section: section || undefined,
              parent: draft.parent?.id,
              status: "accepted",
              allowDuplicate,
            },
            context(undefined, attempt.current.key),
          ),
        );
      saved(task ? "Task updated" : "Task added");
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      title={task ? "Task details" : draft.parent ? "Add subtask" : "Add task"}
      close={() => !pending && close()}
      wide
    >
      <form onSubmit={save} className="task-form">
        {draft.parent && (
          <p className="muted">Subtask of {draft.parent.title}</p>
        )}
        <label className="sr-only" htmlFor="task-title">
          Task name
        </label>
        <input
          id="task-title"
          className="title-input"
          placeholder="What needs to get done?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={4000}
          autoFocus
        />
        <label className="sr-only" htmlFor="task-notes">
          Description
        </label>
        <textarea
          id="task-notes"
          className="notes-input"
          placeholder="Add a description…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
        <div className="field-grid">
          <label>
            <span>
              <CalendarDays size={15} /> Due date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {!task && (
            <label>
              <span>
                <Hash size={15} /> Project
              </span>
              <select
                value={project}
                disabled={!!draft.parent}
                onChange={(e) => {
                  setProject(e.target.value);
                  setSection("");
                }}
              >
                <option value="inbox">Inbox</option>
                {projects
                  .filter((p) => !p.system)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!task &&
            sections.some((s) => s.projectId === project && !s.archived) && (
              <label>
                <span>Section</span>
                <select
                  value={section}
                  disabled={!!draft.parent}
                  onChange={(e) => setSection(e.target.value)}
                >
                  <option value="">No section</option>
                  {sections
                    .filter((s) => s.projectId === project && !s.archived)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
        </div>
        <details
          className="task-options"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>
            Task options{" "}
            <span className="muted">Time, duration, priority and more</span>
          </summary>
          <div className="field-grid">
            <label>
              <span>
                Time{task?.due?.timezone ? ` (${task.due.timezone})` : ""}
              </span>
              <input
                type="time"
                value={time}
                disabled={!date}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <label>
              <span>
                <Clock size={15} /> Duration (minutes)
              </span>
              <input
                type="number"
                min={1}
                max={43200}
                step={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                aria-describedby="duration-hint"
              />
              <small id="duration-hint" className="muted">
                Optional estimate. With a due date and time, sets the calendar
                block length. Clear to remove.
              </small>
            </label>
            <label>
              <span>
                <Flag size={15} /> Priority
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              >
                <option value={1}>P1 · High</option>
                <option value={2}>P2 · Medium</option>
                <option value={3}>P3 · Low</option>
                <option value={4}>P4 · None</option>
              </select>
            </label>
            <label>
              <span>
                <Tag size={15} /> Labels
              </span>
              <input
                placeholder="work, personal"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                aria-describedby="labels-hint"
              />
              <small id="labels-hint" className="muted">
                Lowercase labels, separated by commas.
              </small>
            </label>
            <label>
              <span>
                <Repeat2 size={15} /> Repeat
              </span>
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              >
                <option value="">Does not repeat</option>
                <option value="FREQ=DAILY">Every day</option>
                <option value="FREQ=WEEKLY">Every week</option>
                <option value="FREQ=MONTHLY">Every month</option>
                <option value="FREQ=YEARLY">Every year</option>
                {repeat &&
                  ![
                    "FREQ=DAILY",
                    "FREQ=WEEKLY",
                    "FREQ=MONTHLY",
                    "FREQ=YEARLY",
                  ].includes(repeat) && (
                    <option value={repeat}>{repeat}</option>
                  )}
              </select>
            </label>
            <label>
              <span>Deadline</span>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                aria-describedby="deadline-hint"
              />
              <small id="deadline-hint" className="muted">
                The final date this must be finished. Due date is when you plan
                to do it.
              </small>
            </label>
          </div>
        </details>
        {repeat && !date && (
          <p className="field-error">
            Choose a due date for this repeating task.
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {!task && error.includes("similar task") && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowDuplicate}
              onChange={(e) => setAllowDuplicate(e.target.checked)}
            />{" "}
            Add as a separate task
          </label>
        )}
        <div className="form-footer">
          <span className="muted">
            {task ? `Status: ${task.status.replace("_", " ")}` : "New task"}
          </span>
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={pending}
            disabled={pending || !title.trim() || (!!repeat && !date)}
          >
            {pending ? "Saving…" : task ? "Save changes" : "Add task"}
          </Button>
        </div>
      </form>
      {task && (
        <TaskNotes
          task={task}
          saved={saved}
          expectedVersion={expectedVersion.current}
          versionSaved={(version) => {
            expectedVersion.current = version;
          }}
        />
      )}
      {task && tasks.some((t) => t.parentId === task.id && !t.deletedAt) && (
        <div className="detail-section">
          <h3>Subtasks</h3>
          {tasks
            .filter((t) => t.parentId === task.id && !t.deletedAt)
            .map((t) => (
              <p key={t.id} className={t.status === "done" ? "struck" : ""}>
                {t.title}
              </p>
            ))}
        </div>
      )}
    </Modal>
  );
}
function TaskNotes({
  task,
  saved,
  expectedVersion,
  versionSaved,
}: {
  task: Task;
  saved: (m: string) => void;
  expectedVersion?: number;
  versionSaved: (version: number) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const key = useRef(crypto.randomUUID());
  return (
    <div className="detail-section">
      <h3>
        <MessageSquare size={16} /> Comments{" "}
        <span className="muted">{task.comments.length || ""}</span>
      </h3>
      {task.comments.map((comment, i) => (
        <div className="comment" key={i}>
          <strong>{comment.actor}</strong>
          <time>{new Date(comment.at).toLocaleDateString()}</time>
          <p>{comment.text}</p>
        </div>
      ))}
      <form
        className="comment-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            const updated = recordOf(
              await api.task.note(
                task.id,
                text.trim(),
                context(expectedVersion, key.current),
              ),
            );
            versionSaved(updated.version);
            setText("");
            key.current = crypto.randomUUID();
            saved("Comment added");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <input
          aria-label="Comment"
          placeholder="Add a comment…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            key.current = crypto.randomUUID();
          }}
        />
        <IconButton
          aria-label="Post comment"

          disabled={pending || !text.trim()}
        >
          <Plus size={18} />
        </IconButton>
      </form>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
