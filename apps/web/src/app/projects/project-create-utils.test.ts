import { describe, expect, test } from "bun:test";
import {
  buildCreateProjectPayload,
  getProjectCreateHref,
  getProjectDetailHref,
} from "./project-create-utils";

describe("project create utils", () => {
  test("buildCreateProjectPayload trims fields and preserves optional values", () => {
    expect(
      buildCreateProjectPayload({
        name: "  Life Admin  ",
        description: "  Coordinate the week  ",
        aiInstructions: "  Keep responses concise  ",
      }),
    ).toEqual({
      name: "Life Admin",
      description: "Coordinate the week",
      aiInstructions: "Keep responses concise",
    });
  });

  test("buildCreateProjectPayload rejects blank names", () => {
    expect(
      buildCreateProjectPayload({
        name: "   ",
        description: "Optional",
        aiInstructions: "",
      }),
    ).toBeNull();
  });

  test("buildCreateProjectPayload normalizes missing optional fields", () => {
    expect(
      buildCreateProjectPayload({
        name: "Project Atlas",
      }),
    ).toEqual({
      name: "Project Atlas",
      description: "",
      aiInstructions: "",
    });
  });

  test("getProjectDetailHref returns the project detail route", () => {
    expect(getProjectDetailHref("c000000000000000000000042")).toBe(
      "/projects/c000000000000000000000042",
    );
  });

  test("getProjectCreateHref returns the dedicated create route", () => {
    expect(getProjectCreateHref()).toBe("/projects/new");
  });
});
