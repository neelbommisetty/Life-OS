import type { Artifact, ArtifactType } from "@prisma/client";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { artifactTypeLabels } from "./types";
import { ArtifactCard } from "./artifact-card";

export type ArtifactListProps = {
  artifacts: Artifact[];
  systemContextArtifact?: Artifact | null;
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: ArtifactType | "ALL";
  onTypeFilterChange: (type: ArtifactType | "ALL") => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
};

export function ArtifactList({
  artifacts,
  systemContextArtifact,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  selectedId,
  onSelect,
  onPreview,
  onDelete,
  isLoading,
}: ArtifactListProps) {
  const types: (ArtifactType | "ALL")[] = ["ALL", "TEXT", "LINK", "FILE"];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search artifacts..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onTypeFilterChange(type)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                typeFilter === type
                  ? "bg-foreground text-background shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {type === "ALL" ? "All types" : artifactTypeLabels[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {isLoading && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Loading artifacts...
          </div>
        )}

        {!isLoading && !artifacts.length && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {systemContextArtifact
              ? "No matching artifacts found."
              : "No artifacts yet. Add a note, link, or file to get started."}
          </div>
        )}

        {!isLoading && artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.id}
            artifact={artifact}
            isActive={artifact.id === selectedId}
            onSelect={() => onSelect(artifact.id)}
            onPreview={() => onPreview(artifact.id)}
            onDelete={() => onDelete(artifact.id)}
          />
        ))}
      </div>
    </div>
  );
}
