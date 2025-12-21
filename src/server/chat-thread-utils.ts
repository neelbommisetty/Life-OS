import "server-only";

import type { PrismaClient } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import { getModelFor } from "@/lib/ai/providers/router";
import { initializeChatServices } from "@/lib/ai/chat-services";
import { prisma } from "@/server/db";

const logger = createLogger("chat:threads");

const PLACEHOLDER_THREAD_NAMES = ["New thread", "Default"];
const PLACEHOLDER_NAME_PATTERN = /^New thread( \(\d+\))?$/;

type PrismaClientLike = Pick<
  PrismaClient,
  "chatThread"
>;

export function isPlaceholderThreadName(name: string | null | undefined): boolean {
  if (!name) return false;
  return PLACEHOLDER_THREAD_NAMES.includes(name) || PLACEHOLDER_NAME_PATTERN.test(name);
}

export async function getUniqueThreadName(
  projectId: string,
  baseName: string,
  client: PrismaClientLike = prisma
): Promise<string> {
  const base = baseName.trim() || "New thread";
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await client.chatThread.findFirst({
      where: {
        projectId,
        name: candidate,
      },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
}

function buildThreadTitlePrompt(firstMessage: string): string {
  return `Summarize the user's first message into a short, descriptive chat thread title.
Constraints:
- 3 to 6 words
- Title Case
- No quotes or punctuation at the end
- Output only the title

Message:
${firstMessage}`;
}

function normalizeThreadTitle(rawTitle: string): string {
  const firstLine = rawTitle.split("\n")[0] ?? "";
  const trimmed = firstLine.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return trimmed;
}

export function queueThreadTitleGeneration(params: {
  threadId: string;
  projectId: string;
  firstMessage: string;
  currentName: string;
  client?: PrismaClientLike;
}): void {
  const { threadId, projectId, firstMessage, currentName, client = prisma } = params;

  if (!isPlaceholderThreadName(currentName)) {
    return;
  }

  void (async () => {
    try {
      initializeChatServices();
      const model = getModelFor("project_chat_summary");
      const prompt = buildThreadTitlePrompt(firstMessage);
      const result = await model.call({
        prompt,
        mode: "text",
      });

      const normalized = normalizeThreadTitle(result.text);
      if (!normalized) {
        return;
      }

      const uniqueName = await getUniqueThreadName(projectId, normalized, client);

      await client.chatThread.updateMany({
        where: {
          id: threadId,
          name: currentName ?? undefined,
        },
        data: {
          name: uniqueName,
        },
      });
    } catch (error) {
      logger.warn("Failed to generate thread title", {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
