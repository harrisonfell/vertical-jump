CREATE SEQUENCE "public"."whoop_feed_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "whoop_start_ticket" (
	"token" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "sync_op_feed";--> statement-breakpoint
DROP INDEX "whoop_cycle_feed";--> statement-breakpoint
DROP INDEX "whoop_mirror_deletion_feed";--> statement-breakpoint
DROP INDEX "whoop_recovery_feed";--> statement-breakpoint
DROP INDEX "whoop_sleep_feed";--> statement-breakpoint
DROP INDEX "whoop_workout_feed";--> statement-breakpoint
ALTER TABLE "sync_op" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_recovery" ALTER COLUMN "user_calibrating" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "whoop_recovery" ALTER COLUMN "user_calibrating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "ruleset_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "program" ALTER COLUMN "snapshot" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "week_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "scheduled_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "day_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week" ALTER COLUMN "program_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week" ALTER COLUMN "w" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week" ALTER COLUMN "window_start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week" ALTER COLUMN "window_end" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "week" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "login_attempt" ADD COLUMN "sessions_valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_op" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_cycle" ADD COLUMN "feed_seq" bigint DEFAULT nextval('whoop_feed_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_mirror_deletion" ADD COLUMN "feed_seq" bigint DEFAULT nextval('whoop_feed_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_recovery" ADD COLUMN "feed_seq" bigint DEFAULT nextval('whoop_feed_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_sleep" ADD COLUMN "feed_seq" bigint DEFAULT nextval('whoop_feed_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "whoop_workout" ADD COLUMN "feed_seq" bigint DEFAULT nextval('whoop_feed_seq') NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_op_feed" ON "sync_op" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "whoop_cycle_feed" ON "whoop_cycle" USING btree ("feed_seq");--> statement-breakpoint
CREATE INDEX "whoop_mirror_deletion_feed" ON "whoop_mirror_deletion" USING btree ("feed_seq");--> statement-breakpoint
CREATE INDEX "whoop_recovery_feed" ON "whoop_recovery" USING btree ("feed_seq");--> statement-breakpoint
CREATE INDEX "whoop_sleep_feed" ON "whoop_sleep" USING btree ("feed_seq");--> statement-breakpoint
CREATE INDEX "whoop_workout_feed" ON "whoop_workout" USING btree ("feed_seq");