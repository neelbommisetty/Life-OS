"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { parseSSEChunk, handleStreamError } from "@/lib/chat-utils";
import type { ChatMessage } from "@prisma/client";

type UseChatStreamingParams = {
  pageSize: number;
  messages: ChatMessage[];
  onInvalidate: (threadId: string) => void;
};

export function useChatStreaming({
  pageSize,
  messages,
  onInvalidate,
}: UseChatStreamingParams) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<
    string | null
  >(null);
  const [optimisticStatus, setOptimisticStatus] = useState<
    "sending" | "failed" | null
  >(null);
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(
    null
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(
    null
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const didInvalidateAfterStreamRef = useRef(false);

  // Clear optimistic/streaming UI once we observe the saved assistant message in the query data
  useEffect(() => {
    if (!pendingAssistantId) return;
    const found = messages.some((m) => m.id === pendingAssistantId);
    if (!found) return;

    setPendingAssistantId(null);
    setStreamingContent("");
    setOptimisticUserMessage(null);
    setOptimisticStatus(null);
    setStreamError(null);
    didInvalidateAfterStreamRef.current = false;
  }, [messages, pendingAssistantId]);

  // Clear optimistic message if it appears in the messages list
  useEffect(() => {
    if (!optimisticUserMessage || optimisticStatus !== "failed") return;
    const found = messages.some(
      (m) => m.role === "USER" && m.content === optimisticUserMessage
    );
    if (!found) return;
    setOptimisticUserMessage(null);
    setOptimisticStatus(null);
    setStreamError(null);
  }, [messages, optimisticStatus, optimisticUserMessage]);

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleStreamRequest = useCallback(
    async ({
      threadId,
      content,
      regenerateFromMessageId,
    }: {
      threadId: string;
      content?: string;
      regenerateFromMessageId?: string;
    }) => {
      setIsStreaming(true);
      setStreamingContent("");
      setOptimisticUserMessage(content ?? null);
      setOptimisticStatus(content ? "sending" : null);
      setPendingAssistantId(null);
      setStreamError(null);
      setStreamingThreadId(threadId);
      didInvalidateAfterStreamRef.current = false;

      // Create abort controller
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            ...(content ? { content } : {}),
            ...(regenerateFromMessageId
              ? { regenerateFromMessageId }
              : {}),
          }),
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

          // Process only complete SSE events (delimited by blank line)
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
                // Mark stream as finished, but keep the streamed bubble visible until the DB-backed message arrives
                setIsStreaming(false);
                setPendingAssistantId(event.messageId);

                if (!didInvalidateAfterStreamRef.current) {
                  didInvalidateAfterStreamRef.current = true;
                  onInvalidate(threadId);
                }
              } else if (event.type === "done") {
                // Server finished sending. If we haven't invalidated yet, do it once now
                setIsStreaming(false);
                if (!didInvalidateAfterStreamRef.current) {
                  didInvalidateAfterStreamRef.current = true;
                  onInvalidate(threadId);
                }
              }
            }
          }
        }

        // Stream ended. Keep the optimistic bubbles until the saved message shows up
        setIsStreaming(false);
        abortControllerRef.current = null;
      } catch (error) {
        const shouldKeepOptimistic =
          Boolean(content) &&
          !(error instanceof Error && error.name === "AbortError");

        // Handle abort gracefully
        if (error instanceof Error && error.name === "AbortError") {
          // User cancelled - keep whatever we've rendered, and refresh in background
          setIsStreaming(false);
          if (!didInvalidateAfterStreamRef.current) {
            didInvalidateAfterStreamRef.current = true;
            onInvalidate(threadId);
          }
        } else {
          // On error, show error message
          const errorMessage = handleStreamError(error);
          setStreamError(errorMessage);
          setOptimisticStatus(content ? "failed" : null);
        }

        setIsStreaming(false);
        setStreamingContent("");
        if (!shouldKeepOptimistic) {
          setOptimisticUserMessage(null);
          setOptimisticStatus(null);
        }
        setPendingAssistantId(null);
        abortControllerRef.current = null;
      }
    },
    [onInvalidate]
  );

  const handleStreamingSubmit = useCallback(
    async (content: string, threadId: string) => {
      await handleStreamRequest({ threadId, content });
    },
    [handleStreamRequest]
  );

  const handleRegenerate = useCallback(
    async (messageId: string, threadId: string) => {
      await handleStreamRequest({
        threadId,
        regenerateFromMessageId: messageId,
      });
    },
    [handleStreamRequest]
  );

  return {
    isStreaming,
    streamingThreadId,
    streamingContent,
    optimisticUserMessage,
    optimisticStatus,
    pendingAssistantId,
    streamError,
    handleStreamingSubmit,
    handleStopStreaming,
    handleRegenerate,
  };
}
