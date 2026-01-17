import type { ArtifactType } from "@prisma/client";

import { FileText, Link2, Paperclip } from "lucide-react";

export type ArtifactDraft = {
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

export const artifactTypeLabels: Record<ArtifactType, string> = {
  TEXT: "Text",
  LINK: "Link",
  FILE: "File",
};

export const artifactTypeIcons: Record<ArtifactType, typeof FileText> = {
  TEXT: FileText,
  LINK: Link2,
  FILE: Paperclip,
};

export const createEmptyDraft = (type: ArtifactType = "TEXT"): ArtifactDraft => ({
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
