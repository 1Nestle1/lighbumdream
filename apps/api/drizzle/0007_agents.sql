CREATE TABLE "agent_runners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'unknown' NOT NULL,
	"agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runners_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idea_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idea_id" uuid NOT NULL,
	"target" text NOT NULL,
	"runner_id" uuid,
	"agent" text NOT NULL,
	"status" text NOT NULL,
	"options" jsonb,
	"choice" jsonb,
	"plan" jsonb,
	"plan_version" integer DEFAULT 0 NOT NULL,
	"revision" text,
	"result" jsonb,
	"error" jsonb,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cloud_session_id" text,
	"approved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runner_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"user_id" uuid,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_pairings_device_code_hash_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "runner_pairings_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
ALTER TABLE "agent_runners" ADD CONSTRAINT "agent_runners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idea_runs" ADD CONSTRAINT "idea_runs_runner_id_agent_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."agent_runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_idea_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."idea_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_pairings" ADD CONSTRAINT "runner_pairings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runners_user_idx" ON "agent_runners" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idea_runs_idea_idx" ON "idea_runs" USING btree ("idea_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idea_runs_queue_idx" ON "idea_runs" USING btree ("status","target","runner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idea_runs_active_uq" ON "idea_runs" USING btree ("idea_id") WHERE status in ('options_pending', 'options_ready', 'plan_pending', 'plan_ready', 'building');--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_user_idx" ON "run_events" USING btree ("user_id","kind","created_at");