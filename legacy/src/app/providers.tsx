"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { api, createClient } from "@/trpc/client";
import { makeQueryClient } from "@/trpc/query-client";

type Props = {
  children: React.ReactNode;
};

let browserQueryClient: ReturnType<typeof makeQueryClient> | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: use singleton pattern to keep the same query client
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function Providers({ children }: Props) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() => createClient());

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
}

