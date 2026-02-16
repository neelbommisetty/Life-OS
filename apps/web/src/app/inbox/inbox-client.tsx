"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Archive, CheckCircle2, Search, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toastApiError } from "@/lib/api/error-toast";
import { inboxTodoPreviewPayloadSchema } from "@/lib/inbox/validations";
import {
  approveAllInboxOutputs,
  approveInboxOutput,
  archiveInboxItem,
  createInboxItem,
  declineAllInboxOutputs,
  declineInboxOutput,
  listInboxItems,
  listInboxOutputs,
  processInboxItem,
  recoverInboxItem,
  retryInboxOutput,
  skipInboxOutput,
  type InboxItem,
  type InboxItemState,
  type InboxProposalOutput,
} from "@/lib/inbox/actions";
import { cn } from "@/lib/utils";

const PROCESSING_RECOVERY_WINDOW_MS = 2 * 60 * 1000;

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

function outputBadgeVariant(state: InboxProposalOutput["state"]): "default" | "secondary" | "outline" {
  switch (state) {
    case "APPROVED":
      return "default";
    case "FAILED":
      return "secondary";
    default:
      return "outline";
  }
}

function getArtifactHref(artifact: { type: "note" | "task"; id: string }) {
  if (artifact.type === "note") {
    return `/notes?noteId=${artifact.id}`;
  }

  return "/tasks";
}

function formatDueDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString();
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
  const [outputs, setOutputs] = useState<InboxProposalOutput[]>([]);
  const [isLoadingOutputs, setIsLoadingOutputs] = useState(false);
  const [isCreating, startCreateTransition] = useTransition();
  const [isMutating, startMutatingTransition] = useTransition();

  const loadItems = useCallback(async () => {
    try {
      const nextItems = await listInboxItems({
        search: search || undefined,
      });
      setItems(nextItems);
      return nextItems;
    } catch (error) {
      toastApiError(error, "Failed to load inbox items");
      return null;
    }
  }, [search]);

  const loadOutputs = useCallback(async (itemId: string | null) => {
    if (!itemId) {
      setOutputs([]);
      return;
    }

    setIsLoadingOutputs(true);
    try {
      const nextOutputs = await listInboxOutputs({ itemId });
      setOutputs(nextOutputs);
    } catch (error) {
      toastApiError(error, "Failed to load proposal outputs");
    } finally {
      setIsLoadingOutputs(false);
    }
  }, []);

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

  useEffect(() => {
    void loadOutputs(effectiveSelectedId);
  }, [effectiveSelectedId, loadOutputs]);

  const refreshAfterMutation = useCallback(
    async (itemId: string | null) => {
      const nextItems = await loadItems();
      if (!nextItems) return;

      const stillExists = itemId && nextItems.some((item) => item.id === itemId);
      await loadOutputs(stillExists ? itemId : nextItems[0]?.id ?? null);
    },
    [loadItems, loadOutputs],
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
        await refreshAfterMutation(created.id);
      } catch (error) {
        toastApiError(error, "Failed to capture inbox item");
      }
    });
  };

  const handleResolveAllAsNo = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await processInboxItem({ id: selectedItem.id });
        await refreshAfterMutation(selectedItem.id);
      } catch (error) {
        toastApiError(error, "Failed to resolve item");
      }
    });
  };

  const handleRecover = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await recoverInboxItem({ id: selectedItem.id });
        await refreshAfterMutation(selectedItem.id);
      } catch (error) {
        toastApiError(error, "Failed to recover processing item");
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
        await refreshAfterMutation(selectedItem.id);
      } catch (error) {
        toastApiError(error, "Failed to archive inbox item");
      }
    });
  };

  const handleApproveOutput = (outputId: string) => {
    const itemId = selectedItem?.id ?? null;
    startMutatingTransition(async () => {
      try {
        await approveInboxOutput({ outputId });
        await refreshAfterMutation(itemId);
      } catch (error) {
        toastApiError(error, "Failed to approve proposal");
      }
    });
  };

  const handleDeclineOutput = (outputId: string) => {
    const itemId = selectedItem?.id ?? null;
    startMutatingTransition(async () => {
      try {
        await declineInboxOutput({ outputId });
        await refreshAfterMutation(itemId);
      } catch (error) {
        toastApiError(error, "Failed to decline proposal");
      }
    });
  };

  const handleRetryOutput = (outputId: string) => {
    const itemId = selectedItem?.id ?? null;
    startMutatingTransition(async () => {
      try {
        await retryInboxOutput({ outputId });
        await refreshAfterMutation(itemId);
      } catch (error) {
        toastApiError(error, "Failed to retry proposal");
      }
    });
  };

  const handleSkipOutput = (outputId: string) => {
    const itemId = selectedItem?.id ?? null;
    startMutatingTransition(async () => {
      try {
        await skipInboxOutput({ outputId });
        await refreshAfterMutation(itemId);
      } catch (error) {
        toastApiError(error, "Failed to skip proposal");
      }
    });
  };

  const handleApproveAll = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await approveAllInboxOutputs({ itemId: selectedItem.id });
        await refreshAfterMutation(selectedItem.id);
      } catch (error) {
        toastApiError(error, "Failed to approve all proposals");
      }
    });
  };

  const handleDeclineAll = () => {
    if (!selectedItem) {
      return;
    }

    startMutatingTransition(async () => {
      try {
        await declineAllInboxOutputs({ itemId: selectedItem.id });
        await refreshAfterMutation(selectedItem.id);
      } catch (error) {
        toastApiError(error, "Failed to decline all proposals");
      }
    });
  };

  const canRecover = useMemo(() => {
    if (!selectedItem || selectedItem.state !== "PROCESSING") {
      return false;
    }

    const startedAt = selectedItem.processingStartedAt ?? selectedItem.createdAt;
    return Date.now() - startedAt.getTime() >= PROCESSING_RECOVERY_WINDOW_MS;
  }, [selectedItem]);

  const hasUnresolvedOutputs = useMemo(
    () => outputs.some((output) => output.state === "PENDING" || output.state === "FAILED"),
    [outputs],
  );

  const canResolveAllAsNo = useMemo(() => {
    if (!selectedItem) {
      return false;
    }

    if (selectedItem.state === "PROCESSED" || selectedItem.state === "ARCHIVED") {
      return false;
    }

    return hasUnresolvedOutputs;
  }, [hasUnresolvedOutputs, selectedItem]);

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
              <div className="flex flex-wrap items-center gap-2">
                {selectedItem &&
                selectedItem.state !== "PROCESSED" &&
                selectedItem.state !== "ARCHIVED" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResolveAllAsNo}
                    disabled={isMutating || !canResolveAllAsNo}
                  >
                    <CheckCircle2 className="mr-2 size-4" />
                    Resolve All as No
                  </Button>
                ) : null}
                {canRecover ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRecover}
                    disabled={isMutating || !selectedItem}
                  >
                    <Wrench className="mr-2 size-4" />
                    Recover Processing
                  </Button>
                ) : null}
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

                {selectedItem.processingError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {selectedItem.processingError}
                  </p>
                ) : null}

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <div>Processing Started: {formatDate(selectedItem.processingStartedAt)}</div>
                  <div>Processed At: {formatDate(selectedItem.processedAt)}</div>
                  <div>Archived At: {formatDate(selectedItem.archivedAt)}</div>
                  <div>Updated At: {formatDate(selectedItem.updatedAt)}</div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Proposal Outputs</h3>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleApproveAll}
                        disabled={isMutating || !outputs.length}
                      >
                        Approve All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDeclineAll}
                        disabled={isMutating || !outputs.length}
                      >
                        Decline All
                      </Button>
                    </div>
                  </div>

                  {isLoadingOutputs ? (
                    <p className="text-xs text-muted-foreground">Loading proposal outputs...</p>
                  ) : outputs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {selectedItem.state === "PROCESSING"
                        ? "Agents are still processing this item."
                        : "No proposal outputs for this item."}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {outputs.map((output) => (
                        <div key={output.id} className="rounded-md border p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={outputBadgeVariant(output.state)}>{output.state}</Badge>
                              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {output.agentKey}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              #{output.outputIndex + 1}
                            </span>
                          </div>

                          <p className="text-sm">{output.payloadPreview}</p>

                          {output.agentKey === "todo_list" ? (
                            (() => {
                              const parsed = inboxTodoPreviewPayloadSchema.safeParse(output.payload);
                              if (!parsed.success) {
                                return null;
                              }

                              return (
                                <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
                                  {parsed.data.tasks.map((task, taskIndex) => (
                                    <div key={`${output.id}-task-${taskIndex}`} className="space-y-1">
                                      <p className="text-sm font-medium">{task.title}</p>
                                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                        {task.status ? (
                                          <span className="rounded bg-muted px-1.5 py-0.5">{task.status}</span>
                                        ) : null}
                                        {task.priority ? (
                                          <span className="rounded bg-muted px-1.5 py-0.5">
                                            {task.priority}
                                          </span>
                                        ) : null}
                                        {task.dueDate ? (
                                          <span className="rounded bg-muted px-1.5 py-0.5">
                                            Due {formatDueDate(task.dueDate)}
                                          </span>
                                        ) : null}
                                      </div>
                                      {task.description ? (
                                        <p className="text-xs text-muted-foreground">{task.description}</p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              );
                            })()
                          ) : null}

                          {output.errorMessage ? (
                            <p className="mt-2 text-xs text-destructive">{output.errorMessage}</p>
                          ) : null}

                          {output.createdArtifacts && output.createdArtifacts.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {output.createdArtifacts.map((artifact) => (
                                <Link
                                  key={`${artifact.type}-${artifact.id}`}
                                  href={getArtifactHref(artifact)}
                                  className="text-xs text-primary underline-offset-4 hover:underline"
                                >
                                  Open {artifact.type} ({artifact.id.slice(0, 8)})
                                </Link>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2">
                            {output.state === "PENDING" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleApproveOutput(output.id)}
                                  disabled={isMutating}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDeclineOutput(output.id)}
                                  disabled={isMutating}
                                >
                                  Decline
                                </Button>
                              </>
                            ) : null}

                            {output.state === "FAILED" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRetryOutput(output.id)}
                                  disabled={isMutating}
                                >
                                  Retry
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSkipOutput(output.id)}
                                  disabled={isMutating}
                                >
                                  Skip
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
