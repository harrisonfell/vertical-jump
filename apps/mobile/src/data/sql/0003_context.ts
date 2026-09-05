/**
 * Migration 3: Whoop mirrors, autoregulation, the sync queue, and key/value.
 *
 * Whoop rows are mirrors, not interpretations: the raw JSON is kept verbatim
 * beside the fields we read, every row carries its own score_state (a score is
 * absent unless SCORED), and the local date comes from the record's own
 * timezone offset because Whoop counts physiological cycles, not calendar days.
 */
export const MIGRATION_0003 = `
CREATE TABLE IF NOT EXISTS whoop_connection (
  id                        TEXT PRIMARY KEY,
  status                    TEXT NOT NULL DEFAULT 'disconnected',
  whoop_user_id             TEXT,
  scopes                    TEXT,
  connected_at              TEXT,
  revoked_at                TEXT,
  last_sync_at              TEXT,
  backfill_cursor           TEXT,
  backfill_days_done        INTEGER NOT NULL DEFAULT 0,
  backfill_days_total       INTEGER NOT NULL DEFAULT 0,
  last_error                TEXT,
  next_retry_at             TEXT,
  updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS whoop_cycle (
  id                        TEXT PRIMARY KEY,
  score_state               TEXT NOT NULL,
  start_at                  TEXT NOT NULL,
  end_at                    TEXT,
  timezone_offset           TEXT,
  local_date                TEXT NOT NULL,
  strain                    REAL,
  average_heart_rate        INTEGER,
  kilojoule                 REAL,
  raw                       TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whoop_cycle_day ON whoop_cycle (local_date);

CREATE TABLE IF NOT EXISTS whoop_recovery (
  id                        TEXT PRIMARY KEY,
  cycle_id                  TEXT,
  sleep_id                  TEXT,
  score_state               TEXT NOT NULL,
  user_calibrating          INTEGER NOT NULL DEFAULT 0,
  recovery_score            INTEGER,
  resting_heart_rate        REAL,
  hrv_rmssd_milli           REAL,
  spo2_percentage           REAL,
  skin_temp_celsius         REAL,
  timezone_offset           TEXT,
  local_date                TEXT NOT NULL,
  raw                       TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whoop_recovery_day ON whoop_recovery (local_date);

CREATE TABLE IF NOT EXISTS whoop_sleep (
  id                        TEXT PRIMARY KEY,
  cycle_id                  TEXT,
  score_state               TEXT NOT NULL,
  nap                       INTEGER NOT NULL DEFAULT 0,
  start_at                  TEXT NOT NULL,
  end_at                    TEXT,
  timezone_offset           TEXT,
  local_date                TEXT NOT NULL,
  sleep_performance_percentage REAL,
  sleep_efficiency_percentage  REAL,
  respiratory_rate          REAL,
  total_in_bed_time_milli   INTEGER,
  raw                       TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whoop_sleep_day ON whoop_sleep (local_date);

CREATE TABLE IF NOT EXISTS whoop_workout (
  id                        TEXT PRIMARY KEY,
  score_state               TEXT NOT NULL,
  sport_name                TEXT,
  start_at                  TEXT NOT NULL,
  end_at                    TEXT,
  timezone_offset           TEXT,
  local_date                TEXT NOT NULL,
  strain                    REAL,
  average_heart_rate        INTEGER,
  max_heart_rate            INTEGER,
  percent_recorded          REAL,
  zone_durations            TEXT,
  raw                       TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whoop_workout_window ON whoop_workout (start_at);

CREATE TABLE IF NOT EXISTS session_workout_link (
  session_id                TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  whoop_workout_id          TEXT NOT NULL,
  match_source              TEXT NOT NULL,
  overlap_s                 INTEGER NOT NULL DEFAULT 0,
  linked_at                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_workout_link_workout
  ON session_workout_link (whoop_workout_id);

CREATE TABLE IF NOT EXISTS webhook_event (
  trace_id                  TEXT PRIMARY KEY,
  type                      TEXT NOT NULL,
  entity_id                 TEXT,
  received_at               TEXT NOT NULL,
  processed_at              TEXT
);

CREATE TABLE IF NOT EXISTS athlete_baseline (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  computed_for              TEXT NOT NULL,
  scored_days               INTEGER NOT NULL DEFAULT 0,
  log_hrv_mean              REAL,
  log_hrv_sd                REAL,
  recovery_p33              REAL,
  recovery_p66              REAL,
  rhr_mean                  REAL,
  computed_at               TEXT NOT NULL,
  UNIQUE (athlete_id, computed_for)
);

CREATE TABLE IF NOT EXISTS readiness_signal (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  local_date                TEXT NOT NULL,
  source                    TEXT NOT NULL,
  band                      TEXT,
  modifier                  TEXT NOT NULL,
  accepted                  INTEGER,
  reason                    TEXT,
  created_at                TEXT NOT NULL,
  UNIQUE (athlete_id, local_date, source)
);
CREATE INDEX IF NOT EXISTS readiness_signal_day ON readiness_signal (athlete_id, local_date);

CREATE TABLE IF NOT EXISTS autoregulation_status (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  enabled                   INTEGER NOT NULL DEFAULT 0,
  paused_reason             TEXT,
  criteria                  TEXT NOT NULL,
  gate_met                  INTEGER NOT NULL DEFAULT 0,
  evaluated_at              TEXT NOT NULL,
  UNIQUE (athlete_id)
);

CREATE TABLE IF NOT EXISTS device_secret (
  id                        TEXT PRIMARY KEY,
  secret_hash               TEXT,
  paired_at                 TEXT,
  failure_count             INTEGER NOT NULL DEFAULT 0,
  locked_until              TEXT,
  updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  op                        TEXT NOT NULL,
  entity_id                 TEXT,
  payload                   TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  attempts                  INTEGER NOT NULL DEFAULT 0,
  last_attempt_at           TEXT,
  last_error                TEXT,
  synced_at                 TEXT
);
CREATE INDEX IF NOT EXISTS sync_queue_pending ON sync_queue (synced_at, created_at, id);

CREATE TABLE IF NOT EXISTS kv (
  key                       TEXT PRIMARY KEY,
  value                     TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
`;
