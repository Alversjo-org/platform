CREATE TABLE "area" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"capacity" integer,
	"bookable" boolean DEFAULT true NOT NULL,
	"map_ref" text
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"diff" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_area" (
	"id" text PRIMARY KEY NOT NULL,
	"event_project_id" text NOT NULL,
	"area_id" text NOT NULL,
	"from" timestamp NOT NULL,
	"to" timestamp NOT NULL,
	"setup_note" text
);
--> statement-breakpoint
CREATE TABLE "event_details" (
	"project_id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"has_capacity_limit" boolean NOT NULL,
	"capacity" integer,
	"signup_opens_at" timestamp,
	"signup_closes_at" timestamp,
	"price_sek" integer DEFAULT 0 NOT NULL,
	"price_note" text,
	"contact_note" text,
	"show_signups_to_participants" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_signup" (
	"event_project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_signup_event_project_id_user_id_pk" PRIMARY KEY("event_project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"owner_user_id" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "can_create_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ical_token" text;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_area" ADD CONSTRAINT "event_area_event_project_id_project_id_fk" FOREIGN KEY ("event_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_area" ADD CONSTRAINT "event_area_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_details" ADD CONSTRAINT "event_details_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signup" ADD CONSTRAINT "event_signup_event_project_id_project_id_fk" FOREIGN KEY ("event_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signup" ADD CONSTRAINT "event_signup_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_area_area_time_idx" ON "event_area" USING btree ("area_id","from","to");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_ical_token_unique" UNIQUE("ical_token");