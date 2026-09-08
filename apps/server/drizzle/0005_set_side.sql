ALTER TABLE "set_log" DROP CONSTRAINT "set_log_by_set";--> statement-breakpoint
ALTER TABLE "set_log" ADD COLUMN "side" text;--> statement-breakpoint
CREATE UNIQUE INDEX "set_log_by_set" ON "set_log" USING btree ("session_exercise_id","set_number",coalesce("side", 'both'));