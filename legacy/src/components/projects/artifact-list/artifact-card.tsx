import type { Artifact } from "@prisma/client";
import { Eye, Link2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/project-utils";
import { artifactTypeIcons, artifactTypeLabels } from "./types";

export type ArtifactCardProps = {
  artifact: Artifact;
  isActive: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onDelete: () => void;
};

export function ArtifactCard({
  artifact,
  isActive,
  onSelect,
  onPreview,
  onDelete,
}: ArtifactCardProps) {
  const Icon = artifactTypeIcons[artifact.type];
  const isImage = artifact.type === "FILE" && (artifact.fileType ?? "").startsWith("image/");

  return (
    <div
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition",
        isActive
          ? "border-foreground/30 bg-foreground/5"
          : "border-border bg-background hover:border-foreground/20"
      )}
    >
      <div
        className="flex flex-1 cursor-pointer items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
      >
        {isImage && artifact.fileUrl ? (
          <span className="mt-0.5 h-10 w-10 overflow-hidden rounded-md border border-border bg-background">
            <img
              src={artifact.fileUrl}
              alt={artifact.fileName || "Artifact image"}
              className="h-full w-full object-cover"
            />
          </span>
        ) : (
          <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-semibold text-foreground">
              {artifact.title}
            </p>
            <span className="text-xs text-muted-foreground">
              {formatDate(artifact.updatedAt)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {artifactTypeLabels[artifact.type]}
          </p>
          {artifact.type === "LINK" && artifact.url && (
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-xs text-foreground/80">
                {artifact.url}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  window.open(artifact.url ?? "", "_blank", "noreferrer");
                }}
              >
                <Link2 className="h-3 w-3" /> Open
              </button>
            </div>
          )}
          {artifact.type === "FILE" && !isImage && artifact.fileName && (
            <div className="mt-1 text-xs text-muted-foreground">
              <span className="truncate text-foreground/80">
                {artifact.fileName}
              </span>
              <span className="ml-2">
                {(artifact.fileType || "File") +
                  (artifact.fileSize
                    ? ` · ${(artifact.fileSize / 1024).toFixed(1)} KB`
                    : "")}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          onClick={onPreview}
        >
          <Eye className="h-3 w-3" />
          Preview
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}
