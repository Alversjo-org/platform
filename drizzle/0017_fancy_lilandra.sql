CREATE TABLE "wiki_page" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"parent_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "wiki_page_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"edited_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_parent_id_wiki_page_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."wiki_page"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_comment" ADD CONSTRAINT "wiki_page_comment_page_id_wiki_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_comment" ADD CONSTRAINT "wiki_page_comment_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_page_id_wiki_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."wiki_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_edited_by_user_id_user_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "wiki_page_search_idx" ON "wiki_page" USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("search_text", '')));
