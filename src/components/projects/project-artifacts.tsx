"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition } from "@headlessui/react";
import type { Artifact, ArtifactType } from "@prisma/client";
import {
  Eye,
  FileText,
  ImageIcon,
  Link2,
  LockIcon,
  Paperclip,
  Plus,
  Save,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api } from "@/trpc/client";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/project-utils";
import { getProjectTheme } from "@/lib/project-theme";
import { ChatMarkdown } from "@/components/projects/chat-markdown";
import { useUploadThing } from "@/lib/uploadthing";
import {
  SYSTEM_CONTEXT_ARTIFACT_TITLE,
  isSystemContextArtifact,
  isSystemContextTitle,
} from "@/lib/system-context";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

type ArtifactDraft = {
  id?: string;
  mode: "create" | "edit";
  type: ArtifactType;
  title: string;
  content: string;
  url: string;
  fileKey: string;
  fileName: string;
  fileSize: number | null;
  fileType: string;
  fileUrl: string;
};

const artifactTypeLabels: Record<ArtifactType, string> = {
  TEXT: "Text",
  LINK: "Link",
  FILE: "File",
};

const artifactTypeIcons: Record<ArtifactType, typeof FileText> = {
  TEXT: FileText,
  LINK: Link2,
  FILE: Paperclip,
};

const createEmptyDraft = (type: ArtifactType = "TEXT"): ArtifactDraft => ({
  mode: "create",
  type,
  title: "",
  content: "",
  url: "",
  fileKey: "",
  fileName: "",
  fileSize: null,
  fileType: "",
  fileUrl: "",
});

export function ProjectArtifacts({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);
  const utils = api.useUtils();
  const { data, isLoading } = api.artifact.list.useQuery({ projectId });
  const artifacts = useMemo(() => data ?? [], [data]);
  const systemContextArtifact = useMemo(
    () => artifacts.find((artifact) => isSystemContextArtifact(artifact)) ?? null,
    [artifacts]
  );
  const otherArtifacts = useMemo(
    () => artifacts.filter((artifact) => !isSystemContextArtifact(artifact)),
    [artifacts]
  );
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ArtifactType | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ArtifactDraft>(() => createEmptyDraft());
  const [textMode, setTextMode] = useState<"write" | "preview">("write");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { startUpload, isUploading } = useUploadThing("artifactFile", {
    onClientUploadComplete: (files) => {
      const file = files?.[0];
      if (!file) {
        return;
      }
      setDraft((prev) => ({
        ...prev,
        fileKey: file.key,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileUrl: file.url,
      }));
      setUploadError(null);
    },
    onUploadError: (error) => {
      setUploadError(error.message ?? "Upload failed");
    },
  });

  const visibleArtifacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return otherArtifacts.filter((artifact) => {
      const matchesType = typeFilter === "ALL" || artifact.type === typeFilter;
      const matchesSearch =
        !query ||
        artifact.title.toLowerCase().includes(query) ||
        (artifact.content ?? "").toLowerCase().includes(query) ||
        (artifact.url ?? "").toLowerCase().includes(query) ||
        (artifact.fileName ?? "").toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [otherArtifacts, search, typeFilter]);

  useEffect(() => {
    const hasArtifacts =
      visibleArtifacts.length > 0 || !!systemContextArtifact;
    if (!hasArtifacts) {
      setSelectedId(null);
      if (draft.mode === "edit") {
        setDraft(createEmptyDraft());
      }
      return;
    }
    if (
      selectedId &&
      !visibleArtifacts.some((item) => item.id === selectedId) &&
      selectedId !== systemContextArtifact?.id
    ) {
      setSelectedId(null);
    }
  }, [draft.mode, selectedId, systemContextArtifact?.id, visibleArtifacts]);

  useEffect(() => {
    if (draft.mode === "edit") {
      setTextMode("preview");
      return;
    }
    setTextMode("write");
  }, [draft.id, draft.mode, draft.type]);

  useEffect(() => {
    if (!selectedId) return;
    const artifact = artifacts.find((item) => item.id === selectedId);
    if (!artifact) return;
    setDraft({
      id: artifact.id,
      mode: "edit",
      type: artifact.type,
      title: artifact.title,
      content: artifact.content ?? "",
      url: artifact.url ?? "",
      fileKey: artifact.fileKey ?? "",
      fileName: artifact.fileName ?? "",
      fileSize: artifact.fileSize ?? null,
      fileType: artifact.fileType ?? "",
      fileUrl: artifact.fileUrl ?? "",
    });
  }, [artifacts, selectedId]);

  const syncArtifacts = (next: Artifact[]) => {
    utils.artifact.list.setData({ projectId }, next);
  };

  const createArtifact = api.artifact.create.useMutation({
    onSuccess: (created) => {
      const next = [created, ...artifacts];
      syncArtifacts(next);
      setSelectedId(created.id);
      setDraft({
        id: created.id,
        mode: "edit",
        type: created.type,
        title: created.title,
        content: created.content ?? "",
        url: created.url ?? "",
        fileKey: created.fileKey ?? "",
        fileName: created.fileName ?? "",
        fileSize: created.fileSize ?? null,
        fileType: created.fileType ?? "",
        fileUrl: created.fileUrl ?? "",
      });
      setUploadError(null);
      setPanelOpen(true);
    },
  });

  const updateArtifact = api.artifact.update.useMutation({
    onSuccess: (updated) => {
      const next = artifacts.map((item) =>
        item.id === updated.id ? updated : item
      );
      syncArtifacts(next);
      setSelectedId(updated.id);
      setPanelOpen(true);
    },
  });

  const deleteArtifact = api.artifact.delete.useMutation({
    onSuccess: (_, variables) => {
      const next = artifacts.filter((item) => item.id !== variables.id);
      syncArtifacts(next);
      setSelectedId(next[0]?.id ?? null);
      if (!next.length) {
        setPanelOpen(false);
      }
    },
  });

  const confirmDelete = (artifactId: string) => {
    setConfirmDeleteId(artifactId);
  };

  const openSystemContextPanel = () => {
    if (systemContextArtifact) {
      setSelectedId(systemContextArtifact.id);
      setDraft({
        id: systemContextArtifact.id,
        mode: "edit",
        type: "TEXT",
        title: SYSTEM_CONTEXT_ARTIFACT_TITLE,
        content: systemContextArtifact.content ?? "",
        url: "",
        fileKey: "",
        fileName: "",
        fileSize: null,
        fileType: "",
        fileUrl: "",
      });
    } else {
      setSelectedId(null);
      setDraft({
        ...createEmptyDraft("TEXT"),
        title: SYSTEM_CONTEXT_ARTIFACT_TITLE,
      });
    }
    setPanelOpen(true);
  };

  const handleDeleteConfirmed = () => {
    if (!confirmDeleteId) return;
    deleteArtifact.mutate({ id: confirmDeleteId });
    setConfirmDeleteId(null);
  };

  const handleSave = () => {
    const contentValue = effectiveType === "TEXT" ? draft.content : undefined;
    const urlValue = effectiveType === "LINK" ? draft.url : undefined;
    const filePayload =
      effectiveType === "FILE"
        ? {
            fileKey: draft.fileKey,
            fileName: draft.fileName,
            fileSize: draft.fileSize ?? undefined,
            fileType: draft.fileType,
            fileUrl: draft.fileUrl,
          }
        : {};

    if (draft.mode === "create") {
      createArtifact.mutate({
        projectId,
        type: effectiveType,
        title: effectiveTitle.trim(),
        content: contentValue,
        url: urlValue,
        ...filePayload,
      });
      return;
    }

    if (!draft.id) return;
    updateArtifact.mutate({
      id: draft.id,
      type: effectiveType,
      title: effectiveTitle.trim(),
      content: contentValue,
      url: urlValue,
      ...filePayload,
    });
  };

  const isSystemContextDraft = isSystemContextTitle(draft.title);
  const effectiveTitle = isSystemContextDraft
    ? SYSTEM_CONTEXT_ARTIFACT_TITLE
    : draft.title;
  const effectiveType = isSystemContextDraft ? "TEXT" : draft.type;
  const saveLabel = isSystemContextDraft
    ? draft.mode === "create"
      ? "Create system context"
      : "Save system context"
    : draft.mode === "create"
      ? "Create artifact"
      : "Save changes";
  const ActiveIcon = artifactTypeIcons[effectiveType];
  const isDraftValid = (() => {
    if (!effectiveTitle.trim()) return false;
    if (effectiveType === "TEXT") return !!draft.content.trim();
    if (effectiveType === "LINK") return !!draft.url.trim();
    if (effectiveType === "FILE") return !!draft.fileKey && !!draft.fileUrl;
    return true;
  })();
  const previewArtifact = useMemo(
    () => (previewId ? artifacts.find((item) => item.id === previewId) ?? null : null),
    [artifacts, previewId]
  );

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Artifacts</h3>
            <p className="text-sm text-muted-foreground">
              Capture notes, links, and files tied to this project.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition hover:bg-foreground/90"
            onClick={() => {
              setSelectedId(null);
              setDraft(createEmptyDraft());
              setPanelOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New artifact
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-full flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            placeholder="Search artifacts..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as ArtifactType | "ALL")
            }
          >
            <option value="ALL">All types</option>
            {Object.entries(artifactTypeLabels).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                System context
              </p>
              <p className="text-xs text-muted-foreground">
                Guides every brainstorm thread for this project.
              </p>
            </div>
            <button
              type="button"
              onClick={openSystemContextPanel}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
              {systemContextArtifact ? "Edit" : "Create"}
            </button>
          </div>
          <div className="mt-3 rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            {isLoading
              ? "Loading system context..."
              : systemContextArtifact?.content?.trim()
                ? systemContextArtifact.content
                : "No system context yet. Add it to align AI responses."}
          </div>
          {systemContextArtifact && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground">
              <LockIcon className="h-3 w-3" />
              Locked
            </div>
          )}
        </div>

        <div className="space-y-2">
          {isLoading && (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Loading artifacts...
            </div>
          )}
          {!isLoading && !visibleArtifacts.length && (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {systemContextArtifact
                ? "No additional artifacts yet. Add a note, link, or file to get started."
                : "No artifacts yet. Add a note, link, or file to get started."}
            </div>
          )}
          {visibleArtifacts.map((artifact) => {
            const Icon = artifactTypeIcons[artifact.type];
            const isActive = artifact.id === selectedId;
            const isImage =
              artifact.type === "FILE" && (artifact.fileType ?? "").startsWith("image/");
            return (
              <div
                key={artifact.id}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition",
                  isActive
                    ? "border-foreground/30 bg-foreground/5"
                    : "border-border bg-background hover:border-foreground/20"
                )}
              >
                <button
                  className="flex flex-1 items-start gap-3 text-left"
                  type="button"
                  onClick={() => {
                    setSelectedId(artifact.id);
                    setPanelOpen(true);
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
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                    onClick={() => setPreviewId(artifact.id)}
                  >
                    <Eye className="h-3 w-3" />
                    Preview
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                    onClick={() => confirmDelete(artifact.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Transition show={panelOpen} as={Fragment}>
        <Dialog onClose={setPanelOpen} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>
          <div className="fixed inset-0 flex justify-end">
            <Transition.Child
              as={Fragment}
              enter="transition-transform duration-200"
              enterFrom="translate-x-full"
              enterTo="translate-x-0"
              leave="transition-transform duration-150"
              leaveFrom="translate-x-0"
              leaveTo="translate-x-full"
            >
              <DialogPanel
                className="h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card p-6 shadow-xl"
                style={themeStyle}
              >
                <DialogTitle className="flex items-start justify-between gap-3">
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
                    {draft.mode === "edit" && draft.id && !isSystemContextDraft && (
                      <button
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                        onClick={() => confirmDelete(draft.id ?? "")}
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </button>
                    )}
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                      onClick={() => setPanelOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </DialogTitle>

                <div className="mt-6 space-y-4">
                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Type
                    </label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                      value={effectiveType}
                      onChange={(event) => {
                        const nextType = event.target.value as ArtifactType;
                        setDraft((prev) => ({
                          ...createEmptyDraft(nextType),
                          title: prev.title,
                          mode: prev.mode,
                          id: prev.id,
                        }));
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
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                      placeholder="Name this artifact"
                      value={effectiveTitle}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, title: event.target.value }))
                      }
                      disabled={isSystemContextDraft}
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
                              className={cn(
                                "rounded-md px-3 py-1 transition",
                                textMode === mode
                                  ? "bg-background text-foreground shadow-sm"
                                  : "text-muted-foreground"
                              )}
                              onClick={() => setTextMode(mode)}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>
                      {textMode === "write" ? (
                        <textarea
                          className="min-h-[220px] w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                          placeholder="Write your note in markdown..."
                          value={draft.content}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, content: event.target.value }))
                          }
                        />
                      ) : (
                        <div className="min-h-[220px] rounded-lg border border-border bg-background px-4 py-3">
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
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                        placeholder="https://"
                        value={draft.url}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, url: event.target.value }))
                        }
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
                      <div className="rounded-lg border border-dashed border-border bg-background p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground">
                            <UploadCloud className="h-4 w-4" />
                            {isUploading ? "Uploading..." : "Upload file"}
                            <input
                              className="hidden"
                              type="file"
                              onChange={(event) => {
                                const files = event.target.files;
                                if (!files?.length) return;
                                startUpload(Array.from(files));
                              }}
                              disabled={isUploading}
                            />
                          </label>
                          {draft.fileName && (
                            <div className="text-sm text-foreground">
                              <p className="font-semibold">{draft.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {draft.fileType || "File"}{" "}
                                {draft.fileSize
                                  ? `· ${(draft.fileSize / 1024).toFixed(1)} KB`
                                  : ""}
                              </p>
                            </div>
                          )}
                        </div>
                        {uploadError && (
                          <p className="mt-2 text-xs text-red-500">{uploadError}</p>
                        )}
                      </div>
                      {draft.fileUrl && (draft.fileType ?? "").startsWith("image/") ? (
                        <div className="space-y-2">
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
                            Open image
                          </a>
                        </div>
                      ) : null}
                      {draft.fileUrl && !(draft.fileType ?? "").startsWith("image/") ? (
                        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{draft.fileName || "File"}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {(draft.fileType || "File") +
                              (draft.fileSize
                                ? ` · ${(draft.fileSize / 1024).toFixed(1)} KB`
                                : "")}
                          </p>
                          <a
                            className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                            href={draft.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Paperclip className="h-3 w-3" />
                            Download file
                          </a>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-background transition",
                        isDraftValid
                          ? "bg-foreground hover:bg-foreground/90"
                          : "cursor-not-allowed bg-muted text-muted-foreground"
                      )}
                      disabled={!isDraftValid}
                      onClick={handleSave}
                    >
                      <Save className="h-4 w-4" /> {saveLabel}
                    </button>
                    {draft.mode === "edit" && (
                      <button
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                        onClick={() => {
                          if (!draft.id) return;
                          const artifact = artifacts.find((item) => item.id === draft.id);
                          if (!artifact) return;
                          setDraft({
                            id: artifact.id,
                            mode: "edit",
                            type: artifact.type,
                            title: artifact.title,
                            content: artifact.content ?? "",
                            url: artifact.url ?? "",
                            fileKey: artifact.fileKey ?? "",
                            fileName: artifact.fileName ?? "",
                            fileSize: artifact.fileSize ?? null,
                            fileType: artifact.fileType ?? "",
                            fileUrl: artifact.fileUrl ?? "",
                          });
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {(createArtifact.error || updateArtifact.error) && (
                    <p className="text-xs text-red-500">
                      {createArtifact.error?.message ?? updateArtifact.error?.message}
                    </p>
                  )}
                </div>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      <Transition show={!!previewArtifact} as={Fragment}>
        <Dialog onClose={() => setPreviewId(null)} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="transition-transform duration-200"
              enterFrom="scale-95 opacity-0"
              enterTo="scale-100 opacity-100"
              leave="transition-transform duration-150"
              leaveFrom="scale-100 opacity-100"
              leaveTo="scale-95 opacity-0"
            >
              <DialogPanel className="w-full max-w-2xl max-h-[80vh] rounded-xl border border-border bg-card p-6 shadow-xl flex flex-col overflow-hidden">
                <DialogTitle className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Artifact preview
                    </p>
                    <h3 className="text-lg font-semibold text-foreground">
                      {previewArtifact?.title || "Untitled"}
                    </h3>
                  </div>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                    onClick={() => setPreviewId(null)}
                  >
                    Close
                  </button>
                </DialogTitle>

                <div className="mt-4 space-y-4 overflow-y-auto pr-1">
                  {previewArtifact?.type === "TEXT" && (
                    <div className="rounded-lg border border-border bg-background px-4 py-3">
                      {previewArtifact.content ? (
                        <ChatMarkdown content={previewArtifact.content} />
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No content available.
                        </p>
                      )}
                    </div>
                  )}

                  {previewArtifact?.type === "LINK" && (
                    <div className="rounded-lg border border-border bg-background p-4">
                      <p className="text-sm text-muted-foreground">Link</p>
                      <a
                        className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                        href={previewArtifact.url ?? ""}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link2 className="h-4 w-4" /> {previewArtifact.url}
                      </a>
                    </div>
                  )}

                  {previewArtifact?.type === "FILE" && (
                    <div className="rounded-lg border border-border bg-background p-4">
                      {(previewArtifact.fileType ?? "").startsWith("image/") &&
                      previewArtifact.fileUrl ? (
                        <div className="space-y-3">
                          <div className="overflow-hidden rounded-lg border border-border bg-background">
                            <img
                              src={previewArtifact.fileUrl}
                              alt={previewArtifact.fileName || "Artifact image"}
                              className="h-auto w-full object-cover"
                            />
                          </div>
                          <a
                            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                            href={previewArtifact.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ImageIcon className="h-4 w-4" />
                            Open image
                          </a>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold text-foreground">
                              {previewArtifact.fileName || "File"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {(previewArtifact.fileType || "File") +
                              (previewArtifact.fileSize
                                ? ` · ${(previewArtifact.fileSize / 1024).toFixed(1)} KB`
                                : "")}
                          </p>
                          {previewArtifact.fileUrl && (
                            <a
                              className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline"
                              href={previewArtifact.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Paperclip className="h-3 w-3" />
                              Download file
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      <Transition show={!!confirmDeleteId} as={Fragment}>
        <Dialog onClose={() => setConfirmDeleteId(null)} className="relative z-50">
          <Transition.Child
            as={Fragment}
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
          </Transition.Child>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="transition-transform duration-200"
              enterFrom="scale-95 opacity-0"
              enterTo="scale-100 opacity-100"
              leave="transition-transform duration-150"
              leaveFrom="scale-100 opacity-100"
              leaveTo="scale-95 opacity-0"
            >
              <DialogPanel className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <DialogTitle className="text-lg font-semibold text-foreground">
                  Delete artifact?
                </DialogTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  This will remove the artifact and any uploaded file. This action
                  cannot be undone.
                </p>
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:bg-foreground/90"
                    onClick={handleDeleteConfirmed}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </DialogPanel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
