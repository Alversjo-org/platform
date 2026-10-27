CREATE TABLE "fortnox_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token" text,
	"scope" text,
	"connected_by_user_id" text,
	"connected_at" timestamp,
	"last_refreshed_at" timestamp,
	"last_refresh_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_account" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_cost_centre" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_cost_centre_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fx_financial_year" (
	"id" text PRIMARY KEY NOT NULL,
	"fortnox_id" integer NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text NOT NULL,
	"locked_until_date" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_financial_year_fortnox_id_unique" UNIQUE("fortnox_id")
);
--> statement-breakpoint
CREATE TABLE "fx_project" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fx_project_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fx_sync_state" (
	"topic" text PRIMARY KEY NOT NULL,
	"last_websocket_offset" text,
	"last_full_sync_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "fx_voucher" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"series" text NOT NULL,
	"number" integer NOT NULL,
	"date" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference_type" text,
	"reference_number" text,
	"comments" text,
	"has_attachment" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_voucher_row" (
	"id" text PRIMARY KEY NOT NULL,
	"voucher_id" text NOT NULL,
	"row_index" integer NOT NULL,
	"account" integer NOT NULL,
	"debit_sek" integer DEFAULT 0 NOT NULL,
	"credit_sek" integer DEFAULT 0 NOT NULL,
	"cost_centre_code" text,
	"fx_project_code" text,
	"transaction_info" text,
	"removed" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fortnox_connection" ADD CONSTRAINT "fortnox_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_voucher_row" ADD CONSTRAINT "fx_voucher_row_voucher_id_fx_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."fx_voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_voucher_row" ADD CONSTRAINT "fx_voucher_row_cost_centre_code_fx_cost_centre_code_fk" FOREIGN KEY ("cost_centre_code") REFERENCES "public"."fx_cost_centre"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_voucher_row" ADD CONSTRAINT "fx_voucher_row_fx_project_code_fx_project_code_fk" FOREIGN KEY ("fx_project_code") REFERENCES "public"."fx_project"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_account_year_number_idx" ON "fx_account" USING btree ("year","number");--> statement-breakpoint
CREATE INDEX "fx_voucher_key_idx" ON "fx_voucher" USING btree ("year","series","number");--> statement-breakpoint
CREATE INDEX "fx_voucher_row_voucher_idx" ON "fx_voucher_row" USING btree ("voucher_id","row_index");