import { describe, expect, test } from "bun:test";
import { getNoteSaveSuccessMessage } from "./note-save-feedback";

describe("getNoteSaveSuccessMessage", () => {
  test("announces manual saves", () => {
    expect(getNoteSaveSuccessMessage("manual")).toBe("Saved.");
  });

  test("keeps autosave and switch saves quiet", () => {
    expect(getNoteSaveSuccessMessage("autosave")).toBeNull();
    expect(getNoteSaveSuccessMessage("switch")).toBeNull();
  });
});
