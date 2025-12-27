import { useMemo, useState, startTransition, useEffect } from "react";
import type { Artifact, ArtifactType } from "@prisma/client";
import { api } from "@/trpc/client";
import {
  SYSTEM_CONTEXT_ARTIFACT_TITLE,
  isSystemContextArtifact,
  isSystemContextTitle,
} from "@/lib/system-context";
import { useUploadThing } from "@/lib/uploadthing";
import { type ArtifactDraft, createEmptyDraft } from "./types";

export function useArtifacts(projectId: string) {
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [textMode, setTextMode] = useState<"write" | "preview">("write");

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
    const hasArtifacts = visibleArtifacts.length > 0 || !!systemContextArtifact;
    if (!hasArtifacts) {
      startTransition(() => {
        setSelectedId(null);
        if (draft.mode === "edit") {
          setDraft(createEmptyDraft());
        }
      });
      return;
    }
    if (
      selectedId &&
      !visibleArtifacts.some((item) => item.id === selectedId) &&
      selectedId !== systemContextArtifact?.id
    ) {
      startTransition(() => {
        setSelectedId(null);
      });
    }
  }, [draft.mode, selectedId, systemContextArtifact, visibleArtifacts]);

  useEffect(() => {
    if (!selectedId) return;
    const artifact = artifacts.find((item) => item.id === selectedId);
    if (!artifact) return;
    startTransition(() => {
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

  const handleSave = () => {
    const isSystemContextDraft = isSystemContextTitle(draft.title);
    const effectiveTitle = isSystemContextDraft
      ? SYSTEM_CONTEXT_ARTIFACT_TITLE
      : draft.title;
    const effectiveType = isSystemContextDraft ? "TEXT" : draft.type;

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

  return {
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
    setUploadError,
    handleSave,
    handleDelete: (id: string) => deleteArtifact.mutate({ id }),
    openSystemContextPanel,
    isSaving: createArtifact.isPending || updateArtifact.isPending,
    isDeleting: deleteArtifact.isPending,
    error: createArtifact.error?.message ?? updateArtifact.error?.message ?? deleteArtifact.error?.message ?? null,
    startUpload,
    isUploading,
    textMode,
    setTextMode,
  };
}
