import { describe, expect, test } from "bun:test";
import { setThreadModelSchema } from "@/lib/chat/validations";

describe("setThreadModelSchema", () => {
  test("accepts null model keys and rejects empty strings", () => {
    const validThreadId = "ckz1q2w3e4r5t6y7u8i9o0p1f";

    const nullModel = setThreadModelSchema.safeParse({
      threadId: validThreadId,
      modelKey: null,
    });
    expect(nullModel.success).toBe(true);

    const emptyModel = setThreadModelSchema.safeParse({
      threadId: validThreadId,
      modelKey: "",
    });
    expect(emptyModel.success).toBe(false);
    if (!emptyModel.success) {
      expect(emptyModel.error.issues[0]?.message).toBe("Model key is required");
    }
  });
});
