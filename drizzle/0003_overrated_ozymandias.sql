CREATE TABLE "renewal_message_setting" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "discord_handle" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_contacted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "contact_notes" text;--> statement-breakpoint
ALTER TABLE "renewal_message_setting" ADD CONSTRAINT "renewal_message_setting_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;