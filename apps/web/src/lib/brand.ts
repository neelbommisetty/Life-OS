import {
  appDescription,
  defaultBrandTerms,
  defaultBrandTermStatus,
  type BrandTermStatus,
} from "@life-os/ai/copy";

const brandTerms = Object.freeze({ ...defaultBrandTerms });
const brandTermStatus = Object.freeze({
  ...defaultBrandTermStatus,
} satisfies Record<keyof typeof defaultBrandTerms, BrandTermStatus>);

export const brand = {
  productName: "Life-OS",
  descriptions: {
    app: appDescription,
  },
  terms: brandTerms,
  termStatus: brandTermStatus,
} as const;

function toSentence(value: string | undefined): string | null {
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
): string {
  const safeState = toSentence(options?.safeState);
  const nextStep = toSentence(options?.nextStep) ?? "Please try again.";
  const parts = [`Couldn't ${action}.`];

  if (safeState) {
    parts.push(safeState);
  }

  if (nextStep) {
    parts.push(nextStep);
  }

  return parts.join(" ");
}
