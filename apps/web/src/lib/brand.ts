export const brand = {
  productName: "Life-OS",
  oneSentenceDescription:
    "Life-OS is a minimalist AI personal assistant that organizes your tasks and knowledge into a clear plan—and helps execute it.",
  terms: {
    assistant: "Assistant",
    inbox: "Inbox",
    library: "Library",
    plan: "Plan",
  },
} as const;

export function couldnt(action: string) {
  return `Couldn't ${action}. Try again.`;
}

