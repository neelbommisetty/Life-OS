import {
  listInboxAgentSettings,
  updateInboxAgentSettings,
  type InboxDb,
} from "../inbox/service.js";
import {
  patchInboxAgentSettingsSchema,
  type PatchInboxAgentSettingsInput,
} from "./inbox-agents-schemas.js";

export type InboxAgentSettingsDb = InboxDb;

export async function getInboxAgentSettings(params: {
  db: InboxAgentSettingsDb;
  userId: string;
}) {
  return listInboxAgentSettings({
    db: params.db,
    userId: params.userId,
  });
}

export async function patchInboxAgentSettings(params: {
  db: InboxAgentSettingsDb;
  userId: string;
  input: PatchInboxAgentSettingsInput;
}) {
  const parsed = patchInboxAgentSettingsSchema.parse(params.input);

  return updateInboxAgentSettings({
    db: params.db,
    userId: params.userId,
    input: parsed,
  });
}
