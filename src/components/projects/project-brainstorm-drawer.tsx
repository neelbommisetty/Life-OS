"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/lib/url-state";
import { ProjectChat } from "@/components/projects/project-chat";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectBrainstormDrawer({ projectId, accentColor }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const urlState = useUrlState();
  const searchParams = useMemo(
    () => new URLSearchParams(urlState.search),
    [urlState.search]
  );
  const threadId = searchParams.get("threadId");
  const lastThreadId = useRef<string | null>(null);

  useEffect(() => {
    if (!threadId || threadId === lastThreadId.current) {
      return;
    }
    lastThreadId.current = threadId;
    setIsOpen(true);
  }, [threadId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-3 text-xs font-semibold text-background shadow-lg transition hover:bg-foreground/90"
          )}
          aria-label="Open brainstorm chat"
        >
          <MessageSquareIcon className="h-4 w-4" />
          Brainstorm
        </button>
      )}

      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden={!isOpen}
      />

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 w-full max-w-[420px] transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        aria-hidden={!isOpen}
      >
        <div className="flex h-full flex-col border-l border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Brainstorm
              </p>
              <p className="text-sm font-semibold text-foreground">
                Project sidekick
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close brainstorm chat"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            <ProjectChat
              projectId={projectId}
              accentColor={accentColor}
              layout="drawer"
              className="h-full"
            />
          </div>
        </div>
      </aside>
    </>
  );
}
