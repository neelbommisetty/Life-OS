import { describe, expect, test } from "bun:test";
import { createProjectsRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const PROJECT_ID = "ckz1q2w3e4r5t6y7u8i9o0p1b";

describe("projectsRoute", () => {
  test("GET /api/projects lists projects", async () => {
    let capturedArgs: unknown;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async (args) => {
              capturedArgs = args;
              return [{ id: PROJECT_ID }];
            },
            findFirst: async () => null,
            create: async () => ({ id: PROJECT_ID }),
            update: async () => ({ id: PROJECT_ID }),
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(
      app,
      "/api/projects?search=Alpha&includeArchived=true",
    );

    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: PROJECT_ID }]);
    expect(capturedArgs).toMatchObject({
      where: {
        userId: USER_ID,
        OR: [
          { name: { contains: "Alpha", mode: "insensitive" } },
          { description: { contains: "Alpha", mode: "insensitive" } },
        ],
      },
    });
  });

  test("GET /api/projects/:id returns project", async () => {
    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => ({ id: PROJECT_ID, name: "Demo" }),
            create: async () => ({ id: PROJECT_ID }),
            update: async () => ({ id: PROJECT_ID }),
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/projects/${PROJECT_ID}`);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: PROJECT_ID, name: "Demo" });
  });

  test("GET /api/projects/:id/items returns project with related items", async () => {
    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async (args) => {
              const includeItems =
                typeof args === "object" &&
                args !== null &&
                "include" in args &&
                !!(args as { include?: unknown }).include;

              if (includeItems) {
                return {
                  id: PROJECT_ID,
                  chatThreads: [],
                  tasks: [],
                  notes: [],
                };
              }

              return { id: PROJECT_ID };
            },
            create: async () => ({ id: PROJECT_ID }),
            update: async () => ({ id: PROJECT_ID }),
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(
      app,
      `/api/projects/${PROJECT_ID}/items`,
    );

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: PROJECT_ID, chatThreads: [], tasks: [], notes: [] });
  });

  test("POST /api/projects creates a project", async () => {
    let capturedCreateArgs: unknown;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => null,
            create: async (args) => {
              capturedCreateArgs = args;
              return { id: PROJECT_ID, name: "Created" };
            },
            update: async () => ({ id: PROJECT_ID }),
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Created", description: "New" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: PROJECT_ID, name: "Created" });
    expect(capturedCreateArgs).toMatchObject({
      data: {
        userId: USER_ID,
        name: "Created",
        description: "New",
      },
    });
  });

  test("PATCH /api/projects/:id updates project", async () => {
    let capturedUpdateArgs: unknown;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => ({ id: PROJECT_ID }),
            create: async () => ({ id: PROJECT_ID }),
            update: async (args) => {
              capturedUpdateArgs = args;
              return { id: PROJECT_ID, name: "Renamed" };
            },
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/projects/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: PROJECT_ID, name: "Renamed" });
    expect(capturedUpdateArgs).toMatchObject({
      where: { id: PROJECT_ID },
      data: { name: "Renamed" },
    });
  });

  test("POST /api/projects/:id/archive archives project", async () => {
    let capturedUpdateArgs: unknown;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => ({ id: PROJECT_ID }),
            create: async () => ({ id: PROJECT_ID }),
            update: async (args) => {
              capturedUpdateArgs = args;
              return { id: PROJECT_ID, archivedAt: new Date().toISOString() };
            },
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response } = await requestJson(app, `/api/projects/${PROJECT_ID}/archive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(capturedUpdateArgs).toMatchObject({ where: { id: PROJECT_ID } });
  });

  test("POST /api/projects/:id/unarchive unarchives project", async () => {
    let capturedUpdateArgs: unknown;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => ({ id: PROJECT_ID }),
            create: async () => ({ id: PROJECT_ID }),
            update: async (args) => {
              capturedUpdateArgs = args;
              return { id: PROJECT_ID, archivedAt: null };
            },
            delete: async () => ({}),
          },
        }),
      }),
    );

    const { response } = await requestJson(app, `/api/projects/${PROJECT_ID}/unarchive`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(capturedUpdateArgs).toMatchObject({
      where: { id: PROJECT_ID },
      data: { archivedAt: null },
    });
  });

  test("DELETE /api/projects/:id deletes project", async () => {
    let deleteCalled = false;

    const app = createTestApp(
      createProjectsRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          project: {
            findMany: async () => [],
            findFirst: async () => ({ id: PROJECT_ID }),
            create: async () => ({ id: PROJECT_ID }),
            update: async () => ({ id: PROJECT_ID }),
            delete: async () => {
              deleteCalled = true;
              return {};
            },
          },
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/api/projects/${PROJECT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(deleteCalled).toBe(true);
  });
});
