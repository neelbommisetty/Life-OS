"use client";

import { useEffect, useMemo, useState } from "react";
import { LockIcon, PencilIcon, SaveIcon, XIcon } from "lucide-react";
import { api } from "@/trpc/client";
import {
  SYSTEM_CONTEXT_ARTIFACT_TITLE,
  isSystemContextArtifact,
} from "@/lib/system-context";
import { cn } from "@/lib/utils";

type Props = {
  projectId: string;
};

export function ProjectSystemContextCard({ projectId }: Props) {
  const utils = api.useUtils();
  const { data, isLoading } = api.artifact.list.useQuery({ projectId });
  const systemContextArtifact = useMemo(
    () => (data ?? []).find((artifact) => isSystemContextArtifact(artifact)) ?? null,
    [data]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!isEditing) {
      setDraft(systemContextArtifact?.content ?? "");
    }
  }, [isEditing, systemContextArtifact?.content]);

  const createMutation = api.artifact.create.useMutation({
    onSuccess: () => {
      utils.artifact.list.invalidate({ projectId });
      setIsEditing(false);
    },
  });

  const updateMutation = api.artifact.update.useMutation({
    onSuccess: () => {
      utils.artifact.list.invalidate({ projectId });
      setIsEditing(false);
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const trimmedDraft = draft.trim();

  const handleSave = () => {
    if (!trimmedDraft) return;
    if (systemContextArtifact) {
      updateMutation.mutate({
        id: systemContextArtifact.id,
        type: "TEXT",
        title: SYSTEM_CONTEXT_ARTIFACT_TITLE,
        content: trimmedDraft,
      });
      return;
    }
    createMutation.mutate({
      projectId,
      type: "TEXT",
      title: SYSTEM_CONTEXT_ARTIFACT_TITLE,
      content: trimmedDraft,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              System context
            </p>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <LockIcon className="h-3 w-3" />
              Locked
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Baseline guidance for every brainstorm and task thread.
          </p>
        </div>
        {!isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted/80"
          >
            <PencilIcon className="h-3 w-3" />
            {systemContextArtifact ? "Edit" : "Add"}
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {isLoading && (
          <p className="text-xs text-muted-foreground">Loading system context...</p>
        )}

        {!isLoading && !isEditing && (
          <div
            className={cn(
              "rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-sm",
              systemContextArtifact
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {systemContextArtifact?.content?.trim()
              ? systemContextArtifact.content
              : "No system context yet. Add one to guide brainstorming."}
          </div>
        )}

        {!isLoading && isEditing && (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Describe the project vision, constraints, and guiding principles..."
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!trimmedDraft || isSaving}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition",
                  trimmedDraft && !isSaving
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground"
                )}
              >
                <SaveIcon className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save system context"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
              >
                <XIcon className="h-4 w-4" />
                Cancel
              </button>
            </div>
            {(createMutation.error || updateMutation.error) && (
              <p className="text-xs text-red-500">
                {createMutation.error?.message ?? updateMutation.error?.message}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
