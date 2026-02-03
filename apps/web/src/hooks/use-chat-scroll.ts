"use client";

import { useRef, useLayoutEffect } from "react";

type UseChatScrollParams = {
  threadId: string | null;
  messagesLength: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isPending: boolean;
  streamingContent: string;
};

export function useChatScroll({
  threadId,
  messagesLength,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  isPending,
  streamingContent,
}: UseChatScrollParams) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const shouldAutoScrollRef = useRef(true);
  const previousScrollHeightRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const lastThreadIdRef = useRef<string | null>(null);

  // Reset scroll state when thread changes
  useLayoutEffect(() => {
    hasAutoScrolledRef.current = false;
    shouldAutoScrollRef.current = true;
    previousScrollHeightRef.current = null;
    previousScrollTopRef.current = 0;
    lastThreadIdRef.current = null;
  }, [threadId]);

  // Scroll to bottom on thread change
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (isLoading || isFetchingNextPage) return;

    if (lastThreadIdRef.current !== threadId) {
      lastThreadIdRef.current = threadId;
      container.scrollTop = container.scrollHeight;
      hasAutoScrolledRef.current = true;
    }
  }, [threadId, isLoading, isFetchingNextPage, messagesLength]);

  // Handle scroll events for infinite scroll and auto-scroll detection
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Check if user is near the bottom for auto-scroll
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;

    // Trigger infinite scroll when near the top
    if (
      container.scrollTop < 80 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      previousScrollHeightRef.current = container.scrollHeight;
      previousScrollTopRef.current = container.scrollTop;
      fetchNextPage();
    }
  };

  // Auto-scroll to bottom on new messages
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Initial scroll to bottom
    if (!hasAutoScrolledRef.current && !isLoading) {
      container.scrollTop = container.scrollHeight;
      hasAutoScrolledRef.current = true;
      return;
    }

    // Auto-scroll if user was at the bottom
    if (shouldAutoScrollRef.current && !isFetchingNextPage) {
      container.scrollTop = container.scrollHeight;
    }
  }, [
    messagesLength,
    isLoading,
    isFetchingNextPage,
    isPending,
    streamingContent,
  ]);

  // Preserve scroll position after loading older messages
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (previousScrollHeightRef.current === null) return;
    if (isFetchingNextPage) return;

    const previousScrollHeight = previousScrollHeightRef.current;
    const previousScrollTop = previousScrollTopRef.current;
    container.scrollTop =
      container.scrollHeight - previousScrollHeight + previousScrollTop;
    previousScrollHeightRef.current = null;
  }, [messagesLength, isFetchingNextPage]);

  return {
    messagesContainerRef,
    handleScroll,
  };
}
