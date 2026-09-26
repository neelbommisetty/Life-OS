// Isolated development catalog. No API, credentials, or personal records.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Plus, X } from "lucide-react";
import { Badge, Button, IconButton, Menu, MenuItem, Modal } from "./ui";
import "./theme.css";
import "./design-system.css";
function Catalog() {
  const [dialog, setDialog] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <main className="catalog">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Life-OS / Foundations</p>
          <h1>One personal workspace</h1>
          <p className="page-description">
            A working reference for the tokens, controls, and states used
            throughout Life-OS.
          </p>
        </div>
      </header>
      <section>
        <h2>Color has a job</h2>
        <p>
          Ocean blue signals action and selection. Quiet surfaces keep your work
          in the foreground.
        </p>
        <div className="swatches">
          {[
            "canvas",
            "sidebar",
            "surface",
            "ink",
            "muted",
            "accent",
            "action-fill",
            "danger",
            "warning",
            "info",
          ].map((name) => (
            <div key={name}>
              <span
                className="swatch"
                style={{ background: `var(--${name})` }}
              />
              <code>--{name}</code>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Actions and states</h2>
        <div className="specimens">
          <Button
            onClick={() => setNotice("Task added. This is sample feedback.")}
          >
            <Plus size={16} />
            Add task
          </Button>
          <Button
            variant="secondary"
            onClick={() => setNotice("Changes canceled.")}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => setNotice("Sample task moved to Trash.")}
          >
            Delete task
          </Button>
          <Button disabled>Unavailable</Button>
          <Button pending>Saving…</Button>
          <IconButton
            aria-label="Dismiss sample feedback"
            onClick={() => setNotice("")}
          >
            <X size={18} />
          </IconButton>
        </div>
        <p role="status">
          {notice || "Tab through the controls to inspect keyboard focus."}
        </p>
      </section>
      <section>
        <h2>Fields explain themselves</h2>
        <div className="specimens">
          <label className="catalog-field">
            Project name
            <input placeholder="Name your project" />
          </label>
          <label className="catalog-field">
            Unavailable field
            <input value="Waiting for a due date" disabled readOnly />
          </label>
          <label className="catalog-field">
            Task name
            <input
              aria-invalid="true"
              aria-describedby="sample-error"
              defaultValue=""
            />
            <small className="field-error" id="sample-error">
              Enter a task name.
            </small>
          </label>
        </div>
      </section>
      <section>
        <h2>Metadata stays secondary</h2>
        <div className="specimens">
          <Badge>Personal</Badge>
          <Badge tone="accent">focus</Badge>
          <Badge tone="info">In progress</Badge>
        </div>
      </section>
      <section>
        <h2>Progressive disclosure</h2>
        <div className="specimens">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Open sample dialog
          </Button>
          <Menu label="Sample task options">
            <MenuItem action={() => setNotice("Sample task opened.")}>
              Edit task
            </MenuItem>
            <MenuItem
              action={() => setNotice("Sample task moved to Trash.")}
              danger
            >
              Delete task
            </MenuItem>
          </Menu>
        </div>
      </section>
      <section>
        <h2>Type and rhythm</h2>
        <p className="catalog-title">A clear next step</p>
        <p>
          DM Sans carries the work. Manrope gives headings a distinct voice.
          Spacing follows a four-pixel foundation; controls provide 44px
          targets.
        </p>
        <p className="muted">
          Secondary text stays readable. Status never depends on color alone.
        </p>
      </section>
      {dialog && (
        <Modal title="A focused decision" close={() => setDialog(false)}>
          <p className="dialog-copy">
            Dialogs use keyboard focus containment, Escape dismissal, and a
            clear way back.
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDialog(false);
                setNotice("Sample changes saved.");
              }}
            >
              Save changes
            </Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Catalog />);
