import { useState } from "react";
import { Dialog } from "@/components/ui/native-dialog";
import type { ArtifactType } from "@prisma/client";
import {
  FileText,
  ImageIcon,
  Link2,
  Paperclip,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "@/components/projects/chat-markdown";
import {
  SYSTEM_CONTEXT_ARTIFACT_TITLE,
  isSystemContextTitle,
} from "@/lib/system-context";
import { type ArtifactDraft, artifactTypeLabels, artifactTypeIcons, createEmptyDraft } from "./types";

export type ArtifactFormProps = {
  open: boolean;
  onClose: () => void;
  draft: ArtifactDraft;
  onDraftChange: (draft: ArtifactDraft) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  isSaving: boolean;
  uploadError: string | null;
  isUploading: boolean;
  startUpload: (files: File[]) => void;
  textMode: "write" | "preview";
  onTextModeChange: (mode: "write" | "preview") => void;
  themeStyle?: React.CSSProperties;
};

export function ArtifactForm({
  open,
  onClose,
  draft,
  onDraftChange,
  onSave,
  onDelete,
  isSaving,
  uploadError,
  isUploading,
  startUpload,
  textMode,
  onTextModeChange,
  themeStyle,
}: ArtifactFormProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isSystemContextDraft = isSystemContextTitle(draft.title);

  const effectiveTitle = isSystemContextDraft
    ? SYSTEM_CONTEXT_ARTIFACT_TITLE
    : draft.title;

  const effectiveType = isSystemContextDraft ? "TEXT" : draft.type;

  const ActiveIcon = artifactTypeIcons[effectiveType];

  const isDraftValid = (() => {
    if (!effectiveTitle.trim()) return false;
    if (effectiveType === "TEXT") return !!draft.content.trim();
    if (effectiveType === "LINK") return !!draft.url.trim();
    if (effectiveType === "FILE") return !!draft.fileKey && !!draft.fileUrl;
    return true;
  })();

  const saveLabel = isSystemContextDraft
    ? draft.mode === "create"
      ? "Create system context"
      : "Save system context"
    : draft.mode === "create"
      ? "Create artifact"
      : "Save changes";

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      startUpload(files);
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      variant="sheet"
      size="xl"
      hideCloseButton
      style={themeStyle}
    >
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-muted p-2 text-muted-foreground">
            {ActiveIcon ? <ActiveIcon className="h-4 w-4" /> : null}
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {draft.mode === "create" ? "New artifact" : "Artifact details"}
            </p>
            <h3 className="text-lg font-semibold text-foreground">
              {effectiveTitle || "Untitled"}
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Type
          </label>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            value={effectiveType}
            onChange={(event) => {
              const nextType = event.target.value as ArtifactType;
              onDraftChange({
                ...createEmptyDraft(nextType),
                title: draft.title,
                mode: draft.mode,
                id: draft.id,
              });
            }}
            disabled={isSystemContextDraft}
          >
            {Object.entries(artifactTypeLabels).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Title
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Name this artifact"
            value={effectiveTitle}
            onChange={(event) =>
              onDraftChange({ ...draft, title: event.target.value })
            }
            disabled={isSystemContextDraft}
            required
          />
        </div>

        {draft.type === "TEXT" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Markdown
              </label>
              <div className="flex rounded-lg border border-border bg-muted p-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {(["write", "preview"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1 transition",
                      textMode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => onTextModeChange(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            {textMode === "write" ? (
              <textarea
                className="min-h-[300px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="Write your note in markdown..."
                value={draft.content}
                onChange={(event) =>
                  onDraftChange({ ...draft, content: event.target.value })
                }
              />
            ) : (
              <div className="min-h-[300px] rounded-lg border border-border bg-background px-4 py-3 overflow-y-auto">
                {draft.content ? (
                  <ChatMarkdown content={draft.content} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nothing to preview yet.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {draft.type === "LINK" && (
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              URL
            </label>
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="https://"
              value={draft.url}
              onChange={(event) =>
                onDraftChange({ ...draft, url: event.target.value })
              }
              required
            />
            {draft.url && (
              <a
                className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                href={draft.url}
                target="_blank"
                rel="noreferrer"
              >
                <Link2 className="h-4 w-4" /> Open link
              </a>
            )}
          </div>
        )}

        {draft.type === "FILE" && (
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              File
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "rounded-lg border-2 border-dashed bg-background p-6 transition flex flex-col items-center justify-center text-center",
                isDragging ? "border-primary bg-primary/5" : "border-border",
                "hover:border-primary/50 hover:bg-muted/30 cursor-pointer"
              )}
              onClick={() => document.getElementById("file-upload")?.click()}
            >
              <UploadCloud className={cn("h-10 w-10 mb-2 transition", isDragging ? "text-primary scale-110" : "text-muted-foreground")} />
              <p className="text-sm font-medium text-foreground">
                {isUploading ? "Uploading..." : isDragging ? "Drop to upload" : "Drag and drop or click to upload"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Any file up to 8MB
              </p>
              <input
                id="file-upload"
                className="hidden"
                type="file"
                onChange={(event) => {
                  const files = event.target.files;
                  if (!files?.length) return;
                  startUpload(Array.from(files));
                }}
                disabled={isUploading}
              />
            </div>

            {draft.fileName && (
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-background p-2 border border-border">
                    {draft.fileType?.startsWith("image/") ? (
                      <ImageIcon className="h-6 w-6 text-primary" />
                    ) : (
                      <Paperclip className="h-6 w-6 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {draft.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {draft.fileType || "File"}{" "}
                      {draft.fileSize
                        ? `· ${(draft.fileSize / 1024).toFixed(1)} KB`
                        : ""}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {uploadError && (
              <p className="text-xs font-medium text-red-500 bg-red-50 p-2 rounded border border-red-100">{uploadError}</p>
            )}

            {draft.fileUrl && (draft.fileType ?? "").startsWith("image/") ? (
              <div className="space-y-2 mt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Preview
                </label>
                <div className="overflow-hidden rounded-lg border border-border bg-background">
                  <img
                    src={draft.fileUrl}
                    alt={draft.fileName || "Uploaded image"}
                    className="h-auto w-full object-cover"
                  />
                </div>
                <a
                  className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                  href={draft.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ImageIcon className="h-4 w-4" />
                  Open full resolution
                </a>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 pt-6 border-t border-border">
          {draft.mode === "edit" && draft.id && !isSystemContextDraft && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
              onClick={() => onDelete(draft.id ?? "")}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-background transition shadow-sm",
                isDraftValid && !isSaving && !isUploading
                  ? "bg-foreground hover:bg-foreground/90"
                  : "cursor-not-allowed bg-muted text-muted-foreground"
              )}
              disabled={!isDraftValid || isSaving || isUploading}
              onClick={onSave}
            >
              <Save className="h-4 w-4" /> {isSaving ? "Saving..." : saveLabel}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
