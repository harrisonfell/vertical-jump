/**
 * What a pushed op is allowed to say about each table.
 *
 * The phone sends patches, not rows: `session.patch` carries only what
 * changed, `week.upsert` carries `{ w }`, `setLog.upsert` carries the whole
 * saved log. So every schema here is optional field by field, unknown keys are
 * dropped rather than refused (the phone may be a build ahead of the server),
 * and each table names the columns an INSERT genuinely cannot do without.
 *
 * Those lists are short on purpose. A column the phone never sends cannot be
 * required here, or the row never lands at all; the mirror tables make such
 * columns nullable instead, and project.ts derives the few (the athlete, the
 * current program) that can be derived.
 *
 * Field names are the phone's, which are also the mirror tables', so a parsed
 * patch goes straight into drizzle without a translation step.
 */

import { z } from 'zod';
import { jsonValue, type Json } from '../api-contract';

/* -------------------------------------------------------------- helpers */

const text = () => z.string().nullish();
const required = () => z.string().optional();
const flag = () => z.boolean().optional();
const int = () => z.number().int().nullish();
const decimal = () => z.number().nullish();
const doc = () => jsonValue.nullish();

/** A parsed patch with the absent keys actually absent, not present as undefined. */
export type Patch = Record<string, unknown>;

export function readPatch(schema: z.ZodType<Patch>, payload: Json): Patch | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return null;
  const out: Patch = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The columns an insert cannot invent. Missing ones mean "patch only". */
export function hasAll(patch: Patch, columns: readonly string[]): boolean {
  return columns.every((column) => patch[column] !== undefined && patch[column] !== null);
}

/* --------------------------------------------------------------- tables */

export const athletePatch = z.object({
  primaryGoal: text(),
  sport: text(),
  trainingAgeYears: decimal(),
  level: text(),
  daysPerWeek: int(),
  weekdays: doc(),
  isAdult: flag(),
  clearance: doc(),
  inventory: doc(),
  weightRoomAccess: flag(),
  bodyweightKg: decimal(),
  workingMax: doc(),
  inSeason: flag(),
  readinessPassedAt: text(),
  standingReachMm: int(),
  goalHeightMm: int(),
  targetDate: text(),
  timezone: required(),
  rolloverHour: z.number().int().optional(),
  testConditionsNote: text(),
  /* The climbing answers (`house.sc.*`), additive and every one optional. */
  secondaryGoal: text(),
  fingerHistory: flag(),
  gripMode: text(),
  fingerPainCeiling: int(),
  wallWork: doc(),
  sessionWindow: doc(),
  valgusControl: doc(),
  weakerSide: text(),
  readinessConfig: doc(),
  /** The best recent set per lift (R73), typed in setup or Settings > Lifts. */
  bestSets: doc(),
});

export const painPatch = z.object({
  athleteId: required(),
  location: required(),
  severityRaw: z.number().int().optional(),
  severityDerived: required(),
  onset: required(),
  durationWeeks: decimal(),
  houseRule: flag(),
  note: text(),
  reportedAt: required(),
  reassessDueAt: text(),
  clearedAt: text(),
});

/**
 * The phone's input carries no athlete id, because there is one athlete, and
 * may leave `reportedAt` to the store. The server fills both.
 */
export const PAIN_REQUIRED = ['location', 'severityRaw', 'severityDerived', 'onset'] as const;

/** The phone's single athlete row, when an op arrives before the athlete does. */
export const OWNER_ATHLETE_ID = 'athlete_owner';

export const programPatch = z.object({
  athleteId: required(),
  macroIndex: z.number().int().optional(),
  parentProgramId: text(),
  rulesetVersion: required(),
  seed: required(),
  startDate: required(),
  endDate: required(),
  status: required(),
  snapshot: jsonValue.optional(),
  validationReport: doc(),
});

/**
 * `program.create` sends `{ startDate, endDate, seed }`, so those three and the
 * derived athlete are what an insert waits for. The ruleset version and the
 * snapshot arrive with a later op or not at all.
 */
export const PROGRAM_REQUIRED = ['athleteId', 'seed', 'startDate', 'endDate'] as const;

export const weekPatch = z.object({
  programId: required(),
  programVersionId: text(),
  blockId: text(),
  w: z.number().int().optional(),
  windowStart: required(),
  windowEnd: required(),
  kind: required(),
  k: int(),
  prescribedCount: z.number().int().optional(),
  completedCount: z.number().int().optional(),
  adherencePct: decimal(),
  allRepsCompleted: z.boolean().nullish(),
  outcome: text(),
  generatedAt: text(),
  generatedBy: text(),
  repeatOfWeek: int(),
  jointHighStressCounts: doc(),
  highContactAllowance: int(),
  extensiveTarget: int(),
  ladderRungs: doc(),
  snapshot: doc(),
});

/** Nothing: `week.upsert` sends `{ w }` and the program is derived. */
export const WEEK_REQUIRED = [] as const;

export const sessionPatch = z.object({
  programId: required(),
  weekId: required(),
  scheduledDate: required(),
  orderIndex: z.number().int().optional(),
  dayType: required(),
  blocksPresent: doc(),
  prescribedSetCount: z.number().int().optional(),
  dismissed: flag(),
  testStatus: text(),
  sorenessPre: int(),
  rpe: decimal(),
  legsFeel: text(),
  notes: text(),
  isMaximalCns: flag(),
  trimmedExercises: doc(),
  appliedModifications: doc(),
  shadowModifications: doc(),
  snapshot: doc(),
});

/** Nothing: `session.patch` sends only what changed and the program is derived. */
export const SESSION_REQUIRED = [] as const;

export const setLogPatch = z.object({
  sessionId: required(),
  sessionExerciseId: required(),
  setNumber: z.number().int().optional(),
  repsDone: int(),
  loadKg: decimal(),
  durationS: decimal(),
  distanceM: decimal(),
  boxHeightMm: int(),
  landing: text(),
  rpe: decimal(),
  /** 'left' or 'right' on a unilateral set; absent or null means both at once. */
  side: text(),
  meanVelocityBest: decimal(),
  meanVelocityLast: decimal(),
  velocityLossPct: decimal(),
  loadSource: text(),
  entrySource: required(),
  completedAt: required(),
  plannedDate: text(),
  offsetDays: z.number().int().optional(),
  idempotencyKey: required(),
  editedAt: text(),
  deletedAt: text(),
});

export const SET_LOG_REQUIRED = [
  'sessionId',
  'sessionExerciseId',
  'setNumber',
  'completedAt',
  'idempotencyKey',
] as const;

/** The undo op names the set, not the log row: entityId is the exercise. */
export const undoSetPayload = z.object({
  sessionId: z.string().optional(),
  sessionExerciseId: z.string(),
  setNumber: z.number().int(),
});

const jumpRepPatch = z.object({
  id: z.string().optional(),
  attemptIndex: z.number().int(),
  heightMm: int(),
  gctMs: int(),
  rsiCalc: decimal(),
  rsiDevice: decimal(),
  /** Set on a single-leg test (`house.sc.asymmetry_tracking`). */
  side: text(),
  flagged: flag(),
  rejectReason: text(),
  entrySource: required(),
  importBatchId: text(),
});

export const jumpTestPatch = z.object({
  athleteId: required(),
  sessionId: text(),
  localDate: required(),
  performedAt: required(),
  instrument: required(),
  mode: required(),
  unitPreference: required(),
  boxHeightMm: int(),
  deviceFirmware: text(),
  connectVersion: text(),
  isBaseline: flag(),
  canonical: flag(),
  scheduled: flag(),
  bodyweightKg: decimal(),
  whoopSnapshot: doc(),
  notes: text(),
  importBatchId: text(),
  deletedAt: text(),
  /** The attempts travel with the test; the phone writes both in one go. */
  attempts: z.array(jumpRepPatch).optional(),
});

/**
 * The phone's create input carries no athlete id (there is one athlete) and
 * may leave `performedAt` to the store, so the server fills both: the single
 * athlete row, and the op's own createdAt.
 */
export const JUMP_TEST_REQUIRED = ['localDate', 'instrument'] as const;

export type JumpAttemptPatch = z.infer<typeof jumpRepPatch>;

export const importBatchPatch = z.object({
  fileHash: required(),
  fileName: text(),
  type: required(),
  exporterVersion: text(),
  schemaVersion: text(),
  rowCount: z.number().int().optional(),
  mapping: doc(),
  counts: doc(),
  status: required(),
  committedAt: text(),
  isWeb: flag(),
});

export const IMPORT_BATCH_REQUIRED = ['fileHash', 'type'] as const;

/**
 * The readiness gate's neuromuscular test (`house.sc.readiness_gate`).
 *
 * The attempts travel as they were logged and `best` beside them, because the
 * phone has already decided which attempt the day's number is and the server
 * must not re-decide it from a different rounding.
 */
export const readinessTestPatch = z.object({
  athleteId: required(),
  localDate: required(),
  kind: required(),
  metric: text(),
  attempts: doc(),
  best: decimal(),
  unit: text(),
  whoopRecoverySnapshot: doc(),
  entrySource: required(),
  createdAt: text(),
});

/** A test cannot be filed without the day it was taken and the test it was. */
export const READINESS_TEST_REQUIRED = ['localDate', 'kind'] as const;

/** What the gate did to one session. Downward only; the phone decided it. */
export const readinessOutcomePatch = z.object({
  localDate: required(),
  state: required(),
  channels: doc(),
  adjustment: doc(),
  line: text(),
  houseRuleId: text(),
  appliedAt: text(),
});

export const READINESS_OUTCOME_REQUIRED = ['localDate', 'state'] as const;

export const whoopLinkPayload = z.object({
  whoopWorkoutId: z.string(),
  matchSource: z.enum(['auto', 'manual']).default('auto'),
  overlapS: z.number().int().nonnegative().default(0),
  linkedAt: z.string().optional(),
});

/** `workingMax.set` merges one lift into the athlete's working_max document. */
export const workingMaxPayload = jsonValue;
