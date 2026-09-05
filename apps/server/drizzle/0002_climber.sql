CREATE TABLE "readiness_outcome" (
	"session_id" text PRIMARY KEY NOT NULL,
	"local_date" text NOT NULL,
	"state" text NOT NULL,
	"channels_json" jsonb,
	"adjustment_json" jsonb,
	"line" text,
	"house_rule_id" text,
	"applied_at" text
);
--> statement-breakpoint
CREATE TABLE "readiness_test_session" (
	"id" text PRIMARY KEY NOT NULL,
	"athlete_id" text NOT NULL,
	"local_date" text NOT NULL,
	"kind" text NOT NULL,
	"metric" text,
	"attempts_json" jsonb,
	"best" real,
	"unit" text,
	"whoop_recovery_snapshot" jsonb,
	"entry_source" text DEFAULT 'typed' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "secondary_goal" text;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "finger_history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "grip_mode" text;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "finger_pain_ceiling" integer;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "wall_work_json" jsonb;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "session_window_json" jsonb;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "valgus_control_json" jsonb;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "weaker_side" text;--> statement-breakpoint
ALTER TABLE "athlete" ADD COLUMN "readiness_config_json" jsonb;--> statement-breakpoint
ALTER TABLE "jump_rep" ADD COLUMN "side" text;--> statement-breakpoint
CREATE INDEX "readiness_outcome_day" ON "readiness_outcome" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "readiness_test_stream" ON "readiness_test_session" USING btree ("athlete_id","kind","local_date");