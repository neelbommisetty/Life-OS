"use client";

import { useCallback, useRef, useLayoutEffect } from "react";

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
  const forceScrollToBottomRef = useRef(true);
  const previousScrollHeightRef = useRef<number | null>(null);
  const previousScrollTopRef = useRef(0);
  const lastThreadIdRef = useRef<string | null>(null);
  const threadSwitchScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const threadSwitchScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const scrollToBottom = useCallback((container: HTMLDivElement) => {
    container.scrollTop = container.scrollHeight;
  }, []);

  const clearThreadSwitchScrollLock = useCallback(() => {
    if (threadSwitchScrollIntervalRef.current) {
      clearInterval(threadSwitchScrollIntervalRef.current);
      threadSwitchScrollIntervalRef.current = null;
    }
    if (threadSwitchScrollTimeoutRef.current) {
      clearTimeout(threadSwitchScrollTimeoutRef.current);
      threadSwitchScrollTimeoutRef.current = null;
    }
  }, []);

  // Reset scroll state when thread changes
  useLayoutEffect(() => {
    clearThreadSwitchScrollLock();
    hasAutoScrolledRef.current = false;
    shouldAutoScrollRef.current = true;
    forceScrollToBottomRef.current = true;
    previousScrollHeightRef.current = null;
    previousScrollTopRef.current = 0;
    lastThreadIdRef.current = null;
  }, [threadId, clearThreadSwitchScrollLock]);

  useLayoutEffect(() => {
    return () => {
      clearThreadSwitchScrollLock();
    };
  }, [clearThreadSwitchScrollLock]);

  // Scroll to bottom on thread change
  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (isLoading || isFetchingNextPage) return;

    if (lastThreadIdRef.current !== threadId) {
      lastThreadIdRef.current = threadId;
      scrollToBottom(container);
      hasAutoScrolledRef.current = true;

      threadSwitchScrollIntervalRef.current = setInterval(() => {
        const currentContainer = messagesContainerRef.current;
        if (!currentContainer || !forceScrollToBottomRef.current) return;
        scrollToBottom(currentContainer);
      }, 50);

      threadSwitchScrollTimeoutRef.current = setTimeout(() => {
        clearThreadSwitchScrollLock();
        forceScrollToBottomRef.current = false;
      }, 900);
    }
  }, [
    threadId,
    isLoading,
    isFetchingNextPage,
    messagesLength,
    clearThreadSwitchScrollLock,
    scrollToBottom,
  ]);

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
      scrollToBottom(container);
      hasAutoScrolledRef.current = true;
      return;
    }

    // Auto-scroll if user was at the bottom
    if (
      (forceScrollToBottomRef.current || shouldAutoScrollRef.current) &&
      !isFetchingNextPage
    ) {
      scrollToBottom(container);
    }
  }, [
    messagesLength,
    isLoading,
    isFetchingNextPage,
    isPending,
    streamingContent,
    scrollToBottom,
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
