CREATE TABLE "user_role" (
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
SELECT "id", 'admin', NULL FROM "user" WHERE "role" = 'admin';
--> statement-breakpoint
INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
SELECT "id", 'member-admin', NULL FROM "user" WHERE "role" = 'member-admin';
--> statement-breakpoint
INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
SELECT "id", 'mapper', NULL FROM "user" WHERE "role" = 'member-admin';
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role";