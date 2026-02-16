import { z } from "zod";

export const inboxAgentKeyEnum = z.enum(["kb_note", "todo_list"]);

export const patchInboxAgentSettingsSchema = z.object({
  agents: z
    .array(
      z.object({
        key: inboxAgentKeyEnum,
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(20),
});

export type PatchInboxAgentSettingsInput = z.infer<typeof patchInboxAgentSettingsSchema>;
