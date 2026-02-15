"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowLeft, Search, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toastApiError } from "@/lib/api/error-toast";
import {
  listArchivedInboxItems,
  unarchiveInboxItem,
  type InboxItem,
} from "@/lib/inbox/actions";

function summarize(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) {
    return compact;
  }

  return `${compact.slice(0, 137)}...`;
}

export function InboxArchiveClient({
  initialItems,
}: {
  initialItems: InboxItem[];
}) {
  const [items, setItems] = useState<InboxItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [isMutating, startMutatingTransition] = useTransition();

  const loadItems = useCallback(async () => {
    try {
      const nextItems = await listArchivedInboxItems({
        search: search || undefined,
      });
      setItems(nextItems);
    } catch (error) {
      toastApiError(error, "Failed to load archived inbox items");
    }
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextItems = await listArchivedInboxItems({
          search: search || undefined,
        });
        if (!cancelled) {
          setItems(nextItems);
        }
      } catch (error) {
        if (!cancelled) {
          toastApiError(error, "Failed to search archived inbox items");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search]);

  const handleUnarchive = (itemId: string) => {
    startMutatingTransition(async () => {
      try {
        await unarchiveInboxItem({ id: itemId });
        await loadItems();
      } catch (error) {
        toastApiError(error, "Failed to unarchive inbox item");
      }
    });
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/inbox">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inbox Archive</h1>
            <p className="text-sm text-muted-foreground">Archived items remain available for reference.</p>
          </div>
        </div>

        <div className="relative w-full sm:w-[280px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search archive"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3">
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No archived inbox items found.
            </CardContent>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">{item.createdAt.toLocaleString()}</CardTitle>
                  <Badge variant="secondary">ARCHIVED</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-6 text-foreground">{summarize(item.content)}</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Archived {item.archivedAt?.toLocaleString() ?? "-"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUnarchive(item.id)}
                    disabled={isMutating}
                  >
                    <Undo2 className="mr-2 size-4" />
                    Unarchive
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
