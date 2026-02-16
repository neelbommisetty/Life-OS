import { Hono } from "hono";
import { resolveUserIdFromRequest } from "../common/auth.js";
import { getDbClient } from "../common/db.js";
import { handleRouteError, readJsonRequest } from "../common/http.js";
import {
  getInboxAgentSettings,
  patchInboxAgentSettings,
  type InboxAgentSettingsDb,
} from "./inbox-agents-service.js";

type InboxAgentSettingsRouteDependencies = {
  getDb?: () => Promise<InboxAgentSettingsDb>;
  getUserId?: (request: Request) => Promise<string>;
};

export function createInboxAgentSettingsRoute(
  dependencies: InboxAgentSettingsRouteDependencies = {},
) {
  const route = new Hono();
  const getDb = dependencies.getDb ?? (() => getDbClient<InboxAgentSettingsDb>());
  const getUserId = dependencies.getUserId ?? resolveUserIdFromRequest;

  route.get("/settings/inbox-agents", async (c) => {
    try {
      const [db, userId] = await Promise.all([getDb(), getUserId(c.req.raw)]);
      return c.json(
        await getInboxAgentSettings({
          db,
          userId,
        }),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  route.patch("/settings/inbox-agents", async (c) => {
    try {
      const body = await readJsonRequest(c.req.raw);
      const [db, userId] = await Promise.all([getDb(), getUserId(c.req.raw)]);
      return c.json(
        await patchInboxAgentSettings({
          db,
          userId,
          input: body as {
            agents: Array<{ key: "kb_note" | "todo_list"; enabled: boolean }>;
          },
        }),
      );
    } catch (error) {
      return handleRouteError(c, error);
    }
  });

  return route;
}

export const inboxAgentSettingsRoute = createInboxAgentSettingsRoute();
