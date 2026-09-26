import { z } from "@hono/zod-openapi";
import * as contract from "../contract.ts";

/** Domain input validation deliberately runs in the core, which returns a
 * rejected receipt rather than throwing. OpenAPI still describes those inputs
 * precisely by reusing the same Zod schemas; no second domain model to maintain.
 */
export function domainInput(schema: z.ZodType): z.ZodType {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const boundary = z.record(z.string(), z.unknown());
  // Both libraries emit JSON Schema 2020-12; their TS definitions differ on
  // boolean subschemas. These object contracts have no boolean root schema.
  return boundary.openapi(json as unknown as NonNullable<Parameters<typeof boundary.openapi>[1]>);
}

export const inputs = {
  ctx: domainInput(contract.ctxSchema),
  taskAdd: domainInput(contract.taskAddSchema), taskUpdate: domainInput(contract.taskUpdateSchema), taskMove: domainInput(contract.taskMoveSchema), taskList: domainInput(contract.taskListSchema),
  projectAdd: domainInput(contract.projectAddSchema), projectUpdate: domainInput(contract.projectUpdateSchema),
  sectionAdd: domainInput(contract.sectionAddSchema), sectionUpdate: domainInput(contract.sectionUpdateSchema),
  labelAdd: domainInput(contract.labelAddSchema), labelUpdate: domainInput(contract.labelUpdateSchema),
  filterAdd: domainInput(contract.filterAddSchema), filterUpdate: domainInput(contract.filterUpdateSchema),
  accountUpdate: domainInput(contract.accountUpdateSchema), calendarUpdate: domainInput(contract.calendarUpdateSchema),
  eventAdd: domainInput(contract.eventAddSchema), eventUpdate: domainInput(contract.eventUpdateSchema),
  titleAdd: domainInput(contract.titleAddSchema), titleUpdate: domainInput(contract.titleUpdateSchema), titleList: domainInput(contract.titleListSchema),
  entry: domainInput(contract.entryInputSchema), entryPatch: domainInput(contract.entryPatchSchema), due: domainInput(contract.due),
};
