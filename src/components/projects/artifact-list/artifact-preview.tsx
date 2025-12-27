import { Fragment } from "react";
import { Dialog, DialogPanel, DialogTitle, Transition } from "@headlessui/react";
import type { Artifact } from "@prisma/client";
import { ImageIcon, Link2, Paperclip, FileText, X } from "lucide-react";
import { ChatMarkdown } from "@/components/projects/chat-markdown";

export type ArtifactPreviewProps = {
  artifact: Artifact | null;
  open: boolean;
  onClose: () => void;
};

export function ArtifactPreview({
  artifact,
  open,
  onClose,
}: ArtifactPreviewProps) {
  if (!artifact) return null;

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
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
                    {artifact.title || "Untitled"}
                  </h3>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              </DialogTitle>

              <div className="mt-4 space-y-4 overflow-y-auto pr-1">
                {artifact.type === "TEXT" && (
                  <div className="rounded-lg border border-border bg-background px-4 py-3">
                    {artifact.content ? (
                      <ChatMarkdown content={artifact.content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No content available.
                      </p>
                    )}
                  </div>
                )}

                {artifact.type === "LINK" && (
                  <div className="rounded-lg border border-border bg-background p-4 flex flex-col items-center justify-center min-h-[120px]">
                    <Link2 className="h-10 w-10 text-primary mb-3" />
                    <p className="text-sm text-muted-foreground font-medium mb-4">External Link</p>
                    <a
                      className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:bg-foreground/90"
                      href={artifact.url ?? ""}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Link <Link2 className="h-4 w-4" />
                    </a>
                    <p className="mt-4 text-xs text-muted-foreground truncate max-w-full">
                      {artifact.url}
                    </p>
                  </div>
                )}

                {artifact.type === "FILE" && (
                  <div className="rounded-lg border border-border bg-background p-4">
                    {(artifact.fileType ?? "").startsWith("image/") &&
                    artifact.fileUrl ? (
                      <div className="space-y-3">
                        <div className="overflow-hidden rounded-lg border border-border bg-background">
                          <img
                            src={artifact.fileUrl}
                            alt={artifact.fileName || "Artifact image"}
                            className="h-auto w-full object-cover"
                          />
                        </div>
                        <a
                          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                          href={artifact.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ImageIcon className="h-4 w-4" />
                          Open full image
                        </a>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-6">
                        <div className="rounded-full bg-muted p-4 mb-4">
                          <FileText className="h-10 w-10 text-primary" />
                        </div>
                        <span className="font-semibold text-foreground text-lg mb-1">
                          {artifact.fileName || "File"}
                        </span>
                        <p className="text-sm text-muted-foreground mb-6">
                          {(artifact.fileType || "File") +
                            (artifact.fileSize
                              ? ` · ${(artifact.fileSize / 1024).toFixed(1)} KB`
                              : "")}
                        </p>
                        {artifact.fileUrl && (
                          <a
                            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-6 py-2.5 text-sm font-semibold text-background transition hover:bg-foreground/90 shadow-sm"
                            href={artifact.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Paperclip className="h-4 w-4" />
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
  );
}
