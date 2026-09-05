import type { SqlExecutor } from '../executor';
import type {
  AthleteBaseline,
  AutoregulationStatus,
  Json,
  LocalDate,
  ReadinessSignal,
} from '../types';
import { ATHLETE_ID } from './athlete';
import { bool, boolOrNull, fromJson, intBool, newId, nowIso, oneOf, oneOfOrNull, toJsonRequired } from './rows';

/**
 * The shadow autoregulation record: a 28-day baseline, one modifier per day
 * from each source, and the gate with its live numbers. Rule-book adjustments
 * are logged separately from shadow ones so the comparison stays clean.
 */

const BANDS = ['green', 'yellow', 'red'] as const;
const SOURCES = ['rulebook', 'shadow'] as const;

interface BaselineRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly computed_for: string;
  readonly scored_days: number;
  readonly log_hrv_mean: number | null;
  readonly log_hrv_sd: number | null;
  readonly recovery_p33: number | null;
  readonly recovery_p66: number | null;
  readonly rhr_mean: number | null;
  readonly computed_at: string;
}

interface SignalRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly local_date: string;
  readonly source: string;
  readonly band: string | null;
  readonly modifier: string;
  readonly accepted: number | null;
  readonly reason: string | null;
  readonly created_at: string;
}

interface StatusRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly enabled: number;
  readonly paused_reason: string | null;
  readonly criteria: string;
  readonly gate_met: number;
  readonly evaluated_at: string;
}

function mapBaseline(row: BaselineRow): AthleteBaseline {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    computedFor: row.computed_for,
    scoredDays: row.scored_days,
    logHrvMean: row.log_hrv_mean,
    logHrvSd: row.log_hrv_sd,
    recoveryP33: row.recovery_p33,
    recoveryP66: row.recovery_p66,
    rhrMean: row.rhr_mean,
    computedAt: row.computed_at,
  };
}

function mapSignal(row: SignalRow): ReadinessSignal {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    localDate: row.local_date,
    source: oneOf(row.source, SOURCES, 'shadow'),
    band: oneOfOrNull(row.band, BANDS),
    modifier: fromJson(row.modifier),
    accepted: boolOrNull(row.accepted),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapStatus(row: StatusRow): AutoregulationStatus {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    enabled: bool(row.enabled),
    pausedReason: row.paused_reason,
    criteria: fromJson(row.criteria),
    gateMet: bool(row.gate_met),
    evaluatedAt: row.evaluated_at,
  };
}

/* -------------------------------------------------------------- baseline */

export interface BaselineInput {
  readonly computedFor: LocalDate;
  readonly scoredDays: number;
  readonly logHrvMean?: number | null;
  readonly logHrvSd?: number | null;
  readonly recoveryP33?: number | null;
  readonly recoveryP66?: number | null;
  readonly rhrMean?: number | null;
}

export async function upsertBaseline(db: SqlExecutor, input: BaselineInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO athlete_baseline
       (id, athlete_id, computed_for, scored_days, log_hrv_mean, log_hrv_sd,
        recovery_p33, recovery_p66, rhr_mean, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(athlete_id, computed_for) DO UPDATE SET
       scored_days = excluded.scored_days,
       log_hrv_mean = excluded.log_hrv_mean,
       log_hrv_sd = excluded.log_hrv_sd,
       recovery_p33 = excluded.recovery_p33,
       recovery_p66 = excluded.recovery_p66,
       rhr_mean = excluded.rhr_mean,
       computed_at = excluded.computed_at`,
    [
      newId('base'),
      ATHLETE_ID,
      input.computedFor,
      input.scoredDays,
      input.logHrvMean ?? null,
      input.logHrvSd ?? null,
      input.recoveryP33 ?? null,
      input.recoveryP66 ?? null,
      input.rhrMean ?? null,
      nowIso(),
    ],
  );
}

export async function getLatestBaseline(db: SqlExecutor): Promise<AthleteBaseline | null> {
  const row = await db.getFirstAsync<BaselineRow>(
    'SELECT * FROM athlete_baseline WHERE athlete_id = ? ORDER BY computed_for DESC LIMIT 1',
    [ATHLETE_ID],
  );
  return row === null ? null : mapBaseline(row);
}

/* --------------------------------------------------------------- signals */

export interface ReadinessSignalInput {
  readonly localDate: LocalDate;
  readonly source: 'rulebook' | 'shadow';
  readonly band?: 'green' | 'yellow' | 'red' | null;
  readonly modifier: Json;
  readonly accepted?: boolean | null;
  readonly reason?: string | null;
}

export async function recordSignal(db: SqlExecutor, input: ReadinessSignalInput): Promise<void> {
  await db.runAsync(
    `INSERT INTO readiness_signal
       (id, athlete_id, local_date, source, band, modifier, accepted, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(athlete_id, local_date, source) DO UPDATE SET
       band = excluded.band, modifier = excluded.modifier,
       accepted = excluded.accepted, reason = excluded.reason, created_at = excluded.created_at`,
    [
      newId('sig'),
      ATHLETE_ID,
      input.localDate,
      input.source,
      input.band ?? null,
      toJsonRequired(input.modifier),
      intBool(input.accepted),
      input.reason ?? null,
      nowIso(),
    ],
  );
}

export async function listSignals(
  db: SqlExecutor,
  from: LocalDate,
  to: LocalDate,
): Promise<ReadinessSignal[]> {
  const rows = await db.getAllAsync<SignalRow>(
    `SELECT * FROM readiness_signal
     WHERE athlete_id = ? AND local_date >= ? AND local_date <= ?
     ORDER BY local_date, source`,
    [ATHLETE_ID, from, to],
  );
  return rows.map(mapSignal);
}

export async function getSignalForDay(
  db: SqlExecutor,
  day: LocalDate,
  source: 'rulebook' | 'shadow',
): Promise<ReadinessSignal | null> {
  const row = await db.getFirstAsync<SignalRow>(
    'SELECT * FROM readiness_signal WHERE athlete_id = ? AND local_date = ? AND source = ?',
    [ATHLETE_ID, day, source],
  );
  return row === null ? null : mapSignal(row);
}

/* ---------------------------------------------------------------- status */

export interface AutoregulationPatch {
  readonly enabled?: boolean;
  readonly pausedReason?: string | null;
  readonly criteria?: Json;
  readonly gateMet?: boolean;
}

export async function getAutoregulationStatus(db: SqlExecutor): Promise<AutoregulationStatus> {
  const row = await db.getFirstAsync<StatusRow>(
    'SELECT * FROM autoregulation_status WHERE athlete_id = ?',
    [ATHLETE_ID],
  );
  if (row !== null) return mapStatus(row);
  return {
    id: 'autoreg_owner',
    athleteId: ATHLETE_ID,
    enabled: false,
    pausedReason: null,
    criteria: null,
    gateMet: false,
    evaluatedAt: nowIso(),
  };
}

export async function setAutoregulationStatus(
  db: SqlExecutor,
  patch: AutoregulationPatch,
): Promise<AutoregulationStatus> {
  const current = await getAutoregulationStatus(db);
  const next = { ...current, ...patch };
  await db.runAsync(
    `INSERT INTO autoregulation_status
       (id, athlete_id, enabled, paused_reason, criteria, gate_met, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(athlete_id) DO UPDATE SET
       enabled = excluded.enabled, paused_reason = excluded.paused_reason,
       criteria = excluded.criteria, gate_met = excluded.gate_met,
       evaluated_at = excluded.evaluated_at`,
    [
      next.id,
      ATHLETE_ID,
      intBool(next.enabled),
      next.pausedReason,
      toJsonRequired(next.criteria),
      intBool(next.gateMet),
      nowIso(),
    ],
  );
  return getAutoregulationStatus(db);
}
