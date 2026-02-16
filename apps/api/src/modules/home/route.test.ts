import { describe, expect, test } from "bun:test";
import { createHomeRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";

describe("homeRoute", () => {
  test("GET /home/recent-projects returns recent projects", async () => {
    let capturedArgs: unknown;

    const app = createTestApp(
      createHomeRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async (args) => {
              capturedArgs = args;
              return [{ id: "p1" }];
            },
          },
          task: {
            findMany: async () => [],
          },
          note: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/home/recent-projects");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: "p1" }]);
    expect(capturedArgs).toMatchObject({
      where: { userId: USER_ID, archivedAt: null },
      take: 3,
    });
  });

  test("GET /home/upcoming-tasks returns upcoming tasks", async () => {
    let capturedArgs: unknown;

    const app = createTestApp(
      createHomeRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
          },
          task: {
            findMany: async (args) => {
              capturedArgs = args;
              return [{ id: "t1" }];
            },
          },
          note: {
            findMany: async () => [],
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/home/upcoming-tasks");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: "t1" }]);
    expect(capturedArgs).toMatchObject({
      where: {
        userId: USER_ID,
        status: { not: "DONE" },
        deletedAt: null,
      },
      take: 4,
    });
  });

  test("GET /home/recent-notes returns recent notes", async () => {
    let capturedArgs: unknown;

    const app = createTestApp(
      createHomeRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
          },
          task: {
            findMany: async () => [],
          },
          note: {
            findMany: async (args) => {
              capturedArgs = args;
              return [{ id: "n1" }];
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/home/recent-notes");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: "n1" }]);
    expect(capturedArgs).toMatchObject({
      where: { userId: USER_ID, deletedAt: null },
      take: 3,
    });
  });
});
