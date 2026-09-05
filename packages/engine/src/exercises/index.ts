/**
 * The exercise database and the progression ladders.
 *
 * R58, R59 and R60 make stability demand, the three joint-stress tags, CNS
 * cost and fatigue cost required attributes: "Exercises without this tag
 * cannot be selected by the generator". `validateExercise` therefore throws on
 * any missing required tag rather than defaulting one, and a seed test fails
 * the build (brief section 12).
 *
 * Every ladder must have a rank 0 whose equipment list is empty, so an athlete
 * with nothing but a floor still has a first rung (house rule).
 */
import rawExercises from './seed.json';
import rawLadders from './ladders.json';
import type { Exercise, LadderRung, PlyometricProfile, ProgressionLadder } from '../types/exercise.js';
import type {
  ChartCategory,
  CnsCost,
  DayType,
  FingerLoad,
  GripMode,
  DisplayMode,
  EquipmentTag,
  ExerciseId,
  ExerciseIntent,
  ExerciseRole,
  LadderId,
  Level,
  LoadType,
  MovementPattern,
  Plane,
  Sport,
  StabilityDemand,
  StressLevel,
  TendonMode,
  TendonTarget,
} from '../types/core.js';
import type { ReadinessMetric, ReadinessTestKind } from '../types/readiness.js';

/** Thrown when a seeded exercise or ladder is not selectable. */
export class ExerciseValidationError extends Error {
  constructor(id: string, detail: string) {
    super(`exercise ${id}: ${detail}`);
    this.name = 'ExerciseValidationError';
  }
}

/** Thrown when a ladder is malformed. */
export class LadderValidationError extends Error {
  constructor(id: string, detail: string) {
    super(`ladder ${id}: ${detail}`);
    this.name = 'LadderValidationError';
  }
}

const STRESS: readonly StressLevel[] = ['low', 'moderate', 'high'];
const LOAD_TYPES: readonly LoadType[] = [
  'heavy_strength', 'power', 'ballistic', 'hypertrophy', 'endurance',
  'speed_strength', 'strength_speed', 'prehab', 'mobility', 'bodyweight',
];
const DISPLAY_MODES: readonly DisplayMode[] = ['reps', 'time', 'distance'];
const PLANES: readonly Plane[] = ['sagittal', 'frontal', 'transverse'];
const LEVELS: readonly Level[] = ['beginner', 'intermediate', 'advanced'];
const INTENTS: readonly ExerciseIntent[] = [
  'strength', 'velocity', 'elastic', 'mobility', 'low_fatigue', 'prehab',
];
const PATTERNS: readonly MovementPattern[] = [
  'squat', 'hinge', 'lunge', 'push_horizontal', 'push_vertical', 'pull_horizontal',
  'pull_vertical', 'carry', 'jump', 'sprint', 'cod', 'brace', 'rotation', 'isolation', 'mobility',
];
const ROLES: readonly ExerciseRole[] = [
  'main_lift', 'secondary', 'accessory', 'injury_prevention', 'core', 'conditioning',
  'warm_up', 'cool_down', 'mobility', 'primer', 'power_jump', 'cod', 'tendon',
  'activation', 'soft_tissue',
];
const EQUIPMENT: readonly EquipmentTag[] = [
  'barbell', 'rack', 'trap_bar', 'dumbbell', 'kettlebell', 'box', 'hurdle', 'band',
  'med_ball', 'vest', 'bench', 'pullup_bar', 'cable', 'sled', 'hangboard', 'box_squat_box', 'none',
];
const DAY_TYPES: readonly DayType[] = [
  'full_body_strength', 'lower_strength', 'upper_strength', 'upper_mobility',
  'power_speed', 'power', 'speed', 'recovery_mobility',
];
const CHART_CATEGORIES: readonly ChartCategory[] = ['plyometrics', 'strength', 'mobility', 'technique'];
const TENDON_TARGETS: readonly TendonTarget[] = ['calf', 'knee', 'achilles', 'finger'];
const TENDON_MODES: readonly TendonMode[] = ['isometric', 'slow_resistance', 'plyometric'];
const GRIP_MODES: readonly GripMode[] = ['open_hand', 'half_crimp', 'full_crimp', 'any'];
const FINGER_LOADS: readonly FingerLoad[] = ['none', 'light', 'hard'];
const SPORTS: readonly Sport[] = [
  'basketball', 'football', 'soccer', 'track_field', 'volleyball', 'baseball', 'speed_climbing', 'none',
];
const READINESS_TEST_KINDS: readonly ReadinessTestKind[] = ['seated_mb_throw', 'cmj', 'rsi'];
const READINESS_METRICS: readonly ReadinessMetric[] = ['distance_m', 'height_in', 'rsi'];

/**
 * House rule `house.knee_stress_high_reserved`: knee stress `high` is reserved
 * for depth jumps, maximal bounds and heavy bilateral squats, so the R26
 * weekly joint budget cannot oscillate on an ordinary week.
 */
export const KNEE_HIGH_ALLOWED: readonly ExerciseId[] = [
  'back_squat', 'front_squat', 'depth_jump', 'single_leg_bound', 'box_squat', 'depth_pause_jump',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function req(source: Record<string, unknown>, key: string, id: string): unknown {
  if (!(key in source)) throw new ExerciseValidationError(id, `missing required tag ${key}`);
  return source[key];
}

function bool(source: Record<string, unknown>, key: string, id: string): boolean {
  const value = req(source, key, id);
  if (typeof value !== 'boolean') throw new ExerciseValidationError(id, `${key} must be a boolean`);
  return value;
}

function str(source: Record<string, unknown>, key: string, id: string): string {
  const value = req(source, key, id);
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExerciseValidationError(id, `${key} must be a non-empty string`);
  }
  return value;
}

function int(source: Record<string, unknown>, key: string, id: string): number {
  const value = req(source, key, id);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExerciseValidationError(id, `${key} must be a finite number`);
  }
  return value;
}

function optNum(source: Record<string, unknown>, key: string, id: string): number | undefined {
  if (!(key in source)) return undefined;
  return int(source, key, id);
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  id: string,
  allowed: readonly T[],
): T {
  const value = str(source, key, id);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ExerciseValidationError(id, `${key} must be one of ${allowed.join(', ')}, got ${value}`);
  }
  return value as T;
}

function optOneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  id: string,
  allowed: readonly T[],
): T | undefined {
  if (!(key in source)) return undefined;
  return oneOf(source, key, id, allowed);
}

function listOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  id: string,
  allowed: readonly T[],
  minLength: number,
): T[] {
  const value = req(source, key, id);
  if (!Array.isArray(value)) throw new ExerciseValidationError(id, `${key} must be an array`);
  if (value.length < minLength) {
    throw new ExerciseValidationError(id, `${key} needs at least ${minLength} entries`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || !(allowed as readonly string[]).includes(entry)) {
      throw new ExerciseValidationError(id, `${key} has an unknown value ${String(entry)}`);
    }
    return entry as T;
  });
}

function cuesOf(source: Record<string, unknown>, id: string): string[] {
  const value = req(source, 'cues', id);
  if (!Array.isArray(value)) throw new ExerciseValidationError(id, 'cues must be an array');
  if (value.length < 2 || value.length > 4) {
    throw new ExerciseValidationError(id, 'cues must hold 2 to 4 short second-person cues');
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new ExerciseValidationError(id, 'every cue must be a non-empty string');
    }
    return entry;
  });
}

function plyometricOf(source: Record<string, unknown>, id: string, ladderIds: Set<LadderId>): PlyometricProfile | undefined {
  if (!('plyometric' in source)) return undefined;
  const raw = source['plyometric'];
  if (!isRecord(raw)) throw new ExerciseValidationError(id, 'plyometric must be an object');
  const contactTime = oneOf(raw, 'contactTime', id, ['fast', 'slow'] as const);
  const amplitude = oneOf(raw, 'amplitude', id, ['low', 'high'] as const);
  const intensity = oneOf(raw, 'intensity', id, ['low', 'moderate', 'high'] as const);
  const category = oneOf(raw, 'category', id, ['extensive', 'intensive'] as const);
  const contactsPerRep = int(raw, 'contactsPerRep', id);
  if (contactsPerRep < 1) throw new ExerciseValidationError(id, 'contactsPerRep must be at least 1');
  const isMaximalJump = bool(raw, 'isMaximalJump', id);
  const profile: PlyometricProfile = {
    contactTime, amplitude, intensity, category, contactsPerRep, isMaximalJump,
  };
  if ('ladderId' in raw) {
    const ladderId = str(raw, 'ladderId', id);
    if (!ladderIds.has(ladderId)) {
      throw new ExerciseValidationError(id, `ladderId ${ladderId} is not defined in ladders.json`);
    }
    profile.ladderId = ladderId;
  }
  const heightIn = optNum(raw, 'heightIn', id);
  if (heightIn !== undefined) profile.heightIn = heightIn;
  return profile;
}

/**
 * Validate one exercise. Throws on any missing required tag, on a plyometric
 * record without contacts per rep, on a ladder reference the ladders do not
 * define, and on a knee-stress `high` tag outside the reserved list.
 */
export function validateExercise(value: unknown, ladderIds: Set<LadderId>): Exercise {
  if (!isRecord(value)) throw new ExerciseValidationError('<unknown>', 'expected an object');
  const id = str(value, 'id', '<unknown>');

  const kneeStress = oneOf(value, 'kneeStress', id, STRESS);
  if (kneeStress === 'high' && !KNEE_HIGH_ALLOWED.includes(id)) {
    throw new ExerciseValidationError(
      id,
      'kneeStress high is reserved for depth jumps, maximal bounds and heavy bilateral squats',
    );
  }

  const exercise: Exercise = {
    id,
    name: str(value, 'name', id),
    loadType: oneOf(value, 'loadType', id, LOAD_TYPES),
    loadable: bool(value, 'loadable', id),
    displayMode: oneOf(value, 'displayMode', id, DISPLAY_MODES),
    stabilityDemand: oneOf(value, 'stabilityDemand', id, STRESS) as StabilityDemand,
    kneeStress,
    spineStress: oneOf(value, 'spineStress', id, STRESS),
    shoulderStress: oneOf(value, 'shoulderStress', id, STRESS),
    cnsCost: oneOf(value, 'cnsCost', id, STRESS) as CnsCost,
    fatigueCost: oneOf(value, 'fatigueCost', id, STRESS),
    equipment: listOf(value, 'equipment', id, EQUIPMENT, 0),
    requiresBarbell: bool(value, 'requiresBarbell', id),
    movementPattern: oneOf(value, 'movementPattern', id, PATTERNS),
    plane: oneOf(value, 'plane', id, PLANES),
    unilateral: bool(value, 'unilateral', id),
    isAxialLoad: bool(value, 'isAxialLoad', id),
    isOverhead: bool(value, 'isOverhead', id),
    isPressing: bool(value, 'isPressing', id),
    isPush: bool(value, 'isPush', id),
    isPull: bool(value, 'isPull', id),
    isPulling: bool(value, 'isPulling', id),
    isRnt: bool(value, 'isRnt', id),
    repetitiveImpact: bool(value, 'repetitiveImpact', id),
    isOlympicLift: bool(value, 'isOlympicLift', id),
    technicalSkillHigh: bool(value, 'technicalSkillHigh', id),
    intent: oneOf(value, 'intent', id, INTENTS),
    levelMin: oneOf(value, 'levelMin', id, LEVELS),
    roleCandidates: listOf(value, 'roleCandidates', id, ROLES, 1),
    isMainLift: bool(value, 'isMainLift', id),
    defaultSets: int(value, 'defaultSets', id),
    prefersLoadableInStrengthBlock: bool(value, 'prefersLoadableInStrengthBlock', id),
    readinessRequired: bool(value, 'readinessRequired', id),
    cues: cuesOf(value, id),
    dayTypes: listOf(value, 'dayTypes', id, DAY_TYPES, 1),
    categoryForCharts: oneOf(value, 'categoryForCharts', id, CHART_CATEGORIES),
  };

  const plyometric = plyometricOf(value, id, ladderIds);
  if (plyometric !== undefined) exercise.plyometric = plyometric;
  const tendonTarget = optOneOf(value, 'tendonTarget', id, TENDON_TARGETS);
  if (tendonTarget !== undefined) exercise.tendonTarget = tendonTarget;
  const tendonMode = optOneOf(value, 'tendonMode', id, TENDON_MODES);
  if (tendonMode !== undefined) exercise.tendonMode = tendonMode;
  const gripMode = optOneOf(value, 'gripMode', id, GRIP_MODES);
  if (gripMode !== undefined) exercise.gripMode = gripMode;
  const fingerLoad = optOneOf(value, 'fingerLoad', id, FINGER_LOADS);
  if (fingerLoad !== undefined) exercise.fingerLoad = fingerLoad;
  const sideOrder = optOneOf(value, 'sideOrder', id, ['weaker_first'] as const);
  if (sideOrder !== undefined) exercise.sideOrder = sideOrder;
  if ('valgusProtocol' in value) {
    const raw = value['valgusProtocol'];
    if (!isRecord(raw)) throw new ExerciseValidationError(id, 'valgusProtocol must be an object');
    exercise.valgusProtocol = {
      repTermination: oneOf(raw, 'repTermination', id, ['alignment'] as const),
    };
  }
  if ('readinessTest' in value) {
    const raw = value['readinessTest'];
    if (!isRecord(raw)) throw new ExerciseValidationError(id, 'readinessTest must be an object');
    exercise.readinessTest = {
      kind: oneOf(raw, 'kind', id, READINESS_TEST_KINDS),
      metric: oneOf(raw, 'metric', id, READINESS_METRICS),
    };
  }
  if ('sports' in value) exercise.sports = listOf(value, 'sports', id, SPORTS, 1);
  if ('rotationGroup' in value) exercise.rotationGroup = str(value, 'rotationGroup', id);
  if ('holdSecondsRange' in value) {
    const raw = value['holdSecondsRange'];
    if (!isRecord(raw)) throw new ExerciseValidationError(id, 'holdSecondsRange must be an object');
    exercise.holdSecondsRange = { minS: int(raw, 'minS', id), maxS: int(raw, 'maxS', id) };
  }
  const sprintDistanceM = optNum(value, 'sprintDistanceM', id);
  if (sprintDistanceM !== undefined) exercise.sprintDistanceM = sprintDistanceM;
  const codCutsPerRep = optNum(value, 'codCutsPerRep', id);
  if (codCutsPerRep !== undefined) exercise.codCutsPerRep = codCutsPerRep;
  const oneRmHintRatio = optNum(value, 'oneRmHintRatio', id);
  if (oneRmHintRatio !== undefined) exercise.oneRmHintRatio = oneRmHintRatio;
  const ballisticCapPct = optNum(value, 'ballisticCapPct', id);
  if (ballisticCapPct !== undefined) exercise.ballisticCapPct = ballisticCapPct;
  const dropHeightCapIn = optNum(value, 'dropHeightCapIn', id);
  if (dropHeightCapIn !== undefined) exercise.dropHeightCapIn = dropHeightCapIn;
  if ('videoUrl' in value) exercise.videoUrl = str(value, 'videoUrl', id);

  if (exercise.displayMode === 'time' && exercise.holdSecondsRange === undefined) {
    throw new ExerciseValidationError(id, 'a timed exercise needs holdSecondsRange');
  }
  if (exercise.displayMode === 'distance' && exercise.sprintDistanceM === undefined) {
    throw new ExerciseValidationError(id, 'a distance exercise needs sprintDistanceM');
  }
  if (exercise.loadType === 'ballistic' && exercise.ballisticCapPct === undefined) {
    throw new ExerciseValidationError(id, 'a ballistic exercise needs ballisticCapPct');
  }
  if (exercise.readinessRequired && exercise.dropHeightCapIn === undefined) {
    throw new ExerciseValidationError(id, 'a readiness-gated drop needs dropHeightCapIn');
  }
  // House `house.sc.open_hand_grip`: a pulling row without a grip tag cannot be
  // filtered for a finger-pulley history, so it is not selectable.
  if (exercise.isPulling && exercise.gripMode === undefined) {
    throw new ExerciseValidationError(id, 'a pulling exercise needs a gripMode');
  }
  // House `house.sc.rnt_valgus_control`: reactive neuromuscular training ends a
  // set on alignment, so the protocol is part of the row, not of the copy.
  if (exercise.isRnt && exercise.valgusProtocol === undefined) {
    throw new ExerciseValidationError(id, 'an RNT exercise needs a valgusProtocol');
  }
  return exercise;
}

/** Validate one ladder, including the equipment-free rank 0. */
export function validateLadder(value: unknown): ProgressionLadder {
  if (!isRecord(value)) throw new LadderValidationError('<unknown>', 'expected an object');
  const id = typeof value['id'] === 'string' ? value['id'] : '<unknown>';
  if (id === '<unknown>') throw new LadderValidationError(id, 'missing id');
  const name = value['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new LadderValidationError(id, 'missing name');
  }
  const rawRungs = value['rungs'];
  if (!Array.isArray(rawRungs) || rawRungs.length === 0) {
    throw new LadderValidationError(id, 'rungs must be a non-empty array');
  }
  const rungs: LadderRung[] = rawRungs.map((raw, index) => {
    if (!isRecord(raw)) throw new LadderValidationError(id, `rung ${index} must be an object`);
    const rank = raw['rank'];
    if (rank !== index) throw new LadderValidationError(id, `rung ${index} must carry rank ${index}`);
    const label = raw['label'];
    if (typeof label !== 'string' || label.length === 0) {
      throw new LadderValidationError(id, `rung ${index} needs a label`);
    }
    const equipment = raw['equipment'];
    if (!Array.isArray(equipment)) throw new LadderValidationError(id, `rung ${index} needs equipment`);
    const tags = equipment.map((tag) => {
      if (typeof tag !== 'string' || !(EQUIPMENT as readonly string[]).includes(tag)) {
        throw new LadderValidationError(id, `rung ${index} has an unknown equipment tag`);
      }
      return tag as EquipmentTag;
    });
    const rung: LadderRung = { rank, label, equipment: tags };
    const heightIn = raw['heightIn'];
    if (heightIn !== undefined) {
      if (typeof heightIn !== 'number' || !Number.isFinite(heightIn)) {
        throw new LadderValidationError(id, `rung ${index} heightIn must be a number`);
      }
      rung.heightIn = heightIn;
    }
    return rung;
  });
  const rank0 = rungs[0];
  if (rank0 === undefined || rank0.equipment.length !== 0) {
    throw new LadderValidationError(id, 'rank 0 must need no equipment');
  }
  return { id, name, rungs };
}

let cached: { exercises: Exercise[]; ladders: ProgressionLadder[] } | null = null;

/**
 * Load and validate the seeded exercises and ladders. Throws on the first
 * problem with the offending id in the message.
 */
export function loadExercises(): { exercises: Exercise[]; ladders: ProgressionLadder[] } {
  if (cached !== null) return cached;
  const laddersRaw: unknown = rawLadders;
  if (!Array.isArray(laddersRaw)) throw new LadderValidationError('<file>', 'ladders.json must be an array');
  const ladders = laddersRaw.map(validateLadder);
  const ladderIds = new Set<LadderId>(ladders.map((ladder) => ladder.id));

  const exercisesRaw: unknown = rawExercises;
  if (!Array.isArray(exercisesRaw)) throw new ExerciseValidationError('<file>', 'seed.json must be an array');
  const exercises = exercisesRaw.map((entry) => validateExercise(entry, ladderIds));

  const seen = new Set<ExerciseId>();
  for (const exercise of exercises) {
    if (seen.has(exercise.id)) throw new ExerciseValidationError(exercise.id, 'duplicate id');
    seen.add(exercise.id);
  }
  cached = { exercises, ladders };
  return cached;
}

/** Index the seed by id for the selector and the contact counter. */
export function indexById(exercises: Exercise[]): ReadonlyMap<ExerciseId, Exercise> {
  return new Map(exercises.map((exercise) => [exercise.id, exercise]));
}

/** Index the ladders by id. */
export function laddersById(ladders: ProgressionLadder[]): ReadonlyMap<LadderId, ProgressionLadder> {
  return new Map(ladders.map((ladder) => [ladder.id, ladder]));
}
