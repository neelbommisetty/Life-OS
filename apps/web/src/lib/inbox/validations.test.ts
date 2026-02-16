import { describe, expect, test } from "bun:test";
import {
  bulkResolveInboxOutputsSchema,
  createInboxItemSchema,
  getInboxItemByIdSchema,
  listInboxItemsSchema,
  processInboxItemSchema,
  recoverInboxItemSchema,
  resolveInboxOutputSchema,
  skipInboxOutputSchema,
} from "@/lib/inbox/validations";

describe("inbox validation schemas", () => {
  const validCuid = "cjld2cjxh0000qzrmn831i7rn";

  test("createInboxItemSchema accepts valid payload", () => {
    const result = createInboxItemSchema.safeParse({
      content: "Capture this thought quickly.",
    });

    expect(result.success).toBe(true);
  });

  test("createInboxItemSchema rejects empty content", () => {
    const result = createInboxItemSchema.safeParse({
      content: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Content is required");
    }
  });

  test("listInboxItemsSchema validates state", () => {
    const valid = listInboxItemsSchema.safeParse({ state: "REVIEW" });
    expect(valid.success).toBe(true);

    const invalid = listInboxItemsSchema.safeParse({ state: "ARCHIVED" });
    expect(invalid.success).toBe(false);
  });

  test("id-based schemas require cuid", () => {
    const getOk = getInboxItemByIdSchema.safeParse({ id: validCuid });
    expect(getOk.success).toBe(true);

    const processBad = processInboxItemSchema.safeParse({ id: "nope" });
    expect(processBad.success).toBe(false);

    const recoverBad = recoverInboxItemSchema.safeParse({ id: "nope" });
    expect(recoverBad.success).toBe(false);
  });

  test("output action schemas validate ids and optional skip reason", () => {
    const approveOk = resolveInboxOutputSchema.safeParse({ outputId: validCuid });
    expect(approveOk.success).toBe(true);

    const skipOk = skipInboxOutputSchema.safeParse({ outputId: validCuid, reason: "Ignore" });
    expect(skipOk.success).toBe(true);

    const skipBad = skipInboxOutputSchema.safeParse({ outputId: "bad" });
    expect(skipBad.success).toBe(false);
  });

  test("bulk resolve schema requires item id", () => {
    const ok = bulkResolveInboxOutputsSchema.safeParse({ itemId: validCuid });
    expect(ok.success).toBe(true);

    const bad = bulkResolveInboxOutputsSchema.safeParse({ itemId: "bad" });
    expect(bad.success).toBe(false);
  });
});
