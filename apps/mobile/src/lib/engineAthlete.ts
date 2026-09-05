/**
 * The store's athlete row, read as the engine's `Athlete`.
 *
 * The store keeps the answers as columns and JSON; the engine wants a closed
 * union for every one of them. This is the single narrowing point, so no
 * screen ever casts a row into an engine input. Two fields the store has no
 * column for are derived rather than duplicated: `primaryInstrument` and
 * `baselineHeightMm` come from the baseline jump test, which is the row the
 * athlete actually created in setup step 2.
 */
import type {
  Athlete as EngineAthlete,
  BestSet,
  ClearanceAnswers,
  GripMode,
  Instrument,
  Inventory,
  LiftId,
  PainStatus as EnginePain,
  PainSeverityRaw,
  PrimaryGoal,
  ReadinessTestConfig,
  ReadinessTestKind,
  ReadinessMetric,
  SecondaryGoal,
  SessionWindow,
  Side,
  Sport,
  TrainingAge,
  ValgusControl,
  WallWork,
  Weekday,
  WorkingMax as EngineWorkingMax,
} from '@vert/engine';
import { deriveLevel, loadRuleset } from '@vert/engine';
import type { Athlete, LocalDate, PainStatus } from '@/data';
import { DEFAULT_INVENTORY, readInventory } from './inventory';

const SPORTS: readonly Sport[] = [
  'basketball',
  'football',
  'soccer',
  'track_field',
  'volleyball',
  'baseball',
  'speed_climbing',
  'none',
];

const SECONDARY_GOALS: readonly SecondaryGoal[] = [
  'upper_body_power',
  'speed',
  'strength',
  'injury_prevention',
];

const GRIP_MODES: readonly GripMode[] = ['open_hand', 'half_crimp', 'full_crimp', 'any'];
const SIDES: readonly Side[] = ['left', 'right'];
const READINESS_KINDS: readonly ReadinessTestKind[] = ['seated_mb_throw', 'cmj', 'rsi'];
const READINESS_METRICS: readonly ReadinessMetric[] = ['distance_m', 'height_in', 'rsi'];

const GOALS: readonly PrimaryGoal[] = [
  'vertical_jump',
  'sprint_speed',
  'strength',
  'overall_athleticism',
  'return_from_injury',
];

const LOCATIONS: readonly EnginePain['location'][] = [
  'knee',
  'achilles_calf',
  'hamstring',
  'hip',
  'back',
  'shoulder',
  'shin',
  'finger',
  'other',
];

const INSTRUMENTS: readonly Instrument[] = [
  'ovr_jump_regular',
  'ovr_jump_rsi',
  'vertec_reach_touch',
  'manual',
];

/** Training age as the store's years column, and back again. */
export const TRAINING_AGE_YEARS: Readonly<Record<TrainingAge, number>> = {
  none: 0,
  lt1: 0.5,
  '1to3': 2,
  '4plus': 5,
};

/** The years column read back as the answer the athlete tapped. */
export function trainingAgeFromYears(years: number | null): TrainingAge {
  if (years === null) return 'none';
  if (years >= 4) return '4plus';
  if (years >= 1) return '1to3';
  if (years > 0) return 'lt1';
  return 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function flag(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

function dateOrUndefined(value: unknown): LocalDate | undefined {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined;
}

/** The athlete's stored clearance JSON, narrowed. Missing means unanswered. */
export function readClearanceAnswers(value: unknown, isAdult = true): ClearanceAnswers {
  const source = isRecord(value) ? value : {};
  const answers: ClearanceAnswers = {
    heartCondition: flag(source, 'heartCondition'),
    chestPain: flag(source, 'chestPain'),
    dizziness: flag(source, 'dizziness'),
    chronicCondition: flag(source, 'chronicCondition'),
    prescriptionMedication: flag(source, 'prescriptionMedication'),
    boneOrJointProblem: flag(source, 'boneOrJointProblem'),
    supervisedActivityOnly: flag(source, 'supervisedActivityOnly'),
    isAdult: source['isAdult'] === undefined ? isAdult : flag(source, 'isAdult'),
  };
  const attested = dateOrUndefined(source['attestedAt']);
  if (attested !== undefined) answers.attestedAt = attested;
  const cleared = dateOrUndefined(source['clearedByClinicianAt']);
  if (cleared !== undefined) answers.clearedByClinicianAt = cleared;
  const next = dateOrUndefined(source['nextPromptAt']);
  if (next !== undefined) answers.nextPromptAt = next;
  return answers;
}

/** 1-2 mild, 3-4 moderate, 5+ severe: the chip the athlete tapped, restored. */
export function severityRawFrom(value: number): PainSeverityRaw {
  if (value >= 5) return '5+';
  if (value >= 3) return '3-4';
  return '1-2';
}

/**
 * A stored pain row as the engine reads it. The store keeps the boundary
 * answer (`onset`), not a week count, so `durationWeeks` is filled from it
 * when the athlete never typed one: the gate only ever reads `duration`.
 */
export function toEnginePain(row: PainStatus): EnginePain | null {
  const location = LOCATIONS.find((entry) => entry === row.location);
  if (location === undefined) return null;
  const severityRaw = severityRawFrom(row.severityRaw);
  const severity = row.severityDerived === 'none' ? 'mild' : row.severityDerived;
  const reportedAt = row.reportedAt.slice(0, 10);
  const pain: EnginePain = {
    location,
    severityRaw,
    severity,
    duration: row.onset,
    durationWeeks: row.durationWeeks ?? (row.onset === 'chronic' ? 12 : 1),
    reportedAt,
    reassessDueAt: row.reassessDueAt ?? reportedAt,
  };
  const cleared = dateOrUndefined(row.clearedAt);
  if (cleared !== undefined) pain.clearedAt = cleared;
  return pain;
}

function toEngineWorkingMaxes(
  record: Athlete['workingMax'],
  fallbackFrozenAt: string,
): EngineWorkingMax[] {
  const out: EngineWorkingMax[] = [];
  for (const [lift, max] of Object.entries(record)) {
    const entry: EngineWorkingMax = {
      lift,
      valueKg: max.valueKg,
      source: max.source,
      confidence: max.confidence,
      frozenAt: max.frozenAt ?? fallbackFrozenAt,
      failStreak: 0,
    };
    if (max.lastRaiseAt !== null) entry.lastRaiseAt = max.lastRaiseAt;
    out.push(entry);
  }
  return out;
}


/* ------------------------------------------------- the climbing answers */

/**
 * House `house.sc.readiness_gate`: the gate's shipped defaults, which is what
 * an athlete who never opened the setting runs on. Read from the ruleset
 * rather than typed here, so a change to the file changes the default once.
 */
export function defaultReadinessConfig(): ReadinessTestConfig {
  return { ...loadRuleset().constants.climbing.readiness };
}

/** House `house.sc.finger_pain_ceiling`: 3, so 4 and above removes the work. */
export function defaultFingerPainCeiling(): number {
  return loadRuleset().constants.climbing.fingerPainCeiling;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

/** "18:00". Anything that is not a 24-hour clock time is no answer at all. */
function clockTime(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : undefined;
}

/** The stored wall-work JSON, narrowed. Null when no wall day is known. */
export function readWallWork(value: unknown): WallWork | null {
  if (!isRecord(value)) return null;
  const raw = value['weekdays'];
  if (!Array.isArray(raw)) return null;
  const weekdays = [
    ...new Set(
      raw.filter((day): day is Weekday => typeof day === 'number' && day >= 0 && day <= 6),
    ),
  ].sort((a, b) => a - b);
  if (weekdays.length === 0) return null;
  const wallWork: WallWork = { weekdays };
  const start = clockTime(value['typicalStart']);
  if (start !== undefined) wallWork.typicalStart = start;
  const end = clockTime(value['typicalEnd']);
  if (end !== undefined) wallWork.typicalEnd = end;
  // The owner's two answers (`house.sc.hard_finger_spacing`). Both are absent
  // on a row written before the questions existed, and absent reads as the
  // engine's own default: the wall loads the fingers hard, six hours apart.
  if (value['fingerLoad'] === 'light' || value['fingerLoad'] === 'hard') {
    wallWork.fingerLoad = value['fingerLoad'];
  }
  const gap = value['sameDayGapHours'];
  if (typeof gap === 'number' && Number.isFinite(gap) && gap >= 0) {
    wallWork.sameDayGapHours = gap;
  }
  return wallWork;
}

/** House `house.sc.hard_finger_spacing`: six hours, from the ruleset. */
export function defaultWallGapHours(): number {
  return loadRuleset().constants.climbing.rntWallGapHours;
}

/**
 * The stored best-recent-set document, narrowed to what R73 can read.
 *
 * A lift with no reps or no load is not a set, so it is dropped rather than
 * written back as a half entry the engine would have to guess about.
 */
export function readBestSets(value: unknown): Partial<Record<LiftId, BestSet>> {
  const out: Partial<Record<LiftId, BestSet>> = {};
  if (!isRecord(value)) return out;
  for (const [lift, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const reps = raw['reps'];
    const loadKg = raw['loadKg'];
    const at = dateOrUndefined(raw['at']);
    if (typeof reps !== 'number' || !Number.isFinite(reps) || reps <= 0) continue;
    if (typeof loadKg !== 'number' || !Number.isFinite(loadKg) || loadKg <= 0) continue;
    if (at === undefined) continue;
    const set: BestSet = { reps: Math.round(reps), loadKg, at };
    const rpe = raw['rpe'];
    if (typeof rpe === 'number' && Number.isFinite(rpe)) set.rpe = rpe;
    out[lift] = set;
  }
  return out;
}

/** When the athlete usually trains. Absent falls back to the engine's window. */
export function readSessionWindow(value: unknown): SessionWindow | null {
  if (!isRecord(value)) return null;
  const start = clockTime(value['start']);
  const end = clockTime(value['end']);
  return start === undefined || end === undefined ? null : { start, end };
}

/**
 * House `house.sc.rnt_valgus_control`. Off is the default: an athlete who was
 * never asked does not get an injury-prevention row they did not ask for, and
 * `required: false` is what off looks like to the placement rule.
 */
export function readValgusControl(value: unknown): ValgusControl {
  const constants = loadRuleset().constants.climbing;
  const off: ValgusControl = {
    required: false,
    sessionsPerWeek: constants.rntSessionsPerWeek,
    minHoursFromWall: constants.rntWallGapHours,
  };
  if (!isRecord(value)) return off;
  return {
    required: value['required'] === true,
    sessionsPerWeek: positiveInt(value['sessionsPerWeek'], off.sessionsPerWeek),
    minHoursFromWall: positiveInt(value['minHoursFromWall'], off.minHoursFromWall),
  };
}

/**
 * The gate's configuration, field by field, over the shipped defaults. A file
 * the athlete half filled in still runs the gate rather than turning it off.
 */
export function readReadinessConfig(value: unknown): ReadinessTestConfig {
  const config = defaultReadinessConfig();
  if (!isRecord(value)) return config;
  const kind = READINESS_KINDS.find((entry) => entry === value['kind']) ?? config.kind;
  const metric = READINESS_METRICS.find((entry) => entry === value['metric']) ?? config.metric;
  return {
    kind,
    metric,
    attempts: positiveInt(value['attempts'], config.attempts),
    baselineWindow: positiveInt(value['baselineWindow'], config.baselineWindow),
    lowThresholdPct: positiveInt(value['lowThresholdPct'], config.lowThresholdPct),
    whoopLowScore: positiveInt(value['whoopLowScore'], config.whoopLowScore),
  };
}

/** The baseline the program is measured against: setup's jump test number one. */
export interface BaselineReading {
  readonly heightMm: number;
  readonly instrument: Instrument;
}

export interface EngineAthleteInput {
  readonly athlete: Athlete;
  readonly pains: readonly PainStatus[];
  readonly baseline: BaselineReading | null;
}

/** Thrown when the row cannot make a legal engine athlete. Names the fix. */
export class IncompleteProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteProfileError';
  }
}

export function toEngineAthlete(input: EngineAthleteInput): EngineAthlete {
  const row = input.athlete;
  if (row.daysPerWeek === null) {
    throw new IncompleteProfileError('Pick how many days a week you train.');
  }
  if (row.weekdays.length !== row.daysPerWeek) {
    throw new IncompleteProfileError(`Pick ${row.daysPerWeek} training days.`);
  }
  if (row.goalHeightMm === null) throw new IncompleteProfileError('Enter a goal jump height.');
  if (row.targetDate === null) throw new IncompleteProfileError('Enter a target date.');

  const trainingAge = trainingAgeFromYears(row.trainingAgeYears);
  const inventory: Inventory = readInventory(row.inventory) ?? DEFAULT_INVENTORY;
  const painStatus: EnginePain[] = [];
  for (const pain of input.pains) {
    const converted = toEnginePain(pain);
    if (converted !== null) painStatus.push(converted);
  }

  const athlete: EngineAthlete = {
    id: row.id,
    primaryGoal: GOALS.find((goal) => goal === row.primaryGoal) ?? 'vertical_jump',
    sport: SPORTS.find((sport) => sport === row.sport) ?? 'none',
    trainingAge,
    level: deriveLevel(trainingAge),
    daysPerWeek: row.daysPerWeek,
    weekdays: row.weekdays.filter((day): day is Weekday => day >= 0 && day <= 6),
    isAdult: row.isAdult,
    clearance: readClearanceAnswers(row.clearance, row.isAdult),
    painStatus,
    inventory,
    bodyweightKg: row.bodyweightKg,
    workingMaxes: toEngineWorkingMaxes(row.workingMax, row.updatedAt),
    inSeason: row.inSeason,
    standingReachMm: row.standingReachMm,
    goalHeightMm: row.goalHeightMm,
    targetDate: row.targetDate,
    primaryInstrument:
      INSTRUMENTS.find((entry) => entry === input.baseline?.instrument) ?? 'ovr_jump_regular',
    baselineHeightMm: input.baseline?.heightMm ?? 0,
    timezone: row.timezone,
    rolloverHour: row.rolloverHour,
    canonicalTestNote: row.testConditionsNote ?? '',
    sorenessHistory: [],
    extraEquipment: [],
  };
  const readiness = dateOrUndefined(row.readinessPassedAt);
  if (readiness !== undefined) athlete.readinessPassedAt = readiness;

  // The climbing answers. Every one has a default that reads as "never asked",
  // so an athlete on the old columns keeps exactly the program they had.
  const secondaryGoal = SECONDARY_GOALS.find((goal) => goal === row.secondaryGoal);
  if (secondaryGoal !== undefined) athlete.secondaryGoal = secondaryGoal;
  athlete.fingerHistory = row.fingerHistory === true;
  // House `house.sc.open_hand_grip`: a finger history forces open hand, so a
  // row that says one and not the other is read as the safer of the two.
  athlete.gripMode =
    GRIP_MODES.find((mode) => mode === row.gripMode) ??
    (row.fingerHistory === true ? 'open_hand' : 'any');
  const ceiling = row.fingerPainCeiling;
  athlete.fingerPainCeiling =
    typeof ceiling === 'number' && Number.isFinite(ceiling) ? ceiling : defaultFingerPainCeiling();
  const wallWork = readWallWork(row.wallWork ?? null);
  if (wallWork !== null) athlete.wallWork = wallWork;
  const sessionWindow = readSessionWindow(row.sessionWindow ?? null);
  if (sessionWindow !== null) athlete.sessionWindow = sessionWindow;
  athlete.valgusControl = readValgusControl(row.valgusControl ?? null);
  athlete.weakerSide = SIDES.find((side) => side === row.weakerSide) ?? null;
  athlete.readinessConfig = readReadinessConfig(row.readinessConfig ?? null);
  const bestSets = readBestSets(row.bestSets ?? null);
  if (Object.keys(bestSets).length > 0) athlete.bestSets = bestSets;
  return athlete;
}
