/**
 * Migration 2: the instruments.
 *
 * Jump heights are millimetres and contact times milliseconds, because that is
 * what the OVR Jump reports and the display conversion belongs in the engine's
 * unit formatters. Every jump number carries its instrument: streams never mix,
 * so metric_pr is keyed by (instrument, mode) and is a recomputable cache, not
 * a source of truth.
 */
export const MIGRATION_0002 = `
CREATE TABLE IF NOT EXISTS jump_test_session (
  id                        TEXT PRIMARY KEY,
  athlete_id                TEXT NOT NULL,
  session_id                TEXT,
  local_date                TEXT NOT NULL,
  performed_at              TEXT NOT NULL,
  instrument                TEXT NOT NULL,
  mode                      TEXT NOT NULL DEFAULT 'cmj',
  unit_preference           TEXT NOT NULL DEFAULT 'in',
  box_height_mm             INTEGER,
  device_firmware           TEXT,
  connect_version           TEXT,
  is_baseline               INTEGER NOT NULL DEFAULT 0,
  canonical                 INTEGER NOT NULL DEFAULT 1,
  scheduled                 INTEGER NOT NULL DEFAULT 1,
  bodyweight_kg             REAL,
  whoop_snapshot            TEXT,
  notes                     TEXT,
  import_batch_id           TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jump_test_stream
  ON jump_test_session (instrument, mode, canonical, local_date);

CREATE TABLE IF NOT EXISTS jump_rep (
  id                        TEXT PRIMARY KEY,
  jump_test_session_id      TEXT NOT NULL REFERENCES jump_test_session(id) ON DELETE CASCADE,
  attempt_index             INTEGER NOT NULL,
  height_mm                 INTEGER,
  gct_ms                    INTEGER,
  rsi_calc                  REAL,
  rsi_device                REAL,
  flagged                   INTEGER NOT NULL DEFAULT 0,
  reject_reason             TEXT,
  entry_source              TEXT NOT NULL DEFAULT 'typed',
  import_batch_id           TEXT,
  created_at                TEXT NOT NULL,
  UNIQUE (jump_test_session_id, attempt_index)
);

CREATE TABLE IF NOT EXISTS metric_pr (
  id                        TEXT PRIMARY KEY,
  instrument                TEXT NOT NULL,
  mode                      TEXT NOT NULL,
  value_mm                  INTEGER NOT NULL,
  jump_test_session_id      TEXT NOT NULL,
  local_date                TEXT NOT NULL,
  threshold_used_mm         INTEGER NOT NULL,
  previous_value_mm         INTEGER,
  computed_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS metric_pr_stream ON metric_pr (instrument, mode, local_date);

CREATE TABLE IF NOT EXISTS vbt_set (
  id                        TEXT PRIMARY KEY,
  set_log_id                TEXT REFERENCES set_log(id) ON DELETE CASCADE,
  session_id                TEXT,
  exercise_id               TEXT NOT NULL,
  load_kg                   REAL,
  reps_completed            INTEGER,
  mean_velocity_best        REAL,
  mean_velocity_last        REAL,
  velocity_loss_pct         REAL,
  entry_source              TEXT NOT NULL DEFAULT 'typed',
  import_batch_id           TEXT,
  recorded_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vbt_set_by_exercise ON vbt_set (exercise_id, recorded_at);

CREATE TABLE IF NOT EXISTS vbt_rep (
  id                        TEXT PRIMARY KEY,
  vbt_set_id                TEXT NOT NULL REFERENCES vbt_set(id) ON DELETE CASCADE,
  rep_index                 INTEGER NOT NULL,
  mean_velocity             REAL,
  peak_velocity             REAL,
  rom_mm                    INTEGER,
  power_w                   REAL,
  tpv_ms                    INTEGER,
  eai                       REAL,
  import_batch_id           TEXT,
  UNIQUE (vbt_set_id, rep_index)
);

CREATE TABLE IF NOT EXISTS lvp_profile (
  id                        TEXT PRIMARY KEY,
  exercise_id               TEXT NOT NULL,
  slope                     REAL NOT NULL,
  intercept                 REAL NOT NULL,
  r2                        REAL NOT NULL,
  n                         INTEGER NOT NULL,
  min_velocity_used         REAL,
  estimated_max_kg          REAL,
  computed_at               TEXT NOT NULL,
  UNIQUE (exercise_id, computed_at)
);

CREATE TABLE IF NOT EXISTS import_batch (
  id                        TEXT PRIMARY KEY,
  file_hash                 TEXT NOT NULL UNIQUE,
  file_name                 TEXT,
  type                      TEXT NOT NULL,
  exporter_version          TEXT,
  schema_version            TEXT,
  row_count                 INTEGER NOT NULL DEFAULT 0,
  mapping                   TEXT,
  counts                    TEXT,
  status                    TEXT NOT NULL DEFAULT 'preview',
  created_at                TEXT NOT NULL,
  committed_at              TEXT
);
`;
