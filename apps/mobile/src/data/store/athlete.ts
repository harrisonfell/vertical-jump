import type { SqlExecutor } from '../executor';
import type {
  Athlete,
  DaysPerWeek,
  GripMode,
  Json,
  Level,
  LocalDate,
  PainSeverity,
  PainStatus,
  Side,
  Timestamp,
  WorkingMax,
} from '../types';
import {
  bool,
  fromJson,
  fromJsonArray,
  fromJsonRecord,
  intBool,
  newId,
  nowIso,
  oneOfOrNull,
  toJson,
} from './rows';

/** One athlete, one row. The id never changes so every other table can point at it. */
export const ATHLETE_ID = 'athlete_owner';

const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced'];
const SEVERITIES: readonly PainSeverity[] = ['none', 'mild', 'moderate', 'severe'];
const GRIP_MODES: readonly GripMode[] = ['open_hand', 'half_crimp', 'full_crimp', 'any'];
const SIDES: readonly Side[] = ['left', 'right'];

interface AthleteRow {
  readonly id: string;
  readonly primary_goal: string | null;
  readonly sport: string | null;
  readonly training_age_years: number | null;
  readonly level: string | null;
  readonly days_per_week: number | null;
  readonly weekdays: string | null;
  readonly is_adult: number;
  readonly clearance: string | null;
  readonly inventory: string | null;
  readonly weight_room_access: number;
  readonly bodyweight_kg: number | null;
  readonly working_max: string | null;
  readonly in_season: number;
  readonly readiness_passed_at: string | null;
  readonly standing_reach_mm: number | null;
  readonly goal_height_mm: number | null;
  readonly target_date: string | null;
  readonly timezone: string;
  readonly rollover_hour: number;
  readonly test_conditions_note: string | null;
  readonly secondary_goal: string | null;
  readonly finger_history: number | null;
  readonly grip_mode: string | null;
  readonly finger_pain_ceiling: number | null;
  readonly wall_work_json: string | null;
  readonly session_window_json: string | null;
  readonly valgus_control_json: string | null;
  readonly weaker_side: string | null;
  readonly readiness_config_json: string | null;
  readonly best_sets_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface PainRow {
  readonly id: string;
  readonly athlete_id: string;
  readonly location: string;
  readonly severity_raw: number;
  readonly severity_derived: string;
  readonly onset: string;
  readonly duration_weeks: number | null;
  readonly house_rule: number;
  readonly note: string | null;
  readonly reported_at: string;
  readonly reassess_due_at: string | null;
  readonly cleared_at: string | null;
}

function toDaysPerWeek(value: number | null): DaysPerWeek | null {
  return value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
}

function mapAthlete(row: AthleteRow): Athlete {
  return {
    id: row.id,
    primaryGoal: row.primary_goal,
    sport: row.sport,
    trainingAgeYears: row.training_age_years,
    level: oneOfOrNull(row.level, LEVELS),
    daysPerWeek: toDaysPerWeek(row.days_per_week),
    weekdays: fromJsonArray<number>(row.weekdays),
    isAdult: bool(row.is_adult),
    clearance: fromJson(row.clearance),
    inventory: fromJson(row.inventory),
    weightRoomAccess: bool(row.weight_room_access),
    bodyweightKg: row.bodyweight_kg,
    workingMax: fromJsonRecord<WorkingMax>(row.working_max),
    inSeason: bool(row.in_season),
    readinessPassedAt: row.readiness_passed_at,
    standingReachMm: row.standing_reach_mm,
    goalHeightMm: row.goal_height_mm,
    targetDate: row.target_date,
    timezone: row.timezone,
    rolloverHour: row.rollover_hour,
    testConditionsNote: row.test_conditions_note,
    secondaryGoal: row.secondary_goal,
    fingerHistory: bool(row.finger_history),
    gripMode: oneOfOrNull(row.grip_mode, GRIP_MODES),
    fingerPainCeiling: row.finger_pain_ceiling,
    wallWork: fromJson(row.wall_work_json),
    sessionWindow: fromJson(row.session_window_json),
    valgusControl: fromJson(row.valgus_control_json),
    weakerSide: oneOfOrNull(row.weaker_side, SIDES),
    readinessConfig: fromJson(row.readiness_config_json),
    bestSets: fromJson(row.best_sets_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPain(row: PainRow): PainStatus {
  return {
    id: row.id,
    athleteId: row.athlete_id,
    location: row.location,
    severityRaw: row.severity_raw,
    severityDerived: oneOfOrNull(row.severity_derived, SEVERITIES) ?? 'none',
    onset: row.onset === 'chronic' ? 'chronic' : 'acute',
    durationWeeks: row.duration_weeks,
    houseRule: bool(row.house_rule),
    note: row.note,
    reportedAt: row.reported_at,
    reassessDueAt: row.reassess_due_at,
    clearedAt: row.cleared_at,
  };
}

export type AthletePatch = Partial<Omit<Athlete, 'id' | 'createdAt' | 'updatedAt'>>;

export async function getAthlete(db: SqlExecutor): Promise<Athlete | null> {
  const row = await db.getFirstAsync<AthleteRow>('SELECT * FROM athlete WHERE id = ?', [ATHLETE_ID]);
  return row === null ? null : mapAthlete(row);
}

export async function isAthleteEmpty(db: SqlExecutor): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM athlete');
  return (row?.n ?? 0) === 0;
}

/**
 * Create or patch the singleton. Only the fields present in the patch move, so
 * a setup step can save one answer without knowing the rest of the record.
 */
export async function upsertAthlete(db: SqlExecutor, patch: AthletePatch): Promise<Athlete> {
  const at = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO athlete (id, timezone, rollover_hour, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [ATHLETE_ID, patch.timezone ?? 'UTC', patch.rolloverHour ?? 0, at, at],
    );

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const put = (column: string, value: string | number | null): void => {
      sets.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.primaryGoal !== undefined) put('primary_goal', patch.primaryGoal);
    if (patch.sport !== undefined) put('sport', patch.sport);
    if (patch.trainingAgeYears !== undefined) put('training_age_years', patch.trainingAgeYears);
    if (patch.level !== undefined) put('level', patch.level);
    if (patch.daysPerWeek !== undefined) put('days_per_week', patch.daysPerWeek);
    if (patch.weekdays !== undefined) put('weekdays', toJson(patch.weekdays));
    if (patch.isAdult !== undefined) put('is_adult', intBool(patch.isAdult));
    if (patch.clearance !== undefined) put('clearance', toJson(patch.clearance));
    if (patch.inventory !== undefined) put('inventory', toJson(patch.inventory));
    if (patch.weightRoomAccess !== undefined) put('weight_room_access', intBool(patch.weightRoomAccess));
    if (patch.bodyweightKg !== undefined) put('bodyweight_kg', patch.bodyweightKg);
    if (patch.workingMax !== undefined) put('working_max', toJson(patch.workingMax));
    if (patch.inSeason !== undefined) put('in_season', intBool(patch.inSeason));
    if (patch.readinessPassedAt !== undefined) put('readiness_passed_at', patch.readinessPassedAt);
    if (patch.standingReachMm !== undefined) put('standing_reach_mm', patch.standingReachMm);
    if (patch.goalHeightMm !== undefined) put('goal_height_mm', patch.goalHeightMm);
    if (patch.targetDate !== undefined) put('target_date', patch.targetDate);
    if (patch.timezone !== undefined) put('timezone', patch.timezone);
    if (patch.rolloverHour !== undefined) put('rollover_hour', patch.rolloverHour);
    if (patch.testConditionsNote !== undefined) put('test_conditions_note', patch.testConditionsNote);
    if (patch.secondaryGoal !== undefined) put('secondary_goal', patch.secondaryGoal);
    if (patch.fingerHistory !== undefined) put('finger_history', intBool(patch.fingerHistory) ?? 0);
    if (patch.gripMode !== undefined) put('grip_mode', patch.gripMode);
    if (patch.fingerPainCeiling !== undefined) put('finger_pain_ceiling', patch.fingerPainCeiling);
    if (patch.wallWork !== undefined) put('wall_work_json', toJson(patch.wallWork));
    if (patch.sessionWindow !== undefined) put('session_window_json', toJson(patch.sessionWindow));
    if (patch.valgusControl !== undefined) put('valgus_control_json', toJson(patch.valgusControl));
    if (patch.weakerSide !== undefined) put('weaker_side', patch.weakerSide);
    if (patch.readinessConfig !== undefined) {
      put('readiness_config_json', toJson(patch.readinessConfig));
    }
    if (patch.bestSets !== undefined) put('best_sets_json', toJson(patch.bestSets));

    put('updated_at', at);
    params.push(ATHLETE_ID);
    await db.runAsync(`UPDATE athlete SET ${sets.join(', ')} WHERE id = ?`, params);
  });

  const saved = await getAthlete(db);
  if (saved === null) throw new Error('upsertAthlete: the athlete row did not save.');
  return saved;
}

/* ---------------------------------------------------------------- pain */

export interface PainStatusInput {
  readonly location: string;
  readonly severityRaw: number;
  readonly severityDerived: PainSeverity;
  readonly onset: 'acute' | 'chronic';
  readonly durationWeeks?: number | null;
  readonly houseRule?: boolean;
  readonly note?: string | null;
  readonly reportedAt?: Timestamp;
  readonly reassessDueAt?: LocalDate | null;
}

/** Open pain rows, newest first. A cleared row stays for the history. */
export async function listPainStatus(db: SqlExecutor, includeCleared = false): Promise<PainStatus[]> {
  const sql = includeCleared
    ? 'SELECT * FROM pain_status WHERE athlete_id = ? ORDER BY reported_at DESC'
    : 'SELECT * FROM pain_status WHERE athlete_id = ? AND cleared_at IS NULL ORDER BY reported_at DESC';
  const rows = await db.getAllAsync<PainRow>(sql, [ATHLETE_ID]);
  return rows.map(mapPain);
}

/**
 * A new report supersedes the open report for the same location: pain changes
 * apply from today, and two open rows for one knee would double the exclusions.
 */
export async function reportPain(db: SqlExecutor, input: PainStatusInput): Promise<PainStatus> {
  const id = newId('pain');
  const at = input.reportedAt ?? nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE pain_status SET cleared_at = ? WHERE athlete_id = ? AND location = ? AND cleared_at IS NULL',
      [at, ATHLETE_ID, input.location],
    );
    await db.runAsync(
      `INSERT INTO pain_status
         (id, athlete_id, location, severity_raw, severity_derived, onset, duration_weeks,
          house_rule, note, reported_at, reassess_due_at, cleared_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        id,
        ATHLETE_ID,
        input.location,
        input.severityRaw,
        input.severityDerived,
        input.onset,
        input.durationWeeks ?? null,
        intBool(input.houseRule ?? false),
        input.note ?? null,
        at,
        input.reassessDueAt ?? null,
      ],
    );
  });
  const row = await db.getFirstAsync<PainRow>('SELECT * FROM pain_status WHERE id = ?', [id]);
  if (row === null) throw new Error('reportPain: the pain row did not save.');
  return mapPain(row);
}

export async function clearPain(db: SqlExecutor, painId: string): Promise<void> {
  await db.runAsync('UPDATE pain_status SET cleared_at = ? WHERE id = ?', [nowIso(), painId]);
}

/* -------------------------------------------------- clearance and inventory */

export async function setClearance(db: SqlExecutor, clearance: Json): Promise<Athlete> {
  return upsertAthlete(db, { clearance });
}

export async function setInventory(
  db: SqlExecutor,
  inventory: Json,
  weightRoomAccess: boolean,
): Promise<Athlete> {
  return upsertAthlete(db, { inventory, weightRoomAccess });
}

/* ------------------------------------------------------------ working max */

export async function getWorkingMaxes(
  db: SqlExecutor,
): Promise<Readonly<Record<string, WorkingMax>>> {
  const athlete = await getAthlete(db);
  return athlete?.workingMax ?? {};
}

/** Set or replace one lift's working max, leaving every other lift alone. */
export async function setWorkingMax(db: SqlExecutor, max: WorkingMax): Promise<Athlete> {
  const current = await getWorkingMaxes(db);
  return upsertAthlete(db, { workingMax: { ...current, [max.exerciseId]: max } });
}

export async function removeWorkingMax(db: SqlExecutor, exerciseId: string): Promise<Athlete> {
  const current = { ...(await getWorkingMaxes(db)) };
  delete current[exerciseId];
  return upsertAthlete(db, { workingMax: current });
}
