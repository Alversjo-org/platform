CREATE TABLE "fx_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_sync_run_one_running" ON "fx_sync_run" USING btree ("status") WHERE "fx_sync_run"."status" = 'running';