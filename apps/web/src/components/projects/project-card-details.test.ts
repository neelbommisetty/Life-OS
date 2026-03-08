import { describe, expect, test } from "bun:test";
import { getProjectCardLabels } from "./project-card-details";

describe("getProjectCardLabels", () => {
  test("confirms when setup details are present", () => {
    expect(
      getProjectCardLabels({
        description: "Weekly planning and launch prep",
        aiInstructions: "Keep responses concise",
      }),
    ).toEqual({
      brief: "Brief added",
      instructions: "Instructions added",
    });
  });

  test("shows pending labels when setup details are missing", () => {
    expect(
      getProjectCardLabels({
        description: "   ",
        aiInstructions: null,
      }),
    ).toEqual({
      brief: "Brief pending",
      instructions: "Instructions pending",
    });
  });
});
