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

const now = new Date();
const chatThreadId = "ckz1q2w3e4r5t6y7u8i9o0p1f";

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

const mockChatThread: MockChatThread = {
  id: chatThreadId,
  userId: "user-e2e",
  name: "New thread",
  modelKey: null,
  summary: null,
  summaryUpTo: null,
  lastChattedAt: iso(now),
  archivedAt: null,
  createdAt: iso(now),
  updatedAt: iso(now),
  projectId: null,
  project: null,
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
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

    if (pathname === "/api/auth/get-session") {
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
      return jsonResponse([mockChatThread]);
    }

    if (
      pathname === `/api/chat/threads/${chatThreadId}/messages` &&
      method === "GET"
    ) {
      return jsonResponse({
        threadId: chatThreadId,
        messages: [],
        nextCursor: null,
      });
    }

    if (
      pathname === `/api/chat/threads/${chatThreadId}/model` &&
      method === "POST"
    ) {
      return request
        .json()
        .catch(() => ({}))
        .then((payload) => {
          const modelKey =
            payload && typeof payload === "object" && "modelKey" in payload
              ? (payload as { modelKey?: string | null }).modelKey ?? null
              : null;

          mockChatThread.modelKey = modelKey;
          mockChatThread.updatedAt = iso(new Date());
          return jsonResponse(mockChatThread);
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
