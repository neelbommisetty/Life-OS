import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/trpc/client";
import { parseSSEChunk, handleStreamError } from "@/lib/chat-utils";
import type { ChatMessage } from "@prisma/client";

type UseChatStreamingParams = {
  projectId: string;
  pageSize: number;
  messages: ChatMessage[];
  sendMessageMutation: {
    mutate: (params: { projectId: string; content: string }) => void;
  };
};

export function useChatStreaming({
  projectId,
  pageSize,
  messages,
  sendMessageMutation,
}: UseChatStreamingParams) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<
    string | null
  >(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(
    null
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const didInvalidateAfterStreamRef = useRef(false);

  const utils = api.useUtils();

  // Clear optimistic/streaming UI once we observe the saved assistant message in the query data.
  useEffect(() => {
    if (!pendingAssistantId) return;
    const found = messages.some((m) => m.id === pendingAssistantId);
    if (!found) return;

    setPendingAssistantId(null);
    setStreamingContent("");
    setOptimisticUserMessage(null);
    setStreamError(null);
    didInvalidateAfterStreamRef.current = false;
  }, [messages, pendingAssistantId]);

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleStreamingSubmit = useCallback(
    async (content: string) => {
      setIsStreaming(true);
      setStreamingContent("");
      setOptimisticUserMessage(content);
      setPendingAssistantId(null);
      setStreamError(null);
      didInvalidateAfterStreamRef.current = false;

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, content }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Stream request failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process only complete SSE events (delimited by blank line).
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const events = parseSSEChunk(part);

            for (const event of events) {
              if (event.type === "chunk" && event.text) {
                setStreamingContent((prev) => prev + event.text);
              } else if (event.type === "error") {
                setStreamError(event.error || "Stream error occurred");
              } else if (event.type === "message_saved" && event.messageId) {
                // Mark stream as finished, but keep the streamed bubble visible until the DB-backed message arrives.
                setIsStreaming(false);
                setPendingAssistantId(event.messageId);

                if (!didInvalidateAfterStreamRef.current) {
                  didInvalidateAfterStreamRef.current = true;
                  utils.chat.listMessages.invalidate({
                    projectId,
                    limit: pageSize,
                  });
                  utils.chat.getThread.invalidate({ projectId });
                }
              } else if (event.type === "done") {
                // Server finished sending. If we haven't invalidated yet, do it once now.
                setIsStreaming(false);
                if (!didInvalidateAfterStreamRef.current) {
                  didInvalidateAfterStreamRef.current = true;
                  utils.chat.listMessages.invalidate({
                    projectId,
                    limit: pageSize,
                  });
                  utils.chat.getThread.invalidate({ projectId });
                }
              }
            }
          }
        }

        // Stream ended. Keep the optimistic bubbles until the saved message shows up.
        setIsStreaming(false);
        abortControllerRef.current = null;
      } catch (error) {
        // Handle abort gracefully
        if (error instanceof Error && error.name === "AbortError") {
          // User cancelled - keep whatever we've rendered, and refresh in background.
          setIsStreaming(false);
          if (!didInvalidateAfterStreamRef.current) {
            didInvalidateAfterStreamRef.current = true;
            utils.chat.listMessages.invalidate({ projectId, limit: pageSize });
            utils.chat.getThread.invalidate({ projectId });
          }
        } else {
          // On error, fall back to blocking mutation
          const errorMessage = handleStreamError(error);
          setStreamError(errorMessage);

          // Fallback to blocking mutation
          console.warn(
            "Streaming failed, falling back to blocking mutation:",
            error
          );
          sendMessageMutation.mutate({
            projectId,
            content,
          });
        }

        setIsStreaming(false);
        setStreamingContent("");
        setOptimisticUserMessage(null);
        setPendingAssistantId(null);
        abortControllerRef.current = null;
      }
    },
    [
      projectId,
      utils.chat.listMessages,
      utils.chat.getThread,
      sendMessageMutation,
      pageSize,
    ]
  );

  return {
    isStreaming,
    streamingContent,
    optimisticUserMessage,
    pendingAssistantId,
    streamError,
    handleStreamingSubmit,
    handleStopStreaming,
  };
}

