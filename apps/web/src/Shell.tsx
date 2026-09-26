import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Check, PanelLeftOpen, X } from "lucide-react";
import { IconButton } from "./ui";
const mobileSnapshot = () => window.matchMedia("(max-width: 680px)").matches;
function subscribeMobile(notify: () => void) {
  const query = window.matchMedia("(max-width: 680px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
export function Shell({
  sidebar,
  children,
  mobileOpen,
  setMobileOpen,
  title = "Tasks",
  description = "Your plans, in motion",
}: {
  sidebar: ReactNode;
  children: ReactNode;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot);
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isMobile || !mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
      toggleRef.current?.focus();
    };
  }, [isMobile, mobileOpen, setMobileOpen]);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {isMobile && mobileOpen && (
        <div
          className="sidebar-scrim"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        ref={sidebarRef}
        inert={isMobile && !mobileOpen}
        role={isMobile && mobileOpen ? "dialog" : undefined}
        aria-modal={isMobile && mobileOpen ? true : undefined}
        className={`sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <IconButton
          ref={closeRef}
          className="mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={20} />
        </IconButton>
        <a href="/todo" className="brand">
          <span className="brand-mark" aria-hidden="true">
            l<span>o</span>
          </span>
          <span>
            Life<span className="brand-light">OS</span>
            <small>Your personal workspace</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Check size={17} />
          </span>
          <span>
            {title}
            <small>{description}</small>
          </span>
        </div>
        {sidebar}
        <div className="sidebar-bottom">
          <span className="avatar" aria-hidden="true">
            N
          </span>
          <span>
            <strong>Neel</strong>
            <small>Personal workspace</small>
          </span>
        </div>
      </aside>
      <div className="workspace" inert={isMobile && mobileOpen}>
        <header className="topbar">
          <div>
            <IconButton
              ref={toggleRef}
              className="mobile-toggle"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              aria-controls="workspace-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <PanelLeftOpen size={20} />
            </IconButton>
            <span className="breadcrumb">
              Workspace <span aria-hidden="true">/</span>{" "}
              <strong>{title}</strong>
            </span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
