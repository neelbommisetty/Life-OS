CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "events_calendar_idx" ON "events" USING btree (("json"->>'calendarId'));--> statement-breakpoint
CREATE INDEX "events_master_idx" ON "events" USING btree (("json"->>'masterId'));--> statement-breakpoint
CREATE INDEX "events_start_at_idx" ON "events" USING btree (("json"->'start'->>'at'));--> statement-breakpoint
CREATE INDEX "events_start_date_idx" ON "events" USING btree (("json"->'start'->>'date'));--> statement-breakpoint
CREATE INDEX "events_external_id_idx" ON "events" USING btree (("json"->'external'->>'id'));