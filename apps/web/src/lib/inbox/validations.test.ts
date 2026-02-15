import { describe, expect, test } from "bun:test";
import {
  createInboxItemSchema,
  getInboxItemByIdSchema,
  listInboxItemsSchema,
  processInboxItemSchema,
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
  });
});
