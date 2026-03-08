import { describe, expect, test } from "bun:test";
import {
  buildProjectUpdatePayload,
  getProjectEditFormData,
} from "./project-edit-utils";

describe("project edit utils", () => {
  test("getProjectEditFormData normalizes nullable fields", () => {
    expect(
      getProjectEditFormData({
        name: "Life Admin",
        description: null,
        aiInstructions: null,
      }),
    ).toEqual({
      name: "Life Admin",
      description: "",
      aiInstructions: "",
    });
  });

  test("buildProjectUpdatePayload trims fields", () => {
    expect(
      buildProjectUpdatePayload({
        name: "  Life Admin Updated  ",
        description: "  Weekly planning  ",
        aiInstructions: "  Keep replies concise  ",
      }),
    ).toEqual({
      name: "Life Admin Updated",
      description: "Weekly planning",
      aiInstructions: "Keep replies concise",
    });
  });

  test("buildProjectUpdatePayload rejects blank names", () => {
    expect(
      buildProjectUpdatePayload({
        name: "   ",
        description: "",
        aiInstructions: "",
      }),
    ).toBeNull();
  });
});
