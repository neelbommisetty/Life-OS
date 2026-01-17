import { Dialog } from "@/components/ui/native-dialog";
import { Trash2, AlertTriangle } from "lucide-react";

export type ArtifactDeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
};

export function ArtifactDeleteDialog({
  open,
  onClose,
  onConfirm,
  isDeleting,
}: ArtifactDeleteDialogProps) {
  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      hideCloseButton
      className="text-center"
      size="sm"
    >
      <div className="flex flex-col items-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 mb-4">
          <AlertTriangle className="h-6 w-6 text-red-600" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Delete artifact?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This will remove the artifact and any uploaded file. This action
          cannot be undone.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3 w-full">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 shadow-sm"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : (
              <>
                <Trash2 className="h-4 w-4" />
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
