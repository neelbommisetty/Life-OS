// Development-only showcase of the selected shared palette. No API or storage.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Hash,
  Inbox,
  ListTodo,
  Plus,
  Search,
} from "lucide-react";
import { Badge, Button, Modal } from "./ui";
import { Shell } from "./Shell";
import "./theme.css";
import "./todo.css";
import "./palette-preview.css";

function PalettePreview() {
  const selected = {
    name: "Ocean blue",
    feel: "Clear blue accents, pale controls, and light cool surfaces.",
  };
  const [dialog, setDialog] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  return (
    <div className="palette-lab">
      <header className="palette-intro">
        <p className="eyebrow">Life-OS / Ocean blue</p>
        <h1>Ocean blue, across Life-OS.</h1>
        <p>
          The shared Life-OS palette, shown on the workspace shell, controls,
          and feedback.
        </p>
      </header>
      <div className="palette-context" aria-live="polite">
        <div>
          <h2>{selected.name}</h2>
          <p>{selected.feel}</p>
        </div>
        <span>Applied to the shared design system</span>
      </div>
      <section
        className="palette-stage"
        aria-label={`${selected.name} workspace preview`}
      >
        <Shell
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          sidebar={
            <>
              <button className="quick-add" onClick={() => setDialog(true)}>
                <span>
                  <Plus size={17} />
                </span>
                Add task<kbd>Q</kbd>
              </button>
              <nav className="main-nav" aria-label="Sample navigation">
                <div className="nav-item">
                  <Search size={19} />
                  <span>Search</span>
                </div>
                <div className="nav-item">
                  <Inbox size={19} />
                  <span>Inbox</span>
                  <span className="nav-count">4</span>
                </div>
                <div className="nav-item active">
                  <CalendarDays size={19} />
                  <span>Today</span>
                  <span className="nav-count">3</span>
                </div>
                <div className="nav-item">
                  <ListTodo size={19} />
                  <span>All tasks</span>
                  <span className="nav-count">12</span>
                </div>
              </nav>
              <div className="sidebar-section-title">My projects</div>
              <div className="nav-item">
                <Hash size={18} />
                <span>Personal</span>
              </div>
              <div className="nav-item">
                <Hash size={18} />
                <span>Things to explore</span>
              </div>
            </>
          }
        >
          <main id="main" className="main-content" tabIndex={-1}>
            <div className="page-heading">
              <div>
                <p className="eyebrow">Your workspace</p>
                <h1>Today</h1>
              </div>
              <Button onClick={() => setDialog(true)}>
                <Plus size={16} />
                Add task
              </Button>
            </div>
            <div className="daily-summary">
              <Check size={16} />
              <span>
                <strong>{completed ? 2 : 3}</strong> tasks on your list
              </span>
              <span className="summary-divider" />
              <span className="muted">{completed ? 1 : 0} completed</span>
            </div>
            <div className="section-heading">
              <h2>Planned for today</h2>
              <ChevronDown size={16} />
            </div>
            {[
              [
                "Make space for a walk",
                "A small pause in the middle of the day.",
                "Personal",
              ],
              [
                "Explore an idea worth keeping",
                "A few notes to come back to.",
                "Things to explore",
              ],
              ["Plan the weekend", "", "Personal"],
            ].map(([title, notes, project], index) => (
              <article
                key={title}
                className={`task-row ${index === 0 && completed ? "is-completed" : ""}`}
              >
                <button
                  className="task-check"
                  aria-label={`${index === 0 && completed ? "Reopen" : "Complete"} sample task: ${title}`}
                  onClick={() =>
                    index === 0 ? setCompleted(!completed) : setDialog(true)
                  }
                >
                  <Check size={12} />
                </button>
                <div className="task-content">
                  <button
                    className="task-title"
                    onClick={() => setDialog(true)}
                  >
                    {title}
                  </button>
                  {notes && <p className="task-description">{notes}</p>}
                  <div className="task-meta">
                    <span className="due-today">
                      <CalendarDays size={12} />
                      Today
                    </span>
                    {index === 1 && <Badge tone="accent">focus</Badge>}
                    <span className="task-project">{project}</span>
                  </div>
                </div>
              </article>
            ))}
            <button className="inline-add" onClick={() => setDialog(true)}>
              <Plus size={18} />
              Add task
            </button>
          </main>
        </Shell>
      </section>
      <section className="palette-system" aria-labelledby="system-title">
        <div>
          <p className="eyebrow">Across Life-OS</p>
          <h2 id="system-title">One consistent visual language.</h2>
          <p>
            The same roles apply to every slice: navigation, content surfaces,
            actions, inputs, and feedback.
          </p>
        </div>
        <div className="palette-specimens">
          <div>
            <h3>Actions</h3>
            <div className="palette-controls">
              <Button onClick={() => setDialog(true)}>Save changes</Button>
              <Button variant="secondary" onClick={() => setDialog(true)}>
                Cancel
              </Button>
              <Button disabled>Unavailable</Button>
            </div>
          </div>
          <div>
            <h3>Fields & selection</h3>
            <label className="palette-field">
              Name
              <input placeholder="Something worth making time for" />
            </label>
            <div className="palette-controls">
              <Badge tone="accent">Selected</Badge>
              <Badge tone="info">In progress</Badge>
            </div>
          </div>
          <div>
            <h3>Feedback</h3>
            <p className="palette-feedback success">
              <Check size={16} />
              Changes saved
            </p>
            <p className="palette-feedback error">This needs your attention.</p>
            <p className="palette-feedback info">You can update this later.</p>
          </div>
        </div>
      </section>
      <footer className="palette-footer">
        Ocean blue is the shared palette for Life-OS.
      </footer>
      {dialog && (
        <Modal title="A look at the details" close={() => setDialog(false)}>
          <p className="dialog-copy">
            Dialogs, focus rings, and actions inherit the same{" "}
            {selected.name.toLowerCase()} palette.
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => setDialog(false)}>Looks good</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<PalettePreview />);
