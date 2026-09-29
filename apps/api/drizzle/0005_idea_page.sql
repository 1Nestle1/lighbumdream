CREATE TABLE "idea_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "idea_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_clips" ADD COLUMN "note_id" uuid;--> statement-breakpoint
ALTER TABLE "idea_files" ADD CONSTRAINT "idea_files_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_files" ADD CONSTRAINT "idea_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_notes" ADD CONSTRAINT "idea_notes_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_notes" ADD CONSTRAINT "idea_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_steps" ADD CONSTRAINT "idea_steps_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_steps" ADD CONSTRAINT "idea_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idea_files_idea_idx" ON "idea_files" USING btree ("idea_id","created_at");--> statement-breakpoint
CREATE INDEX "idea_files_user_idx" ON "idea_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idea_notes_idea_idx" ON "idea_notes" USING btree ("idea_id","created_at");--> statement-breakpoint
CREATE INDEX "idea_steps_idea_idx" ON "idea_steps" USING btree ("idea_id","position");--> statement-breakpoint
ALTER TABLE "audio_clips" ADD CONSTRAINT "audio_clips_note_id_idea_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."idea_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_clips_note_idx" ON "audio_clips" USING btree ("note_id");