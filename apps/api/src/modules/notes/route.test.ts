import { describe, expect, test } from "bun:test";
import { createNotesRoute } from "./route.js";
import { createTestApp, requestJson } from "../../test/harness.js";

const USER_ID = "ckz1q2w3e4r5t6y7u8i9o0p1a";
const NOTE_ID = "ckz1q2w3e4r5t6y7u8i9o0p1c";
const MESSAGE_ID = "ckz1q2w3e4r5t6y7u8i9o0p1d";

describe("notesRoute", () => {
  test("GET /notes lists notes", async () => {
    let capturedArgs: unknown;

    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async (args) => {
              capturedArgs = args;
              return [{ id: NOTE_ID }];
            },
            findFirst: async () => null,
            create: async () => ({ id: NOTE_ID }),
            update: async () => ({ id: NOTE_ID }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => null,
                update: async () => ({}),
                updateMany: async () => ({}),
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/notes?search=hello");
    expect(response.status).toBe(200);
    expect(body).toEqual([{ id: NOTE_ID }]);
    expect(capturedArgs).toMatchObject({
      where: {
        userId: USER_ID,
        deletedAt: null,
      },
    });
  });

  test("GET /notes/:id returns note", async () => {
    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async () => [],
            findFirst: async () => ({ id: NOTE_ID, title: "Doc" }),
            create: async () => ({ id: NOTE_ID }),
            update: async () => ({ id: NOTE_ID }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => null,
                update: async () => ({}),
                updateMany: async () => ({}),
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/notes/${NOTE_ID}`);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: NOTE_ID, title: "Doc" });
  });

  test("POST /notes creates note", async () => {
    let capturedCreateArgs: unknown;

    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async () => [],
            findFirst: async () => null,
            create: async (args) => {
              capturedCreateArgs = args;
              return { id: NOTE_ID, title: "New" };
            },
            update: async () => ({ id: NOTE_ID }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => null,
                update: async () => ({}),
                updateMany: async () => ({}),
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New", content: "Body" }),
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ id: NOTE_ID, title: "New" });
    expect(capturedCreateArgs).toMatchObject({
      data: {
        userId: USER_ID,
        title: "New",
        content: "Body",
      },
    });
  });

  test("POST /notes/save-from-message saves assistant message as note", async () => {
    let updateCalled = false;

    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async () => [],
            findFirst: async () => null,
            create: async () => ({ id: NOTE_ID }),
            update: async () => ({ id: NOTE_ID }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => ({
                  id: MESSAGE_ID,
                  role: "ASSISTANT",
                  content: "Save this",
                  savedNoteId: null,
                  thread: { projectId: null },
                }),
                update: async () => {
                  updateCalled = true;
                  return {};
                },
                updateMany: async () => ({}),
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, "/notes/save-from-message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: MESSAGE_ID }),
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ note: { id: NOTE_ID }, alreadySaved: false });
    expect(updateCalled).toBe(true);
  });

  test("PATCH /notes/:id updates note", async () => {
    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async () => [],
            findFirst: async () => ({ id: NOTE_ID }),
            create: async () => ({ id: NOTE_ID }),
            update: async () => ({ id: NOTE_ID, title: "Renamed" }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => null,
                update: async () => ({}),
                updateMany: async () => ({}),
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/notes/${NOTE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed", content: "Updated" }),
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: NOTE_ID, title: "Renamed" });
  });

  test("DELETE /notes/:id soft deletes note", async () => {
    let txUpdateManyCalled = false;

    const app = createTestApp(
      createNotesRoute({
        getUserId: async () => USER_ID,
        getDb: async () => ({
          note: {
            findMany: async () => [],
            findFirst: async () => ({ id: NOTE_ID, sourceMessageId: MESSAGE_ID }),
            create: async () => ({ id: NOTE_ID }),
            update: async () => ({ id: NOTE_ID }),
          },
          chatMessage: {
            updateMany: async () => ({}),
          },
          $transaction: async (callback) =>
            callback({
              chatMessage: {
                findFirst: async () => null,
                update: async () => ({}),
                updateMany: async () => {
                  txUpdateManyCalled = true;
                  return {};
                },
              },
              note: {
                findFirst: async () => null,
                create: async () => ({ id: NOTE_ID }),
                update: async () => ({ id: NOTE_ID }),
              },
            }),
        }),
      }),
    );

    const { response, body } = await requestJson(app, `/notes/${NOTE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(txUpdateManyCalled).toBe(true);
  });
});
