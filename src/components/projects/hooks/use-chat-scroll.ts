import { useRef, useLayoutEffect } from "react";

type UseChatScrollParams = {
  messagesLength: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isPending: boolean;
  streamingContent: string;
};

export function useChatScroll({
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

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 80;

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

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!hasAutoScrolledRef.current && !isLoading) {
      container.scrollTop = container.scrollHeight;
      hasAutoScrolledRef.current = true;
      return;
    }

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

