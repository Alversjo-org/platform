CREATE TABLE "expense" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"description" text NOT NULL,
	"merchant" text DEFAULT '' NOT NULL,
	"purchase_date" text NOT NULL,
	"total_ore" integer NOT NULL,
	"vat_ore" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"ocr_suggestion" jsonb,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"rejection_reason" text,
	"cost_account" integer,
	"cost_centre_code" text,
	"fx_project_code" text,
	"book_vat" boolean DEFAULT true NOT NULL,
	"voucher_year" integer,
	"voucher_series" text,
	"voucher_number" integer,
	"booked_at" timestamp,
	"booking_error" text,
	"payment_batch_id" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "expense_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"expense_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"fortnox_file_id" text,
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"debtor_name" text DEFAULT '' NOT NULL,
	"debtor_org_number" text DEFAULT '' NOT NULL,
	"debtor_iban" text DEFAULT '' NOT NULL,
	"debtor_bic" text DEFAULT '' NOT NULL,
	"bank_customer_id" text DEFAULT '' NOT NULL,
	"bank_ledger_account" integer DEFAULT 1930 NOT NULL,
	"liability_account" integer DEFAULT 2890 NOT NULL,
	"vat_account" integer DEFAULT 2640 NOT NULL,
	"default_cost_account" integer DEFAULT 6990 NOT NULL,
	"outlay_series" text DEFAULT 'U' NOT NULL,
	"payout_series" text DEFAULT 'UB' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "member_bank_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"holder_name" text NOT NULL,
	"encrypted" text NOT NULL,
	"last4" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "payment_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'exported' NOT NULL,
	"execution_date" text NOT NULL,
	"total_ore" integer NOT NULL,
	"count" integer NOT NULL,
	"file_encrypted" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" text,
	"decided_by_user_id" text,
	"voucher_year" integer,
	"voucher_series" text,
	"voucher_number" integer,
	"booking_error" text,
	CONSTRAINT "payment_batch_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_payment_batch_id_payment_batch_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipt" ADD CONSTRAINT "expense_receipt_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_settings" ADD CONSTRAINT "expense_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bank_account" ADD CONSTRAINT "member_bank_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bank_account" ADD CONSTRAINT "member_bank_account_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_batch" ADD CONSTRAINT "payment_batch_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_user_idx" ON "expense" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "expense_status_idx" ON "expense" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expense_receipt_expense_idx" ON "expense_receipt" USING btree ("expense_id");