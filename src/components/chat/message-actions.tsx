"use client";

import { useCallback } from "react";
import { CopyIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function getMessageCopyText(content: string): string {
  return content;
}

type MessageActionsProps = {
  messageId: string;
  messageContent: string;
  onRegenerate?: (messageId: string) => void;
  canRegenerate?: boolean;
  isPending?: boolean;
};

export function MessageActions({
  messageId,
  messageContent,
  onRegenerate,
  canRegenerate,
  isPending,
}: MessageActionsProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        getMessageCopyText(messageContent)
      );
      toast.success("Copied to clipboard");
    } catch (error) {
      toast.error("Failed to copy");
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
