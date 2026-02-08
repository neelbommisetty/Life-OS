"use client";

import { useEffect } from "react";
import { toastApiError } from "@/lib/api/error-toast";

export function UnhandledErrorToaster() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      toastApiError(event.reason, "An unexpected error occurred");
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
