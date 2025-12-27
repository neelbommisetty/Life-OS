"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { ChatMessage } from "@prisma/client";
import type { ProposedTask } from "@/lib/chat-utils";
import { extractTasksFromMessage } from "@/lib/chat-utils";
import {
  CheckCircle2Icon,
  CalendarIcon,
  AlertCircleIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PriorityBadge } from "./priority-badge";
import { ChatMarkdown } from "./chat-markdown";

type MessageBubbleProps = {
  message: ChatMessage;
  themeStyle: CSSProperties;
  hasAccentColor: boolean;
  onApproveTask: (messageId: string, task: ProposedTask) => void;
  onApproveAll: (messageId: string, tasks: ProposedTask[]) => void;
  onRegenerate?: (messageId: string) => void;
  onSaveArtifact?: (content: string) => void;
  artifactStatus?: "idle" | "saving" | "saved" | "error";
  canRegenerate?: boolean;
  modelLabel?: string;
  modelProvider?: string | null;
  messageStatus?: "sending" | "delivered" | "failed";
  isPending: boolean;
};

export function MessageBubble({
  message,
  themeStyle,
  hasAccentColor,
  onApproveTask,
  onApproveAll,
  onRegenerate,
  onSaveArtifact,
  artifactStatus = "idle",
  canRegenerate,
  modelLabel,
  modelProvider,
  messageStatus,
  isPending,
}: MessageBubbleProps) {
  const isUser = message.role === "USER";
  const isAssistant = message.role === "ASSISTANT";
  const isSystem = message.role === "SYSTEM";

  // Parse tasks if assistant message
  const proposedTasks = useMemo(() => {
    if (!isAssistant) return null;
    return extractTasksFromMessage(message.content);
  }, [message.content, isAssistant]);

  // Parse taskResolution from message
  const taskResolution = useMemo(() => {
    if (!message.taskResolution) return null;
    try {
      const resolution = message.taskResolution as {
        created?: Array<{
          id: string;
          title: string;
          description?: string;
          status: string;
          priority?: string;
          createdAt: string;
        }>;
        error?: string;
      };
      return resolution;
    } catch {
      return null;
    }
  }, [message.taskResolution]);

  // Clean content by removing JSON block for display
  const displayContent = useMemo(() => {
    if (!isAssistant) return message.content;
    return message.content.replace(/```json[\s\S]*?```/, "").trim();
  }, [message.content, isAssistant]);

  const timestampLabel = useMemo(() => {
    const date =
      message.createdAt instanceof Date
        ? message.createdAt
        : new Date(message.createdAt);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }, [message.createdAt]);

  const effectiveModelLabel = message.modelLabel ?? modelLabel ?? null;
  const effectiveModelProvider = message.modelProvider ?? modelProvider ?? null;

  const modelLabelText = useMemo(() => {
    // If no label is set, it's autorouting
    if (!effectiveModelLabel) return "Auto routing";
    if (!effectiveModelProvider) return effectiveModelLabel;
    const providerName =
      effectiveModelProvider === "openai"
        ? "OpenAI"
        : effectiveModelProvider === "anthropic"
        ? "Anthropic"
        : effectiveModelProvider === "google"
        ? "Google"
        : effectiveModelProvider === "xai"
        ? "xAI"
        : effectiveModelProvider;
    return `${effectiveModelLabel} (${providerName})`;
  }, [effectiveModelLabel, effectiveModelProvider]);

  const statusLabel = useMemo(() => {
    if (!messageStatus) return null;
    if (messageStatus === "sending") return "Sending...";
    if (messageStatus === "failed") return "Failed";
    return "Delivered";
  }, [messageStatus]);

  const artifactActionLabel = useMemo(() => {
    if (artifactStatus === "saved") return "Saved";
    if (artifactStatus === "saving") return "Saving...";
    if (artifactStatus === "error") return "Retry save";
    return "Save to artifacts";
  }, [artifactStatus]);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs bg-muted text-muted-foreground px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 max-w-[85%]",
          isUser && "flex-row-reverse"
        )}
      >
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            isUser
              ? hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-[rgb(var(--project-accent-foreground))]"
                : "bg-primary text-primary-foreground"
              : "bg-muted text-foreground"
          )}
          style={isUser && hasAccentColor ? themeStyle : undefined}
        >
          {isUser ? "You" : "AI"}
        </div>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm shadow-sm",
            isUser
              ? hasAccentColor
                ? "bg-[rgb(var(--project-accent))] text-[rgb(var(--project-accent-foreground))]"
                : "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
          )}
          style={isUser && hasAccentColor ? themeStyle : undefined}
        >
          <ChatMarkdown
            content={displayContent}
            tone={isUser ? "inverted" : "default"}
          />
        </div>
      </div>

      {statusLabel && (
        <div
          className={cn(
            "text-[11px]",
            messageStatus === "failed"
              ? "text-destructive"
              : "text-muted-foreground",
            isUser ? "mr-11 text-right" : "ml-11 text-left"
          )}
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </div>
      )}

      {isAssistant && (
        <div className="ml-11 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground/80">Model</span>
            <span>{modelLabelText}</span>
          </span>
          <span className="text-muted-foreground/60">•</span>
          <span title={timestampLabel}>{timestampLabel}</span>
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              disabled={!canRegenerate || isPending}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground/80 transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
              title="Regenerate response"
            >
              <RotateCcwIcon className="h-3 w-3" />
              Regenerate
            </button>
          )}
          {isAssistant && onSaveArtifact && (
            <button
              type="button"
              onClick={() => onSaveArtifact(message.content)}
              disabled={
                artifactStatus === "saving" || artifactStatus === "saved"
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium transition",
                artifactStatus === "saved"
                  ? "bg-muted/50 text-muted-foreground border-muted-foreground/20"
                  : "text-foreground/80 hover:bg-muted",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
              title="Save as artifact"
            >
              <SaveIcon className="h-3 w-3" />
              {artifactActionLabel}
            </button>
          )}
        </div>
      )}

      {/* Task Proposals */}
      {proposedTasks && proposedTasks.length > 0 && (
        <div className="ml-11 max-w-[85%] w-full sm:w-96 space-y-3">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertCircleIcon className="h-4 w-4 text-primary" />
                Proposed Tasks ({proposedTasks.length})
              </h4>
              {!taskResolution && proposedTasks.length > 1 && (
                <button
                  onClick={() => onApproveAll(message.id, proposedTasks)}
                  disabled={isPending}
                  className="text-xs font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background rounded disabled:opacity-50"
                >
                  Approve All
                </button>
              )}
            </div>

            {taskResolution?.created && (
              <div className="rounded-lg bg-muted/50 border border-border px-3 py-2 text-xs text-foreground">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <CheckCircle2Icon className="h-3 w-3 text-muted-foreground" />
                  Tasks Created Successfully
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {taskResolution.created.length} task
                  {taskResolution.created.length !== 1 ? "s" : ""} created
                </p>
              </div>
            )}

            {taskResolution?.error && (
              <div className="rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-xs border border-destructive/20">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertCircleIcon className="h-3 w-3" />
                  Creation Failed
                </div>
                <p className="text-[10px] opacity-80 mb-2">
                  {taskResolution.error}
                </p>
                <button
                  onClick={() => onApproveAll(message.id, proposedTasks)}
                  disabled={isPending}
                  className="text-xs font-medium underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background rounded disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="space-y-2">
              {proposedTasks.map((task: ProposedTask, i: number) => {
                // Match by multiple fields for precise identification
                const taskStatus = task.status ?? "BACKLOG";
                const taskPriority = task.priority ?? "MEDIUM";
                const taskDescription = task.description ?? "";

                const isCreated = taskResolution?.created?.some(
                  (ct) =>
                    ct.title === task.title &&
                    ct.status === taskStatus &&
                    ct.priority === taskPriority &&
                    (ct.description ?? "") === taskDescription
                );

                return (
                  <div
                    key={i}
                    className={cn(
                      "group relative rounded-lg border p-3 transition-colors",
                      isCreated
                        ? "border-border bg-muted/40"
                        : "border-border bg-muted/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground wrap-break-word">
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-muted-foreground wrap-break-word line-clamp-2">
                            {task.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <PriorityBadge priority={task.priority} />
                          {task.status && (
                            <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                              {task.status}
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <CalendarIcon className="h-3 w-3" />
                              {new Date(task.dueDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      {isCreated ? (
                        <span className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-muted text-muted-foreground border border-border">
                          Created
                        </span>
                      ) : (
                        (!taskResolution ||
                          !taskResolution.created ||
                          taskResolution.created.length <
                            proposedTasks.length) && (
                          <button
                            onClick={() => onApproveTask(message.id, task)}
                            disabled={isPending}
                            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
                            title="Create this task"
                          >
                            Create task
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {(!taskResolution ||
              !taskResolution.created ||
              taskResolution.created.length === 0) && (
              <button
                onClick={() => onApproveAll(message.id, proposedTasks)}
                disabled={isPending}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-background",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                <CheckCircle2Icon className="h-4 w-4" />
                Approve & Create Tasks
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
