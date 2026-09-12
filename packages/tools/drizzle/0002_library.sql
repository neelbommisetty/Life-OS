CREATE TABLE "titles" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "titles_medium_idx" ON "titles" USING btree (("json"->>'medium'));--> statement-breakpoint
CREATE INDEX "titles_status_idx" ON "titles" USING btree (("json"->>'status'));--> statement-breakpoint
CREATE INDEX "titles_ownership_idx" ON "titles" USING btree (("json"->>'ownership'));--> statement-breakpoint
CREATE INDEX "titles_name_idx" ON "titles" USING btree ((lower("json"->>'name')));--> statement-breakpoint
CREATE INDEX "titles_external_id_idx" ON "titles" USING btree (("json"->'catalog'->>'externalId'));