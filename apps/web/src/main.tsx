import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./theme.css";
import "./todo.css";
const CalendarApp = lazy(() => import("./CalendarApp"));
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <Suspense
        fallback={
          <p role="status" className="route-loading">
            Opening your workspace…
          </p>
        }
      >
        {window.location.pathname.startsWith("/calendar") ? (
          <CalendarApp />
        ) : (
          <App />
        )}
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
