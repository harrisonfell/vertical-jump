/**
 * Migration 5: the climbing owner.
 *
 * The owner's athlete spec (advanced speed climber, A2 pulley history, wall
 * work two evenings a week) adds answers the athlete gives once and rows the
 * app writes daily. The answers go on the athlete as columns, so a screen can
 * read one without parsing the inventory blob; the daily rows get their own
 * tables, because they are a stream and a stream is never a column.
 *
 * Three house rules land here:
 *   `house.sc.readiness_gate`    readiness_test_session and readiness_outcome
 *   `house.sc.asymmetry_tracking` jump_rep.side, with jump_test_session.mode
 *                                 already carrying 'single_leg'
 *   `house.sc.finger_pain_ceiling` session_answer, the 0 to 10 finger answer
 *
 * Every ALTER is bare, exactly as migration 4's is: the version table gates
 * the whole file and each migration runs inside one transaction, so a run that
 * fails halfway leaves the schema where it was rather than half moved.
 */
export const MIGRATION_0005 = `
ALTER TABLE athlete ADD COLUMN secondary_goal TEXT;
ALTER TABLE athlete ADD COLUMN finger_history INTEGER NOT NULL DEFAULT 0;
ALTER TABLE athlete ADD COLUMN grip_mode TEXT;
ALTER TABLE athlete ADD COLUMN finger_pain_ceiling INTEGER;
ALTER TABLE athlete ADD COLUMN wall_work_json TEXT;
ALTER TABLE athlete ADD COLUMN session_window_json TEXT;
ALTER TABLE athlete ADD COLUMN valgus_control_json TEXT;
ALTER TABLE athlete ADD COLUMN weaker_side TEXT;
ALTER TABLE athlete ADD COLUMN readiness_config_json TEXT;

ALTER TABLE jump_rep ADD COLUMN side TEXT;
CREATE INDEX IF NOT EXISTS jump_rep_side ON jump_rep (jump_test_session_id, side);

CREATE TABLE IF NOT EXISTS readiness_test_session (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  local_date                TEXT NOT NULL,
  kind                      TEXT NOT NULL,
  metric                    TEXT NOT NULL,
  attempts_json             TEXT NOT NULL,
  best                      REAL,
  unit                      TEXT NOT NULL,
  whoop_recovery_snapshot   TEXT,
  entry_source              TEXT NOT NULL DEFAULT 'typed',
  created_at                TEXT NOT NULL
);
-- One test a day per kind, which is also the stream's read order: the gate
-- scores the day's best against the median of the days before it, so a second
-- row for one day would weigh that day twice.
CREATE UNIQUE INDEX IF NOT EXISTS readiness_test_day
  ON readiness_test_session (athlete_id, kind, local_date);

CREATE TABLE IF NOT EXISTS readiness_outcome (
  session_id                TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  local_date                TEXT NOT NULL,
  state                     TEXT NOT NULL,
  channels_json             TEXT NOT NULL,
  adjustment_json           TEXT NOT NULL,
  line                      TEXT NOT NULL,
  house_rule_id             TEXT,
  applied_at                TEXT
);
CREATE INDEX IF NOT EXISTS readiness_outcome_day ON readiness_outcome (local_date);

CREATE TABLE IF NOT EXISTS session_answer (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  session_id                TEXT,
  local_date                TEXT NOT NULL,
  kind                      TEXT NOT NULL,
  value                     INTEGER,
  note                      TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS session_answer_day
  ON session_answer (athlete_id, local_date, kind);
`;
