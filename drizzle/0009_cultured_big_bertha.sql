CREATE TABLE "annual_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"fiscal_year" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annual_budget_year_version_key" UNIQUE("fiscal_year","version")
);
--> statement-breakpoint
CREATE TABLE "budget_amount" (
	"id" text PRIMARY KEY NOT NULL,
	"annual_budget_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"project_group_id" text,
	"project_id" text,
	"kind" text NOT NULL,
	"month" integer,
	"amount_sek" integer NOT NULL,
	"account_from" integer,
	"account_to" integer
);
--> statement-breakpoint
CREATE TABLE "project_group" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cost_centre_code" text,
	"parent_id" text,
	CONSTRAINT "project_group_cost_centre_code_unique" UNIQUE("cost_centre_code")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "project_group_id" text;--> statement-breakpoint
ALTER TABLE "annual_budget" ADD CONSTRAINT "annual_budget_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_amount" ADD CONSTRAINT "budget_amount_annual_budget_id_annual_budget_id_fk" FOREIGN KEY ("annual_budget_id") REFERENCES "public"."annual_budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_amount" ADD CONSTRAINT "budget_amount_project_group_id_project_group_id_fk" FOREIGN KEY ("project_group_id") REFERENCES "public"."project_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_amount" ADD CONSTRAINT "budget_amount_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_cost_centre_code_fx_cost_centre_code_fk" FOREIGN KEY ("cost_centre_code") REFERENCES "public"."fx_cost_centre"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_group" ADD CONSTRAINT "project_group_parent_id_project_group_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_project_group_id_project_group_id_fk" FOREIGN KEY ("project_group_id") REFERENCES "public"."project_group"("id") ON DELETE no action ON UPDATE no action;