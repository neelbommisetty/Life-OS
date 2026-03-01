"use client";

import { useEffect } from "react";
import { toastApiError } from "@/lib/api/error-toast";
import { couldnt } from "@/lib/brand";

export function UnhandledErrorToaster() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      toastApiError(
        event.reason,
        couldnt("complete that request", {
          safeState: "Your data is unchanged",
        }),
      );
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
