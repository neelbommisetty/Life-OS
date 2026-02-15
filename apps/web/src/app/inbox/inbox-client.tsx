"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Archive, CheckCircle2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toastApiError } from "@/lib/api/error-toast";
import {
  archiveInboxItem,
  createInboxItem,
  listInboxItems,
  processInboxItem,
  type InboxItem,
  type InboxItemState,
} from "@/lib/inbox/actions";
import { cn } from "@/lib/utils";

function formatDate(date: Date | null) {
  if (!date) {
    return "-";
  }

  return date.toLocaleString();
}

function stateBadgeVariant(state: InboxItemState): "default" | "secondary" | "outline" {
  switch (state) {
    case "PROCESSED":
      return "default";
    case "REVIEW":
    case "PROCESSING":
      return "secondary";
    default:
      return "outline";
  }
}

function summarize(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= 90) {
    return compact;
  }

  return `${compact.slice(0, 87)}...`;
}

export function InboxClient({
  initialItems,
}: {
  initialItems: InboxItem[];
}) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null);
  const [contentDraft, setContentDraft] = useState("");
  const [search, setSearch] = useState("");
  const [isCreating, startCreateTransition] = useTransition();
  const [isMutating, startMutatingTransition] = useTransition();

  const loadItems = useCallback(async () => {
    try {
      const nextItems = await listInboxItems({
        search: search || undefined,
      });
      setItems(nextItems);
    } catch (error) {
      toastApiError(error, "Failed to load inbox items");
    }
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextItems = await listInboxItems({
          search: search || undefined,
        });
        if (!cancelled) {
          setItems(nextItems);
        }
      } catch (error) {
        if (!cancelled) {
          toastApiError(error, "Failed to search inbox items");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search]);

  const effectiveSelectedId = useMemo(() => {
    if (!items.length) {
      return null;
    }

    const exists = selectedId && items.some((item) => item.id === selectedId);
    return exists ? selectedId : items[0].id;
  }, [items, selectedId]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === effectiveSelectedId) ?? null,
    [effectiveSelectedId, items],
  );

  const handleCreate = () => {
    if (!contentDraft.trim()) {
      return;
    }

    startCreateTransition(async () => {
      try {
        const created = await createInboxItem({
          content: contentDraft.trim(),
        });
        setContentDraft("");
        setSelectedId(created.id);
        await loadItems();
      } catch (error) {
        toastApiError(error, "Failed to capture inbox item");
      }
    });
  };

  const handleProcess = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await processInboxItem({ id: selectedItem.id });
        await loadItems();
      } catch (error) {
        toastApiError(error, "Failed to mark inbox item as processed");
      }
    });
  };

  const handleArchive = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await archiveInboxItem({ id: selectedItem.id });
        await loadItems();
      } catch (error) {
        toastApiError(error, "Failed to archive inbox item");
      }
    });
  };

  return (
    <div className="h-full overflow-hidden p-6">
      <div className="grid h-full gap-6 lg:grid-cols-[340px_1fr]">
        <div className="flex h-full flex-col gap-4 overflow-hidden">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Capture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                placeholder="Capture a thought, reminder, or draft plan."
                rows={4}
              />
              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={isCreating || !contentDraft.trim()}
              >
                {isCreating ? "Capturing..." : "Capture"}
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search inbox"
                className="pl-9"
              />
            </div>
            <Button variant="ghost" size="icon" asChild className="ml-2 shrink-0">
              <Link href="/inbox/archive" aria-label="Open inbox archive">
                <Archive className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {items.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No inbox items yet. Capture a thought to get started.
                </CardContent>
              </Card>
            ) : (
              items.map((item) => {
                const isSelected = item.id === effectiveSelectedId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant={stateBadgeVariant(item.state)}>{item.state}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {item.createdAt.toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{summarize(item.content)}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <Card className="h-full overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Item</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleProcess}
                  disabled={isMutating || !selectedItem || selectedItem.state === "PROCESSED"}
                >
                  <CheckCircle2 className="mr-2 size-4" />
                  Mark Processed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleArchive}
                  disabled={isMutating || !selectedItem}
                >
                  <Archive className="mr-2 size-4" />
                  Archive
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex h-[calc(100%-76px)] flex-col gap-4 overflow-y-auto">
            {!selectedItem ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Pick an item to review details.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={stateBadgeVariant(selectedItem.state)}>{selectedItem.state}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Created {formatDate(selectedItem.createdAt)}
                  </span>
                </div>

                <div className="rounded-md border bg-muted/20 p-4 text-sm leading-6 whitespace-pre-wrap">
                  {selectedItem.content}
                </div>

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>Processed At: {formatDate(selectedItem.processedAt)}</div>
                  <div>Archived At: {formatDate(selectedItem.archivedAt)}</div>
                  <div>Updated At: {formatDate(selectedItem.updatedAt)}</div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Inbox items are read-only after capture in V1.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
