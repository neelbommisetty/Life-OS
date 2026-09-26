// JSON-only public types. No database, provider, or filesystem imports.
import type { AccountAddReceipt, AccountAddInput } from "../calendar/accounts.ts";
import type { Account, Calendar, Project } from "../contract.ts";
import type { Resolution, resolveAvailability } from "../media/lookup.ts";
import type { Medium } from "../contract.ts";
import type { Tools } from "../tools.ts";
import type { DoctorReport } from "./diagnostics.ts";

export type ApiErrorCode = "invalid_request" | "unauthorized" | "not_found" | "db_unavailable" | "provider_unavailable" | "provider_rejected" | "catalog_unavailable" | "catalog_unconfigured" | "needs_reauth" | "rejected" | "internal" | "api_unavailable";
export type ApiFailure = { code: ApiErrorCode; message: string; issues?: string[] };
export type Connection = { id: string; status: "pending" | "complete" | "failed"; url?: string; receipt?: AccountAddReceipt; error?: ApiFailure };
export type DisplayIndexes = { projects: Project[]; calendars: Calendar[]; accounts: Account[] };
export type Info = { version: "1"; timezone: string; region: string };
type JsonResolution<T> = T extends { error: Error } ? Omit<T, "error"> & { error: string } : T;
export type LookupResult = JsonResolution<Resolution>;
export type AvailabilityResult = JsonResolution<Awaited<ReturnType<typeof resolveAvailability>>>;
export type ToolsClient = Pick<Tools, "task" | "project" | "section" | "label" | "filter" | "calendar" | "event" | "views" | "title" | "media" | "export"> & {
  account: Omit<Tools["account"], "add"> & { add(input: AccountAddInput, ctx: Parameters<Tools["account"]["add"]>[1]): Promise<AccountAddReceipt> };
  catalog: {
    resolve(medium: Medium, text: string, opts?: { year?: number; externalId?: string }): Promise<LookupResult>;
    availability(medium: Medium, externalId: string): Promise<AvailabilityResult>;
  };
  indexes(): Promise<DisplayIndexes>;
  info(): Promise<Info>;
  doctor(opts?: { online?: boolean; actor?: string }): Promise<DoctorReport>;
  migrate(): Promise<{ migrated: true }>;
  close(): Promise<void>;
};
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly issues?: string[];
  constructor(error: ApiFailure) { super(error.message); this.name = "ApiError"; this.code = error.code; this.issues = error.issues; }
}
