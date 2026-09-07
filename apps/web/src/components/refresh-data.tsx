"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshData() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        startTransition(() => router.refresh());
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return (
    <button
      className="text-button refresh"
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Refreshing…" : "Refresh data"}
    </button>
  );
}
