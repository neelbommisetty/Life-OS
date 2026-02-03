import { describe, test, expect } from "bun:test";
import {
  createNoteSchema,
  deleteNoteSchema,
  listNotesSchema,
  updateNoteSchema,
} from "@/lib/notes/validations";

describe("notes validation schemas", () => {
  const validCuid = "cjld2cjxh0000qzrmn831i7rn";

  test("createNoteSchema accepts a valid payload", () => {
    const result = createNoteSchema.safeParse({
      title: "Project kickoff",
      content: "# Notes",
      projectId: validCuid,
    });

    expect(result.success).toBe(true);
  });

  test("createNoteSchema rejects empty title", () => {
    const result = createNoteSchema.safeParse({
      title: "",
      content: "Body",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Title is required");
    }
  });

  test("updateNoteSchema requires id but allows partial updates", () => {
    const missingId = updateNoteSchema.safeParse({ title: "Updated" });
    expect(missingId.success).toBe(false);

    const withIdOnly = updateNoteSchema.safeParse({ id: validCuid });
    expect(withIdOnly.success).toBe(true);
  });

  test("listNotesSchema and deleteNoteSchema validate cuid fields", () => {
    const listOk = listNotesSchema.safeParse({ projectId: validCuid });
    expect(listOk.success).toBe(true);

    const deleteBad = deleteNoteSchema.safeParse({ id: "not-a-cuid" });
    expect(deleteBad.success).toBe(false);
  });
});
