import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FolderIcon } from "lucide-react";

interface ProjectBadgeProps {
  projectId: string;
  projectName: string;
  className?: string;
}

export function ProjectBadge({ projectId, projectName, className }: ProjectBadgeProps) {
  return (
    <Link href={`/projects/${projectId}`}>
      <Badge
        variant="secondary"
        className={`flex items-center gap-1 hover:bg-secondary/80 cursor-pointer ${className || ""}`}
      >
        <FolderIcon className="h-3 w-3" />
        {projectName}
      </Badge>
    </Link>
  );
}
