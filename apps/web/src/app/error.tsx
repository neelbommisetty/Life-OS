"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toastApiError } from "@/lib/api/error-toast";
import { couldnt } from "@/lib/brand";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    toastApiError(error, couldnt("complete that request"));
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Couldn&apos;t complete that request</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Your data is unchanged. Try again.
      </p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
