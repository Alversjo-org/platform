CREATE TABLE "external_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"amount_cents" integer,
	"currency" text,
	"paid_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_payments_source_external_id_unique" UNIQUE("source","external_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "email_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "external_payments" ADD CONSTRAINT "external_payments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;