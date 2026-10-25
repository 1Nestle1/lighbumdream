ALTER TABLE "idea_runs" ADD COLUMN "kind" text DEFAULT 'loop' NOT NULL;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "favorite_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ideas_user_favorite_idx" ON "ideas" USING btree ("user_id","favorite_at");