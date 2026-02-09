type MockProject = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MockNote = {
  id: string;
  userId: string;
  title: string;
  content: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  sourceMessageId: string | null;
  project: MockProject | null;
};

type MockChatThread = {
  id: string;
  userId: string;
  name: string;
  modelKey: string | null;
  summary: string | null;
  summaryUpTo: string | null;
  lastChattedAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  project: MockProject | null;
};

type MockChatMessage = {
  id: string;
  threadId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  modelKey: string | null;
  modelLabel: string | null;
  modelProvider: string | null;
  tokenCount: number | null;
  tokenCountSource: "ESTIMATE" | "PROVIDER" | null;
  savedNoteId: string | null;
};

const now = new Date();
const chatThreadAId = "ckz1q2w3e4r5t6y7u8i9o0p1f";
const chatThreadBId = "ckz1q2w3e4r5t6y7u8i9o0p2g";

function iso(date: Date) {
  return date.toISOString();
}

const mockNotes: MockNote[] = [
  {
    id: "note-first",
    userId: "user-e2e",
    title: "First note",
    content: "First note body sentinel",
    deletedAt: null,
    createdAt: iso(new Date(now.getTime() - 60 * 60 * 1000)),
    updatedAt: iso(new Date(now.getTime() - 2 * 60 * 1000)),
    projectId: null,
    sourceMessageId: null,
    project: null,
  },
  {
    id: "note-second",
    userId: "user-e2e",
    title: "Second note",
    content: "Second note body sentinel",
    deletedAt: null,
    createdAt: iso(new Date(now.getTime() - 2 * 60 * 60 * 1000)),
    updatedAt: iso(new Date(now.getTime() - 10 * 60 * 1000)),
    projectId: null,
    sourceMessageId: null,
    project: null,
  },
];

function buildThreadMessages(threadId: string, label: string): MockChatMessage[] {
  const messageCount = 40;
  return Array.from({ length: messageCount }, (_, index) => {
    const role = index % 2 === 0 ? "USER" : "ASSISTANT";
    const messageNumber = index + 1;
    return {
      id: `${threadId}-message-${messageNumber}`,
      threadId,
      role,
      content: `${label} message ${messageNumber}`,
      createdAt: iso(new Date(now.getTime() - (messageCount - index) * 60_000)),
      modelKey: role === "ASSISTANT" ? "openai.gpt-5-mini" : null,
      modelLabel: role === "ASSISTANT" ? "OpenAI GPT-5 Mini" : null,
      modelProvider: role === "ASSISTANT" ? "openai" : null,
      tokenCount: role === "ASSISTANT" ? 42 : null,
      tokenCountSource: role === "ASSISTANT" ? "ESTIMATE" : null,
      savedNoteId: null,
    };
  });
}

const mockChatThreads: MockChatThread[] = [
  {
    id: chatThreadAId,
    userId: "user-e2e",
    name: "Thread A",
    modelKey: null,
    summary: null,
    summaryUpTo: null,
    lastChattedAt: iso(now),
    archivedAt: null,
    createdAt: iso(now),
    updatedAt: iso(now),
    projectId: null,
    project: null,
  },
  {
    id: chatThreadBId,
    userId: "user-e2e",
    name: "Thread B",
    modelKey: null,
    summary: null,
    summaryUpTo: null,
    lastChattedAt: iso(new Date(now.getTime() - 5 * 60_000)),
    archivedAt: null,
    createdAt: iso(new Date(now.getTime() - 5 * 60_000)),
    updatedAt: iso(new Date(now.getTime() - 5 * 60_000)),
    projectId: null,
    project: null,
  },
];

const mockChatMessagesByThread: Record<string, MockChatMessage[]> = {
  [chatThreadAId]: buildThreadMessages(chatThreadAId, "Thread A"),
  [chatThreadBId]: buildThreadMessages(chatThreadBId, "Thread B"),
};

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

function readCookie(request: Request, cookieName: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookiePart = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  if (!cookiePart) {
    return null;
  }

  return cookiePart.slice(cookieName.length + 1);
}

function isSessionAuthenticated(request: Request) {
  const sessionCookie = readCookie(request, "mock-session");
  return sessionCookie !== "invalid";
}

function handleNotesById(pathname: string, method: string, request: Request) {
  const id = pathname.replace("/api/notes/", "");
  const existing = mockNotes.find((note) => note.id === id);

  if (!existing) {
    return jsonResponse({ error: "not_found", message: "Note not found" }, 404);
  }

  if (method === "GET") {
    return jsonResponse(existing);
  }

  if (method === "PATCH") {
    return request
      .json()
      .catch(() => ({}))
      .then((payload) => {
        const nextTitle =
          typeof payload.title === "string" ? payload.title : existing.title;
        const nextContent =
          typeof payload.content === "string" ? payload.content : existing.content;

        const updated: MockNote = {
          ...existing,
          title: nextTitle,
          content: nextContent,
          updatedAt: iso(new Date()),
        };

        const index = mockNotes.findIndex((note) => note.id === id);
        mockNotes[index] = updated;

        return jsonResponse(updated);
      });
  }

  if (method === "DELETE") {
    return jsonResponse({ success: true });
  }

  return jsonResponse(
    { error: "method_not_allowed", message: "Method not allowed" },
    405,
  );
}

const port = Number(process.env.PLAYWRIGHT_API_PORT ?? 3201);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (pathname === "/api/auth/get-session" && method === "GET") {
      if (!isSessionAuthenticated(request)) {
        return jsonResponse(
          {
            error: "unauthorized",
            message: "Unauthorized",
          },
          401,
        );
      }

      return jsonResponse({
        data: {
          session: {
            user: {
              id: "user-e2e",
              name: "E2E User",
              email: "e2e@example.com",
            },
          },
        },
      });
    }

    if (pathname === "/api/auth/sign-in/email" && method === "POST") {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const email =
            payload && typeof payload === "object" && "email" in payload
              ? String((payload as { email?: unknown }).email ?? "")
              : "";
          const password =
            payload && typeof payload === "object" && "password" in payload
              ? String((payload as { password?: unknown }).password ?? "")
              : "";

          if (email !== "demo@lifeos.dev" || password !== "demo12345") {
            return jsonResponse(
              {
                message: "Invalid email or password",
              },
              401,
            );
          }

          return jsonResponse(
            {
              success: true,
            },
            200,
            {
              "set-cookie": "mock-session=valid; Path=/; HttpOnly; SameSite=Lax",
            },
          );
        });
    }

    if (pathname === "/api/auth/sign-up/email" && method === "POST") {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const email =
            payload && typeof payload === "object" && "email" in payload
              ? String((payload as { email?: unknown }).email ?? "")
              : "";

          if (email.endsWith("@taken.dev")) {
            return jsonResponse(
              {
                message: "Email already exists",
              },
              409,
            );
          }

          return jsonResponse(
            {
              success: true,
            },
            200,
            {
              "set-cookie": "mock-session=valid; Path=/; HttpOnly; SameSite=Lax",
            },
          );
        });
    }

    if (pathname === "/api/auth/request-password-reset" && method === "POST") {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const email =
            payload && typeof payload === "object" && "email" in payload
              ? String((payload as { email?: unknown }).email ?? "")
              : "";

          if (email === "missing@lifeos.dev") {
            return jsonResponse(
              {
                message: "Account not found",
              },
              404,
            );
          }

          return jsonResponse({
            success: true,
          });
        });
    }

    if (pathname === "/api/auth/reset-password" && method === "POST") {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const token =
            payload && typeof payload === "object" && "token" in payload
              ? String((payload as { token?: unknown }).token ?? "")
              : "";
          const newPassword =
            payload && typeof payload === "object" && "newPassword" in payload
              ? String((payload as { newPassword?: unknown }).newPassword ?? "")
              : "";

          if (token !== "valid-reset-token" || newPassword.length < 8) {
            return jsonResponse(
              {
                message: "Invalid or expired reset token",
              },
              400,
            );
          }

          return jsonResponse({
            success: true,
          });
        });
    }

    if (pathname === "/api/auth/sign-out" && method === "POST") {
      return jsonResponse(
        {
          success: true,
        },
        200,
        {
          "set-cookie": "mock-session=invalid; Path=/; HttpOnly; SameSite=Lax",
        },
      );
    }

    if (pathname === "/api/home/recent-projects" && method === "GET") {
      return jsonResponse([]);
    }

    if (pathname === "/api/home/upcoming-tasks" && method === "GET") {
      return jsonResponse([]);
    }

    if (pathname === "/api/home/recent-notes" && method === "GET") {
      return jsonResponse([]);
    }

    if (pathname === "/api/notes" && method === "GET") {
      return jsonResponse(mockNotes);
    }

    if (pathname === "/api/notes" && method === "POST") {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const created: MockNote = {
            id: `note-${mockNotes.length + 1}`,
            userId: "user-e2e",
            title:
              typeof payload.title === "string" ? payload.title : "New Note",
            content:
              typeof payload.content === "string" ? payload.content : "",
            deletedAt: null,
            createdAt: iso(new Date()),
            updatedAt: iso(new Date()),
            projectId:
              typeof payload.projectId === "string" ? payload.projectId : null,
            sourceMessageId: null,
            project: null,
          };

          mockNotes.unshift(created);
          return jsonResponse(created, 201);
        });
    }

    if (pathname === "/api/chat/models" && method === "GET") {
      return jsonResponse([
        {
          key: "openai.gpt-5-mini",
          label: "OpenAI GPT-5 Mini",
          provider: "openai",
          costTier: "economy",
          description: "Fast model for everyday chat.",
          supportsStreaming: true,
        },
        {
          key: "anthropic.claude-haiku-4-5",
          label: "Anthropic Claude Haiku 4.5",
          provider: "anthropic",
          costTier: "economy",
          description: "Lightweight Claude option.",
          supportsStreaming: true,
        },
      ]);
    }

    if (pathname === "/api/chat/threads" && method === "GET") {
      return jsonResponse(mockChatThreads);
    }

    const messagesMatch = pathname.match(/^\/api\/chat\/threads\/([^/]+)\/messages$/);
    if (messagesMatch && method === "GET") {
      const threadId = messagesMatch[1];
      const messages = mockChatMessagesByThread[threadId];
      if (!messages) {
        return jsonResponse(
          { error: "not_found", message: "Thread not found" },
          404,
        );
      }
      return jsonResponse({
        threadId,
        messages,
        nextCursor: null,
      });
    }

    const modelMatch = pathname.match(/^\/api\/chat\/threads\/([^/]+)\/model$/);
    if (modelMatch && method === "POST") {
      const threadId = modelMatch[1];
      const threadIndex = mockChatThreads.findIndex((thread) => thread.id === threadId);
      if (threadIndex === -1) {
        return jsonResponse(
          { error: "not_found", message: "Thread not found" },
          404,
        );
      }

      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const modelKey =
            payload && typeof payload === "object" && "modelKey" in payload
              ? (payload as { modelKey?: string | null }).modelKey ?? null
              : null;

          const updated = {
            ...mockChatThreads[threadIndex],
            modelKey,
            updatedAt: iso(new Date()),
          };
          mockChatThreads[threadIndex] = updated;
          return jsonResponse(updated);
        });
    }

    if (pathname.startsWith("/api/notes/")) {
      return handleNotesById(pathname, method, request);
    }

    return jsonResponse(
      {
        error: "not_found",
        message: `No mock route for ${method} ${pathname}`,
      },
      404,
    );
  },
});

console.log(`Mock API listening on http://127.0.0.1:${server.port}`);
