"use server";

import { apiFetchJson } from "@/lib/api/fetch";
import {
  archiveInboxItemSchema,
  bulkResolveInboxOutputsSchema,
  createInboxItemSchema,
  getInboxItemByIdSchema,
  getInboxOutputsSchema,
  listArchivedInboxItemsSchema,
  listInboxItemsSchema,
  processInboxItemSchema,
  recoverInboxItemSchema,
  resolveInboxOutputSchema,
  skipInboxOutputSchema,
  unarchiveInboxItemSchema,
  type ArchiveInboxItemInput,
  type BulkResolveInboxOutputsInput,
  type CreateInboxItemInput,
  type GetInboxItemByIdInput,
  type GetInboxOutputsInput,
  type InboxAgentKey,
  type InboxCreatedArtifact,
  type InboxItemState,
  type InboxProposalOutputState,
  type ListArchivedInboxItemsInput,
  type ListInboxItemsInput,
  type ProcessInboxItemInput,
  type RecoverInboxItemInput,
  type ResolveInboxOutputInput,
  type SkipInboxOutputInput,
  type UnarchiveInboxItemInput,
} from "./validations";
export type { InboxItemState, InboxProposalOutputState } from "./validations";

type InboxItemResponse = {
  id: string;
  userId: string;
  content: string;
  state: InboxItemState;
  processedAt: string | null;
  archivedAt: string | null;
  processingStartedAt: string | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProposalOutputResponse = {
  id: string;
  userId: string;
  inboxItemId: string;
  agentKey: InboxAgentKey;
  outputIndex: number;
  payloadVersion: number;
  payload: unknown;
  payloadPreview: string;
  state: InboxProposalOutputState;
  errorMessage: string | null;
  resolvedAt: string | null;
  createdArtifacts: InboxCreatedArtifact[] | null;
  createdAt: string;
  updatedAt: string;
};

type ProposalOutputActionResponse = {
  output: ProposalOutputResponse;
  inboxItem: InboxItemResponse;
};

type BulkResolveResponse = {
  itemId: string;
  inboxItem: InboxItemResponse;
  results: Array<{
    outputId: string;
    state: "updated" | "unchanged" | "failed";
    output: ProposalOutputResponse;
    error?: string;
  }>;
};

export type InboxItem = {
  id: string;
  userId: string;
  content: string;
  state: InboxItemState;
  processedAt: Date | null;
  archivedAt: Date | null;
  processingStartedAt: Date | null;
  processingError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type InboxProposalOutput = {
  id: string;
  userId: string;
  inboxItemId: string;
  agentKey: InboxAgentKey;
  outputIndex: number;
  payloadVersion: number;
  payload: unknown;
  payloadPreview: string;
  state: InboxProposalOutputState;
  errorMessage: string | null;
  resolvedAt: Date | null;
  createdArtifacts: InboxCreatedArtifact[] | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date received from API");
  }

  return parsed;
}

function hydrateInboxItem(item: InboxItemResponse): InboxItem {
  return {
    ...item,
    processedAt: item.processedAt ? parseDate(item.processedAt) : null,
    archivedAt: item.archivedAt ? parseDate(item.archivedAt) : null,
    processingStartedAt: item.processingStartedAt ? parseDate(item.processingStartedAt) : null,
    processingError: item.processingError,
    createdAt: parseDate(item.createdAt),
    updatedAt: parseDate(item.updatedAt),
  };
}

function hydrateProposalOutput(output: ProposalOutputResponse): InboxProposalOutput {
  return {
    ...output,
    resolvedAt: output.resolvedAt ? parseDate(output.resolvedAt) : null,
    createdAt: parseDate(output.createdAt),
    updatedAt: parseDate(output.updatedAt),
  };
}

function idempotencyHeaders() {
  return {
    "Idempotency-Key": crypto.randomUUID(),
  };
}

export async function listInboxItems(input?: ListInboxItemsInput) {
  const parsed = listInboxItemsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }

  if (parsed.state) {
    params.set("state", parsed.state);
  }

  const path = params.size ? `/inbox?${params.toString()}` : "/inbox";
  const items = await apiFetchJson<InboxItemResponse[]>(path);

  return items.map(hydrateInboxItem);
}

export async function listArchivedInboxItems(input?: ListArchivedInboxItemsInput) {
  const parsed = listArchivedInboxItemsSchema.parse(input ?? {});
  const params = new URLSearchParams();

  if (parsed.search) {
    params.set("search", parsed.search);
  }

  const path = params.size
    ? `/inbox/archived?${params.toString()}`
    : "/inbox/archived";
  const items = await apiFetchJson<InboxItemResponse[]>(path);

  return items.map(hydrateInboxItem);
}

export async function getInboxItemById(input: GetInboxItemByIdInput) {
  const parsed = getInboxItemByIdSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/inbox/${parsed.id}`);

  return hydrateInboxItem(item);
}

export async function createInboxItem(input: CreateInboxItemInput) {
  const parsed = createInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>("/inbox", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsed),
  });

  return hydrateInboxItem(item);
}

export async function processInboxItem(input: ProcessInboxItemInput) {
  const parsed = processInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/inbox/${parsed.id}/process`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function recoverInboxItem(input: RecoverInboxItemInput) {
  const parsed = recoverInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/inbox/${parsed.id}/recover`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function archiveInboxItem(input: ArchiveInboxItemInput) {
  const parsed = archiveInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/inbox/${parsed.id}/archive`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function unarchiveInboxItem(input: UnarchiveInboxItemInput) {
  const parsed = unarchiveInboxItemSchema.parse(input);
  const item = await apiFetchJson<InboxItemResponse>(`/inbox/${parsed.id}/unarchive`, {
    method: "POST",
  });

  return hydrateInboxItem(item);
}

export async function listInboxOutputs(input: GetInboxOutputsInput) {
  const parsed = getInboxOutputsSchema.parse(input);
  const outputs = await apiFetchJson<ProposalOutputResponse[]>(`/inbox/${parsed.itemId}/outputs`);
  return outputs.map(hydrateProposalOutput);
}

export async function approveInboxOutput(input: ResolveInboxOutputInput) {
  const parsed = resolveInboxOutputSchema.parse(input);
  const response = await apiFetchJson<ProposalOutputActionResponse>(
    `/inbox/outputs/${parsed.outputId}/approve`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
  );

  return {
    output: hydrateProposalOutput(response.output),
    inboxItem: hydrateInboxItem(response.inboxItem),
  };
}

export async function declineInboxOutput(input: ResolveInboxOutputInput) {
  const parsed = resolveInboxOutputSchema.parse(input);
  const response = await apiFetchJson<ProposalOutputActionResponse>(
    `/inbox/outputs/${parsed.outputId}/decline`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
  );

  return {
    output: hydrateProposalOutput(response.output),
    inboxItem: hydrateInboxItem(response.inboxItem),
  };
}

export async function retryInboxOutput(input: ResolveInboxOutputInput) {
  const parsed = resolveInboxOutputSchema.parse(input);
  const response = await apiFetchJson<ProposalOutputActionResponse>(
    `/inbox/outputs/${parsed.outputId}/retry`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
  );

  return {
    output: hydrateProposalOutput(response.output),
    inboxItem: hydrateInboxItem(response.inboxItem),
  };
}

export async function skipInboxOutput(input: SkipInboxOutputInput) {
  const parsed = skipInboxOutputSchema.parse(input);
  const response = await apiFetchJson<ProposalOutputActionResponse>(
    `/inbox/outputs/${parsed.outputId}/skip`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...idempotencyHeaders(),
      },
      body: JSON.stringify(
        parsed.reason
          ? {
              reason: parsed.reason,
            }
          : {},
      ),
    },
  );

  return {
    output: hydrateProposalOutput(response.output),
    inboxItem: hydrateInboxItem(response.inboxItem),
  };
}

export async function approveAllInboxOutputs(input: BulkResolveInboxOutputsInput) {
  const parsed = bulkResolveInboxOutputsSchema.parse(input);
  const response = await apiFetchJson<BulkResolveResponse>(
    `/inbox/${parsed.itemId}/outputs/approve-all`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
  );

  return {
    ...response,
    inboxItem: hydrateInboxItem(response.inboxItem),
    results: response.results.map((result) => ({
      ...result,
      output: hydrateProposalOutput(result.output),
    })),
  };
}

export async function declineAllInboxOutputs(input: BulkResolveInboxOutputsInput) {
  const parsed = bulkResolveInboxOutputsSchema.parse(input);
  const response = await apiFetchJson<BulkResolveResponse>(
    `/inbox/${parsed.itemId}/outputs/decline-all`,
    {
      method: "POST",
      headers: idempotencyHeaders(),
    },
  );

  return {
    ...response,
    inboxItem: hydrateInboxItem(response.inboxItem),
    results: response.results.map((result) => ({
      ...result,
      output: hydrateProposalOutput(result.output),
    })),
  };
}
