import {
  appDescription,
  defaultBrandTerms,
  defaultBrandTermStatus,
  type BrandTermStatus,
} from "@life-os/ai/copy";

export const brand = {
  productName: "Life-OS",
  descriptions: {
    app: appDescription,
  },
  terms: defaultBrandTerms,
  termStatus: defaultBrandTermStatus satisfies Record<
    keyof typeof defaultBrandTerms,
    BrandTermStatus
  >,
} as const;

function toSentence(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function couldnt(
  action: string,
  options?: {
    safeState?: string;
    nextStep?: string;
  },
) {
  const safeState = toSentence(options?.safeState);
  const nextStep = toSentence(options?.nextStep ?? "Please try again");
  const parts = [`Couldn't ${action}.`];

  if (safeState) {
    parts.push(safeState);
  }

  if (nextStep) {
    parts.push(nextStep);
  }

  return parts.join(" ");
}
