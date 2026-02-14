"use client";

import { useCallback } from "react";
import { CheckIcon, CopyIcon, FileTextIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { brand, couldnt } from "@/lib/brand";

export function getMessageCopyText(content: string): string {
  return content;
}

type MessageActionsProps = {
  messageId: string;
  messageContent: string;
  onRegenerate?: (messageId: string) => void;
  canRegenerate?: boolean;
  isPending?: boolean;
  onSaveAsNote?: (messageId: string) => void;
  isSavingNote?: boolean;
  isSavedNote?: boolean;
};

export function MessageActions({
  messageId,
  messageContent,
  onRegenerate,
  canRegenerate,
  isPending,
  onSaveAsNote,
  isSavingNote,
  isSavedNote,
}: MessageActionsProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        getMessageCopyText(messageContent)
      );
      toast.success("Copied.");
    } catch {
      toast.error(couldnt("copy that"));
    }
  }, [messageContent]);

  return (
    <>
      <Button
        type="button"
        onClick={handleCopy}
        variant="ghost"
        size="xs"
        className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium"
        title="Copy response"
        aria-label="Copy response to clipboard"
      >
        <CopyIcon className="h-3 w-3" />
        Copy
      </Button>
      {isSavedNote ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <CheckIcon className="h-3 w-3" />
          {`Saved to ${brand.terms.library.toLowerCase()}`}
        </span>
      ) : onSaveAsNote ? (
        <Button
          type="button"
          onClick={() => onSaveAsNote(messageId)}
          disabled={isSavingNote || isPending}
          variant="ghost"
          size="xs"
          className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium"
          title={`Save to ${brand.terms.library.toLowerCase()}`}
        >
          <FileTextIcon className="h-3 w-3" />
          {`Save to ${brand.terms.library.toLowerCase()}`}
        </Button>
      ) : null}
      {onRegenerate && (
        <Button
          type="button"
          onClick={() => onRegenerate(messageId)}
          disabled={!canRegenerate || isPending}
          variant="ghost"
          size="xs"
          className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium"
          title="Regenerate response"
        >
          <RotateCcwIcon className="h-3 w-3" />
          Regenerate
        </Button>
      )}
    </>
  );
}
