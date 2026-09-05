CREATE TABLE "device_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"paired_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"file_hash" text NOT NULL,
	"file_name" text,
	"type" text NOT NULL,
	"exporter_version" text,
	"schema_version" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"counts" jsonb,
	"status" text DEFAULT 'preview' NOT NULL,
	"created_at" text NOT NULL,
	"committed_at" text,
	"is_web" boolean DEFAULT false NOT NULL,
	CONSTRAINT "import_batch_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pair_code" (
	"code" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_device_id" text
);
--> statement-breakpoint
CREATE TABLE "sync_op" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_id" text,
	"payload" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"origin" text NOT NULL,
	"device_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "session_workout_link" (
	"session_id" text PRIMARY KEY NOT NULL,
	"whoop_workout_id" text NOT NULL,
	"match_source" text NOT NULL,
	"overlap_s" integer DEFAULT 0 NOT NULL,
	"linked_at" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"trace_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entity_id" text,
	"whoop_user_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "whoop_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"whoop_user_id" text,
	"access_token_cipher" text,
	"refresh_token_cipher" text,
	"expires_at" timestamp with time zone,
	"scopes" text,
	"connected_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"backfill_cursor" text,
	"backfill_days_done" integer DEFAULT 0 NOT NULL,
	"backfill_days_total" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"row_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_cycle" (
	"id" text PRIMARY KEY NOT NULL,
	"score_state" text NOT NULL,
	"start_at" text NOT NULL,
	"end_at" text,
	"timezone_offset" text,
	"local_date" text NOT NULL,
	"strain" real,
	"average_heart_rate" integer,
	"kilojoule" real,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_mirror_deletion" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "whoop_mirror_deletion_kind_id_pk" PRIMARY KEY("kind","id")
);
--> statement-breakpoint
CREATE TABLE "whoop_oauth_state" (
	"state" text PRIMARY KEY NOT NULL,
	"principal" text NOT NULL,
	"device_id" text,
	"redirect" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whoop_recovery" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text,
	"sleep_id" text,
	"score_state" text NOT NULL,
	"user_calibrating" boolean DEFAULT false NOT NULL,
	"recovery_score" integer,
	"resting_heart_rate" double precision,
	"hrv_rmssd_milli" double precision,
	"spo2_percentage" double precision,
	"skin_temp_celsius" double precision,
	"timezone_offset" text,
	"local_date" text NOT NULL,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_sleep" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text,
	"score_state" text NOT NULL,
	"nap" boolean DEFAULT false NOT NULL,
	"start_at" text NOT NULL,
	"end_at" text,
	"timezone_offset" text,
	"local_date" text NOT NULL,
	"sleep_performance_percentage" double precision,
	"sleep_efficiency_percentage" double precision,
	"respiratory_rate" double precision,
	"total_in_bed_time_milli" integer,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whoop_workout" (
	"id" text PRIMARY KEY NOT NULL,
	"score_state" text NOT NULL,
	"sport_name" text,
	"start_at" text NOT NULL,
	"end_at" text,
	"timezone_offset" text,
	"local_date" text NOT NULL,
	"strain" real,
	"average_heart_rate" integer,
	"max_heart_rate" integer,
	"percent_recorded" double precision,
	"zone_durations" jsonb,
	"raw" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete" (
	"id" text PRIMARY KEY NOT NULL,
	"primary_goal" text,
	"sport" text,
	"training_age_years" real,
	"level" text,
	"days_per_week" integer,
	"weekdays" jsonb,
	"is_adult" boolean DEFAULT true NOT NULL,
	"clearance" jsonb,
	"inventory" jsonb,
	"weight_room_access" boolean DEFAULT false NOT NULL,
	"bodyweight_kg" real,
	"working_max" jsonb,
	"in_season" boolean DEFAULT false NOT NULL,
	"readiness_passed_at" text,
	"standing_reach_mm" integer,
	"goal_height_mm" integer,
	"target_date" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rollover_hour" integer DEFAULT 0 NOT NULL,
	"test_conditions_note" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"server_updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"type" text NOT NULL,
	"order_index" integer NOT NULL,
	"week_start" integer NOT NULL,
	"week_end" integer NOT NULL,
	CONSTRAINT "block_order_unique" UNIQUE("program_id","order_index")
);
--> statement-breakpoint
CREATE TABLE "jump_rep" (
	"id" text PRIMARY KEY NOT NULL,
	"jump_test_session_id" text NOT NULL,
	"attempt_index" integer NOT NULL,
	"height_mm" integer,
	"gct_ms" integer,
	"rsi_calc" real,
	"rsi_device" real,
	"flagged" boolean DEFAULT false NOT NULL,
	"reject_reason" text,
	"entry_source" text DEFAULT 'typed' NOT NULL,
	"import_batch_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "jump_rep_attempt" UNIQUE("jump_test_session_id","attempt_index")
);
--> statement-breakpoint
CREATE TABLE "jump_test_session" (
	"id" text PRIMARY KEY NOT NULL,
	"athlete_id" text NOT NULL,
	"session_id" text,
	"local_date" text NOT NULL,
	"performed_at" text NOT NULL,
	"instrument" text NOT NULL,
	"mode" text DEFAULT 'cmj' NOT NULL,
	"unit_preference" text DEFAULT 'in' NOT NULL,
	"box_height_mm" integer,
	"device_firmware" text,
	"connect_version" text,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"scheduled" boolean DEFAULT true NOT NULL,
	"bodyweight_kg" real,
	"whoop_snapshot" jsonb,
	"notes" text,
	"import_batch_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "pain_status" (
	"id" text PRIMARY KEY NOT NULL,
	"athlete_id" text NOT NULL,
	"location" text NOT NULL,
	"severity_raw" integer NOT NULL,
	"severity_derived" text NOT NULL,
	"onset" text NOT NULL,
	"duration_weeks" real,
	"house_rule" boolean DEFAULT false NOT NULL,
	"note" text,
	"reported_at" text NOT NULL,
	"reassess_due_at" text,
	"cleared_at" text
);
--> statement-breakpoint
CREATE TABLE "program" (
	"id" text PRIMARY KEY NOT NULL,
	"athlete_id" text NOT NULL,
	"macro_index" integer DEFAULT 1 NOT NULL,
	"parent_program_id" text,
	"ruleset_version" text NOT NULL,
	"seed" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"validation_report" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_version" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"version" integer NOT NULL,
	"week_layout" jsonb NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	CONSTRAINT "program_version_unique" UNIQUE("program_id","version")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"week_id" text NOT NULL,
	"scheduled_date" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"day_type" text NOT NULL,
	"blocks_present" jsonb,
	"prescribed_set_count" integer DEFAULT 0 NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"test_status" text,
	"soreness_pre" integer,
	"rpe" real,
	"legs_feel" text,
	"notes" text,
	"is_maximal_cns" boolean DEFAULT false NOT NULL,
	"trimmed_exercises" jsonb,
	"applied_modifications" jsonb,
	"shadow_modifications" jsonb,
	"snapshot" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_event" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_exercise" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"exercise_name" text NOT NULL,
	"block" text,
	"load_type" text NOT NULL,
	"load_mode" text DEFAULT 'entered' NOT NULL,
	"both_sides" boolean DEFAULT false NOT NULL,
	"rotation_note" text,
	"header_note" text,
	"last_time_note" text,
	"is_new_this_week" boolean DEFAULT false NOT NULL,
	"rest_s" integer,
	"rest_rule" text,
	"per_set" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_log" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"session_exercise_id" text NOT NULL,
	"set_number" integer NOT NULL,
	"reps_done" integer,
	"load_kg" real,
	"duration_s" real,
	"distance_m" real,
	"box_height_mm" integer,
	"landing" text,
	"rpe" real,
	"mean_velocity_best" real,
	"mean_velocity_last" real,
	"velocity_loss_pct" real,
	"load_source" text,
	"entry_source" text DEFAULT 'typed' NOT NULL,
	"completed_at" text NOT NULL,
	"planned_date" text,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"edited_at" text,
	"created_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "set_log_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "set_log_by_set" UNIQUE("session_exercise_id","set_number")
);
--> statement-breakpoint
CREATE TABLE "week" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"program_version_id" text,
	"block_id" text,
	"w" integer NOT NULL,
	"window_start" text NOT NULL,
	"window_end" text NOT NULL,
	"kind" text NOT NULL,
	"k" integer,
	"prescribed_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"adherence_pct" real,
	"all_reps_completed" boolean,
	"outcome" text,
	"generated_at" text,
	"generated_by" text,
	"repeat_of_week" integer,
	"joint_high_stress_counts" jsonb,
	"high_contact_allowance" integer,
	"extensive_target" integer,
	"ladder_rungs" jsonb,
	"snapshot" jsonb,
	CONSTRAINT "week_unique" UNIQUE("program_id","w")
);
--> statement-breakpoint
CREATE INDEX "device_secret_live" ON "device_secret" USING btree ("revoked_at","paired_at");--> statement-breakpoint
CREATE INDEX "sync_op_feed" ON "sync_op" USING btree ("received_at","id");--> statement-breakpoint
CREATE INDEX "sync_op_entity" ON "sync_op" USING btree ("kind","entity_id");--> statement-breakpoint
CREATE INDEX "session_workout_link_workout" ON "session_workout_link" USING btree ("whoop_workout_id");--> statement-breakpoint
CREATE INDEX "webhook_event_received" ON "webhook_event" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "whoop_cycle_day" ON "whoop_cycle" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "whoop_cycle_feed" ON "whoop_cycle" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "whoop_mirror_deletion_feed" ON "whoop_mirror_deletion" USING btree ("deleted_at","id");--> statement-breakpoint
CREATE INDEX "whoop_recovery_day" ON "whoop_recovery" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "whoop_recovery_sleep" ON "whoop_recovery" USING btree ("sleep_id");--> statement-breakpoint
CREATE INDEX "whoop_recovery_feed" ON "whoop_recovery" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "whoop_sleep_day" ON "whoop_sleep" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "whoop_sleep_feed" ON "whoop_sleep" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "whoop_workout_window" ON "whoop_workout" USING btree ("start_at");--> statement-breakpoint
CREATE INDEX "whoop_workout_feed" ON "whoop_workout" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "jump_test_stream" ON "jump_test_session" USING btree ("instrument","mode","canonical","local_date");--> statement-breakpoint
CREATE INDEX "pain_status_open" ON "pain_status" USING btree ("athlete_id","cleared_at","reported_at");--> statement-breakpoint
CREATE INDEX "program_current" ON "program" USING btree ("athlete_id","status","start_date");--> statement-breakpoint
CREATE INDEX "session_by_week" ON "session" USING btree ("week_id","order_index");--> statement-breakpoint
CREATE INDEX "session_by_date" ON "session" USING btree ("program_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "session_event_by_session" ON "session_event" USING btree ("session_id","at");--> statement-breakpoint
CREATE INDEX "session_exercise_order" ON "session_exercise" USING btree ("session_id","order_index");--> statement-breakpoint
CREATE INDEX "set_log_by_session" ON "set_log" USING btree ("session_id","completed_at");--> statement-breakpoint
CREATE INDEX "week_window" ON "week" USING btree ("program_id","window_start");