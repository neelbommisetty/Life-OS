"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Inbox, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toastApiError } from "@/lib/api/error-toast";
import { createInboxItem } from "@/lib/inbox/actions";

export function InboxCaptureCard() {
  const [contentDraft, setContentDraft] = useState("");
  const [isCreating, startCreateTransition] = useTransition();

  const handleCreate = () => {
    const content = contentDraft.trim();
    if (!content) {
      return;
    }

    startCreateTransition(async () => {
      try {
        await createInboxItem({ content });
        setContentDraft("");
        toast.success("Captured to Inbox.");
      } catch (error) {
        toastApiError(error, "Failed to capture inbox item");
      }
    });
  };

  return (
    <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.06] via-background to-background">
      <CardHeader className="gap-3 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Inbox className="size-5 text-primary" />
              Inbox
            </CardTitle>
            <CardDescription>
              Capture something quickly here. Review and process it in the inbox tab.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <Link href="/inbox">
              Open Inbox
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={contentDraft}
          onChange={(event) => setContentDraft(event.target.value)}
          placeholder="Capture a thought, reminder, or draft plan."
          rows={4}
        />
        <div className="flex justify-end">
          <Button onClick={handleCreate} disabled={isCreating || !contentDraft.trim()}>
            {isCreating ? "Capturing..." : "Capture"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
