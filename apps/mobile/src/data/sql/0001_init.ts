/**
 * Migration 1: the athlete, the program, and the session runner.
 *
 * Column names follow brief section 12 verbatim. Anything the engine owns
 * (plan skeletons, week plans, per-set prescriptions, snapshots) is stored as
 * JSON text so the schema never has to move when the engine's internals do.
 * Timestamps are ISO 8601 strings; local dates are "YYYY-MM-DD" from
 * src/lib/localDay.ts. Booleans are 0/1 integers.
 */
export const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS athlete (
  id                        TEXT PRIMARY KEY,
  primary_goal              TEXT,
  sport                     TEXT,
  training_age_years        REAL,
  level                     TEXT,
  days_per_week             INTEGER,
  weekdays                  TEXT,
  is_adult                  INTEGER NOT NULL DEFAULT 1,
  clearance                 TEXT,
  inventory                 TEXT,
  weight_room_access        INTEGER NOT NULL DEFAULT 0,
  bodyweight_kg             REAL,
  working_max               TEXT,
  in_season                 INTEGER NOT NULL DEFAULT 0,
  readiness_passed_at       TEXT,
  standing_reach_mm         INTEGER,
  goal_height_mm            INTEGER,
  target_date               TEXT,
  timezone                  TEXT NOT NULL DEFAULT 'UTC',
  rollover_hour             INTEGER NOT NULL DEFAULT 0,
  test_conditions_note      TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pain_status (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  location                  TEXT NOT NULL,
  severity_raw              INTEGER NOT NULL,
  severity_derived          TEXT NOT NULL,
  onset                     TEXT NOT NULL,
  duration_weeks            REAL,
  house_rule                INTEGER NOT NULL DEFAULT 0,
  note                      TEXT,
  reported_at               TEXT NOT NULL,
  reassess_due_at           TEXT,
  cleared_at                TEXT
);
CREATE INDEX IF NOT EXISTS pain_status_open
  ON pain_status (athlete_id, cleared_at, reported_at DESC);

CREATE TABLE IF NOT EXISTS exercise (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  load_type                 TEXT NOT NULL,
  loadable                  INTEGER NOT NULL DEFAULT 0,
  display_mode              TEXT,
  is_main_lift              INTEGER NOT NULL DEFAULT 0,
  rotation_group            TEXT,
  ladder_id                 TEXT,
  ladder_rank               INTEGER,
  level_min                 TEXT,
  tags                      TEXT NOT NULL,
  seed_version              TEXT,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exercise_ladder ON exercise (ladder_id, ladder_rank);

CREATE TABLE IF NOT EXISTS program (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  macro_index               INTEGER NOT NULL DEFAULT 1,
  parent_program_id         TEXT,
  ruleset_version           TEXT NOT NULL,
  seed                      TEXT NOT NULL,
  start_date                TEXT NOT NULL,
  end_date                  TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'active',
  snapshot                  TEXT NOT NULL,
  validation_report         TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS program_current ON program (athlete_id, status, start_date DESC);

CREATE TABLE IF NOT EXISTS program_version (
  id                        TEXT PRIMARY KEY,
  program_id                TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  version                   INTEGER NOT NULL,
  week_layout               TEXT NOT NULL,
  reason                    TEXT,
  created_at                TEXT NOT NULL,
  UNIQUE (program_id, version)
);

CREATE TABLE IF NOT EXISTS block (
  id                        TEXT PRIMARY KEY,
  program_id                TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  type                      TEXT NOT NULL,
  order_index               INTEGER NOT NULL,
  week_start                INTEGER NOT NULL,
  week_end                  INTEGER NOT NULL,
  UNIQUE (program_id, order_index)
);

CREATE TABLE IF NOT EXISTS week (
  id                        TEXT PRIMARY KEY,
  program_id                TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  program_version_id        TEXT,
  block_id                  TEXT,
  w                         INTEGER NOT NULL,
  window_start              TEXT NOT NULL,
  window_end                TEXT NOT NULL,
  kind                      TEXT NOT NULL,
  k                         INTEGER,
  prescribed_count          INTEGER NOT NULL DEFAULT 0,
  completed_count           INTEGER NOT NULL DEFAULT 0,
  adherence_pct             REAL,
  all_reps_completed        INTEGER,
  outcome                   TEXT,
  generated_at              TEXT,
  generated_by              TEXT,
  repeat_of_week            INTEGER,
  joint_high_stress_counts  TEXT,
  high_contact_allowance    INTEGER,
  extensive_target          INTEGER,
  ladder_rungs              TEXT,
  snapshot                  TEXT,
  UNIQUE (program_id, w)
);
CREATE INDEX IF NOT EXISTS week_window ON week (program_id, window_start);

CREATE TABLE IF NOT EXISTS session (
  id                        TEXT PRIMARY KEY,
  program_id                TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
  week_id                   TEXT NOT NULL REFERENCES week(id) ON DELETE CASCADE,
  scheduled_date            TEXT NOT NULL,
  order_index               INTEGER NOT NULL DEFAULT 0,
  day_type                  TEXT NOT NULL,
  blocks_present            TEXT,
  prescribed_set_count      INTEGER NOT NULL DEFAULT 0,
  dismissed                 INTEGER NOT NULL DEFAULT 0,
  test_status               TEXT,
  soreness_pre              INTEGER,
  rpe                       REAL,
  legs_feel                 TEXT,
  notes                     TEXT,
  is_maximal_cns            INTEGER NOT NULL DEFAULT 0,
  trimmed_exercises         TEXT,
  applied_modifications     TEXT,
  shadow_modifications      TEXT,
  snapshot                  TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_by_week ON session (week_id, order_index);
CREATE INDEX IF NOT EXISTS session_by_date ON session (program_id, scheduled_date);

CREATE TABLE IF NOT EXISTS session_event (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  kind                      TEXT NOT NULL,
  at                        TEXT NOT NULL,
  created_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_event_by_session ON session_event (session_id, at);

CREATE TABLE IF NOT EXISTS session_exercise (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  order_index               INTEGER NOT NULL,
  exercise_id               TEXT NOT NULL,
  exercise_name             TEXT NOT NULL,
  block                     TEXT,
  load_type                 TEXT NOT NULL,
  load_mode                 TEXT NOT NULL DEFAULT 'entered',
  both_sides                INTEGER NOT NULL DEFAULT 0,
  rotation_note             TEXT,
  header_note               TEXT,
  last_time_note            TEXT,
  is_new_this_week          INTEGER NOT NULL DEFAULT 0,
  rest_s                    INTEGER,
  rest_rule                 TEXT,
  per_set                   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_exercise_order ON session_exercise (session_id, order_index);

CREATE TABLE IF NOT EXISTS set_log (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  session_exercise_id       TEXT NOT NULL REFERENCES session_exercise(id) ON DELETE CASCADE,
  set_number                INTEGER NOT NULL,
  reps_done                 INTEGER,
  load_kg                   REAL,
  duration_s                REAL,
  distance_m                REAL,
  box_height_mm             INTEGER,
  landing                   TEXT,
  rpe                       REAL,
  mean_velocity_best        REAL,
  mean_velocity_last        REAL,
  velocity_loss_pct         REAL,
  load_source               TEXT,
  entry_source              TEXT NOT NULL DEFAULT 'typed',
  completed_at              TEXT NOT NULL,
  planned_date              TEXT,
  offset_days               INTEGER NOT NULL DEFAULT 0,
  idempotency_key           TEXT NOT NULL UNIQUE,
  edited_at                 TEXT,
  created_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS set_log_by_session ON set_log (session_id, completed_at);
CREATE UNIQUE INDEX IF NOT EXISTS set_log_by_set
  ON set_log (session_exercise_id, set_number);
`;
