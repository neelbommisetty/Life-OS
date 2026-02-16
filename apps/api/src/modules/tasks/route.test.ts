import { describe, expect, test } from "bun:test";
import { createTasksRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const TASK_ID = "ckz1q2w3e4r5t6y7u8i9o0p1e";

describe("tasksRoute", () => {
  test("GET /tasks lists tasks", async () => {
    let updateManyCalled = false;
    let findManyArgs: unknown;

    const app = createTestApp(
      createTasksRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          task: {
            updateMany: async () => {
              updateManyCalled = true;
              return {};
            },
            findMany: async (args) => {
              findManyArgs = args;
              return [{ id: TASK_ID }];
            },
            create: async () => ({ id: TASK_ID }),
            findFirst: async () => ({ id: TASK_ID }),
            update: async () => ({ id: TASK_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(
      app,
      "/tasks?search=bug&status=TODO",
    );

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: TASK_ID }]);
    expect(updateManyCalled).toBe(true);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        deletedAt: null,
        status: "TODO",
      },
    });
  });

  test("GET /tasks/archived lists archived tasks", async () => {
    let findManyArgs: unknown;

    const app = createTestApp(
      createTasksRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          task: {
            updateMany: async () => ({}),
            findMany: async (args) => {
              findManyArgs = args;
              return [{ id: TASK_ID, deletedAt: new Date().toISOString() }];
            },
            create: async () => ({ id: TASK_ID }),
            findFirst: async () => ({ id: TASK_ID }),
            update: async () => ({ id: TASK_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/tasks/archived");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: TASK_ID, deletedAt: expect.any(String) }]);
    expect(findManyArgs).toMatchObject({
      where: {
        userId: USER_ID,
        deletedAt: { not: null },
      },
    });
  });

  test("POST /tasks creates task", async () => {
    let createArgs: unknown;

    const app = createTestApp(
      createTasksRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          task: {
            updateMany: async () => ({}),
            findMany: async () => [],
            create: async (args) => {
              createArgs = args;
              return { id: TASK_ID, title: "Task" };
            },
            findFirst: async () => ({ id: TASK_ID }),
            update: async () => ({ id: TASK_ID }),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Task", dueDate: "2026-02-01" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: TASK_ID, title: "Task" });
    expect(createArgs).toMatchObject({
      data: {
        userId: USER_ID,
        title: "Task",
      },
    });
  });

  test("PATCH /tasks/:id updates task", async () => {
    let updateArgs: unknown;

    const app = createTestApp(
      createTasksRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          task: {
            updateMany: async () => ({}),
            findMany: async () => [],
            create: async () => ({ id: TASK_ID }),
            findFirst: async () => ({ id: TASK_ID }),
            update: async (args) => {
              updateArgs = args;
              return { id: TASK_ID, status: "DONE" };
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/tasks/${TASK_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "DONE" }),
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: TASK_ID, status: "DONE" });
    expect(updateArgs).toMatchObject({
      where: { id: TASK_ID },
      data: { status: "DONE" },
    });
  });

  test("DELETE /tasks/:id soft deletes task", async () => {
    let updateArgs: unknown;

    const app = createTestApp(
      createTasksRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          task: {
            updateMany: async () => ({}),
            findMany: async () => [],
            create: async () => ({ id: TASK_ID }),
            findFirst: async () => ({ id: TASK_ID }),
            update: async (args) => {
              updateArgs = args;
              return { id: TASK_ID };
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/tasks/${TASK_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(updateArgs).toMatchObject({ where: { id: TASK_ID } });
  });
});
