CREATE TABLE "filters" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"op" text NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" text NOT NULL,
	"patch" jsonb NOT NULL,
	"reason" text,
	"evidence" jsonb NOT NULL,
	"key" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"key" text PRIMARY KEY NOT NULL,
	"receipt" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"json" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "log_record_idx" ON "log" USING btree ("record_kind","record_id","seq");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree (("json"->>'status'));--> statement-breakpoint
CREATE INDEX "tasks_project_idx" ON "tasks" USING btree (("json"->>'projectId'));--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree (("json"->'due'->>'date'));