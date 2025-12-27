"use client";

import { Plus } from "lucide-react";
import { getProjectTheme } from "@/lib/project-theme";
import {
  ArtifactList,
  ArtifactForm,
  ArtifactPreview,
  ArtifactDeleteDialog,
  useArtifacts,
} from "./artifact-list";
import { LockIcon } from "lucide-react";

type Props = {
  projectId: string;
  accentColor?: string | null;
};

export function ProjectArtifacts({ projectId, accentColor }: Props) {
  const themeStyle = getProjectTheme(accentColor);

  const {
    artifacts,
    isLoading,
    systemContextArtifact,
    visibleArtifacts,
    search,
    setSearch,
    typeFilter,
    setTypeFilter,
    selectedId,
    setSelectedId,
    draft,
    setDraft,
    panelOpen,
    setPanelOpen,
    previewId,
    setPreviewId,
    confirmDeleteId,
    setConfirmDeleteId,
    uploadError,
    handleSave,
    handleDelete,
    openSystemContextPanel,
    isSaving,
    isDeleting,
    startUpload,
    isUploading,
    textMode,
    setTextMode,
  } = useArtifacts(projectId);

  const previewArtifact = previewId
    ? artifacts.find((a) => a.id === previewId) ?? null
    : null;

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
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition hover:bg-foreground/90 shadow-sm"
            onClick={() => {
              setSelectedId(null);
              setDraft({ mode: "create", type: "TEXT", title: "", content: "", url: "", fileKey: "", fileName: "", fileSize: null, fileType: "", fileUrl: "" });
              setPanelOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New artifact
          </button>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                System context
              </p>
              <p className="text-xs text-muted-foreground">
                Guides every brainstorm thread for this project.
              </p>
            </div>
            <button
              type="button"
              onClick={openSystemContextPanel}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted shadow-sm"
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
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground bg-background/50">
              <LockIcon className="h-3 w-3" />
              Locked
            </div>
          )}
        </div>

        <ArtifactList
          artifacts={visibleArtifacts}
          systemContextArtifact={systemContextArtifact}
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setPanelOpen(true);
          }}
          onPreview={setPreviewId}
          onDelete={setConfirmDeleteId}
          isLoading={isLoading}
        />
      </section>

      <ArtifactForm
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        draft={draft}
        onDraftChange={setDraft}
        onSave={handleSave}
        onDelete={(id) => setConfirmDeleteId(id)}
        isSaving={isSaving}
        uploadError={uploadError}
        isUploading={isUploading}
        startUpload={startUpload}
        textMode={textMode}
        onTextModeChange={setTextMode}
        themeStyle={themeStyle}
      />

      <ArtifactPreview
        open={!!previewArtifact}
        artifact={previewArtifact}
        onClose={() => setPreviewId(null)}
      />

      <ArtifactDeleteDialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) {
            handleDelete(confirmDeleteId);
            setConfirmDeleteId(null);
          }
        }}
        isDeleting={isDeleting}
      />
    </div>
  );
}
