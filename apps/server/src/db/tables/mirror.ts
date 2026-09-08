/**
 * The server's copy of the phone's own tables.
 *
 * Column names are the phone's, verbatim from apps/mobile/src/data/sql, so a
 * pushed op applies field for field and an export built here matches an export
 * built there. Anything the engine owns (plan skeletons, week plans, per-set
 * prescriptions, snapshots) stays a JSON snapshot, so this schema never has to
 * move when the engine's internals do. Timestamps here are the phone's ISO
 * strings kept verbatim as text; only server-owned ordering columns are real
 * timestamps, and those live in account.ts and whoop.ts.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Json } from '../../lib/api-contract';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const athlete = pgTable('athlete', {
  id: text('id').primaryKey(),
  primaryGoal: text('primary_goal'),
  sport: text('sport'),
  trainingAgeYears: real('training_age_years'),
  level: text('level'),
  daysPerWeek: integer('days_per_week'),
  weekdays: jsonb('weekdays').$type<Json>(),
  isAdult: boolean('is_adult').notNull().default(true),
  clearance: jsonb('clearance').$type<Json>(),
  inventory: jsonb('inventory').$type<Json>(),
  weightRoomAccess: boolean('weight_room_access').notNull().default(false),
  bodyweightKg: real('bodyweight_kg'),
  workingMax: jsonb('working_max').$type<Json>(),
  inSeason: boolean('in_season').notNull().default(false),
  readinessPassedAt: text('readiness_passed_at'),
  standingReachMm: integer('standing_reach_mm'),
  goalHeightMm: integer('goal_height_mm'),
  targetDate: text('target_date'),
  timezone: text('timezone').notNull().default('UTC'),
  rolloverHour: integer('rollover_hour').notNull().default(0),
  testConditionsNote: text('test_conditions_note'),
  /*
   * The climbing answers (`house.sc.*`), all nullable: an athlete who was
   * never asked has none of them, and a phone a build behind never sends them.
   */
  secondaryGoal: text('secondary_goal'),
  fingerHistory: boolean('finger_history').notNull().default(false),
  gripMode: text('grip_mode'),
  fingerPainCeiling: integer('finger_pain_ceiling'),
  wallWork: jsonb('wall_work_json').$type<Json>(),
  sessionWindow: jsonb('session_window_json').$type<Json>(),
  valgusControl: jsonb('valgus_control_json').$type<Json>(),
  weakerSide: text('weaker_side'),
  readinessConfig: jsonb('readiness_config_json').$type<Json>(),
  /**
   * `{ box_squat: { reps, loadKg, rpe?, at } }`: the best recent set the
   * athlete typed per lift, which R73 estimates the working max from. Additive
   * and nullable, like every climbing column above it.
   */
  bestSets: jsonb('best_sets_json').$type<Json>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  serverUpdatedAt: at('server_updated_at').notNull(),
});

export const painStatus = pgTable(
  'pain_status',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    location: text('location').notNull(),
    severityRaw: integer('severity_raw').notNull(),
    severityDerived: text('severity_derived').notNull(),
    onset: text('onset').notNull(),
    durationWeeks: real('duration_weeks'),
    houseRule: boolean('house_rule').notNull().default(false),
    note: text('note'),
    reportedAt: text('reported_at').notNull(),
    reassessDueAt: text('reassess_due_at'),
    clearedAt: text('cleared_at'),
  },
  (table) => [index('pain_status_open').on(table.athleteId, table.clearedAt, table.reportedAt)],
);

export const program = pgTable(
  'program',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    macroIndex: integer('macro_index').notNull().default(1),
    parentProgramId: text('parent_program_id'),
    /**
     * Nullable because the phone's `program.create` op carries the dates and
     * the seed and nothing else. A column the phone never sends cannot be a
     * NOT NULL here, or the whole program silently fails to land.
     */
    rulesetVersion: text('ruleset_version'),
    seed: text('seed').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status').notNull().default('active'),
    snapshot: jsonb('snapshot').$type<Json>(),
    validationReport: jsonb('validation_report').$type<Json>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('program_current').on(table.athleteId, table.status, table.startDate)],
);

export const programVersion = pgTable(
  'program_version',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull(),
    version: integer('version').notNull(),
    weekLayout: jsonb('week_layout').$type<Json>().notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('program_version_unique').on(table.programId, table.version)],
);

export const block = pgTable(
  'block',
  {
    id: text('id').primaryKey(),
    programId: text('program_id').notNull(),
    type: text('type').notNull(),
    orderIndex: integer('order_index').notNull(),
    weekStart: integer('week_start').notNull(),
    weekEnd: integer('week_end').notNull(),
  },
  (table) => [unique('block_order_unique').on(table.programId, table.orderIndex)],
);

export const week = pgTable(
  'week',
  {
    id: text('id').primaryKey(),
    /** Derived from the single live program when the phone does not name one. */
    programId: text('program_id'),
    programVersionId: text('program_version_id'),
    blockId: text('block_id'),
    /** The four below arrive with a later op or not at all: see program above. */
    w: integer('w'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    kind: text('kind'),
    k: integer('k'),
    prescribedCount: integer('prescribed_count').notNull().default(0),
    completedCount: integer('completed_count').notNull().default(0),
    adherencePct: real('adherence_pct'),
    allRepsCompleted: boolean('all_reps_completed'),
    outcome: text('outcome'),
    generatedAt: text('generated_at'),
    generatedBy: text('generated_by'),
    repeatOfWeek: integer('repeat_of_week'),
    jointHighStressCounts: jsonb('joint_high_stress_counts').$type<Json>(),
    highContactAllowance: integer('high_contact_allowance'),
    extensiveTarget: integer('extensive_target'),
    ladderRungs: jsonb('ladder_rungs').$type<Json>(),
    snapshot: jsonb('snapshot').$type<Json>(),
  },
  (table) => [
    unique('week_unique').on(table.programId, table.w),
    index('week_window').on(table.programId, table.windowStart),
  ],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    /** Derived from the single live program when the phone does not name one. */
    programId: text('program_id'),
    weekId: text('week_id'),
    scheduledDate: text('scheduled_date'),
    orderIndex: integer('order_index').notNull().default(0),
    dayType: text('day_type'),
    blocksPresent: jsonb('blocks_present').$type<Json>(),
    prescribedSetCount: integer('prescribed_set_count').notNull().default(0),
    dismissed: boolean('dismissed').notNull().default(false),
    testStatus: text('test_status'),
    sorenessPre: integer('soreness_pre'),
    rpe: real('rpe'),
    legsFeel: text('legs_feel'),
    notes: text('notes'),
    isMaximalCns: boolean('is_maximal_cns').notNull().default(false),
    trimmedExercises: jsonb('trimmed_exercises').$type<Json>(),
    appliedModifications: jsonb('applied_modifications').$type<Json>(),
    shadowModifications: jsonb('shadow_modifications').$type<Json>(),
    snapshot: jsonb('snapshot').$type<Json>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('session_by_week').on(table.weekId, table.orderIndex),
    index('session_by_date').on(table.programId, table.scheduledDate),
  ],
);

/** Start and finish are log events, never stamps: status is derived from these. */
export const sessionEvent = pgTable(
  'session_event',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull(),
    at: text('at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('session_event_by_session').on(table.sessionId, table.at)],
);

export const sessionExercise = pgTable(
  'session_exercise',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    orderIndex: integer('order_index').notNull(),
    exerciseId: text('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    block: text('block'),
    loadType: text('load_type').notNull(),
    loadMode: text('load_mode').notNull().default('entered'),
    bothSides: boolean('both_sides').notNull().default(false),
    rotationNote: text('rotation_note'),
    headerNote: text('header_note'),
    lastTimeNote: text('last_time_note'),
    isNewThisWeek: boolean('is_new_this_week').notNull().default(false),
    restS: integer('rest_s'),
    restRule: text('rest_rule'),
    /** The per-set prescription, stored verbatim from the engine. */
    perSet: jsonb('per_set').$type<Json>().notNull(),
  },
  (table) => [index('session_exercise_order').on(table.sessionId, table.orderIndex)],
);

export const setLog = pgTable(
  'set_log',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    sessionExerciseId: text('session_exercise_id').notNull(),
    setNumber: integer('set_number').notNull(),
    repsDone: integer('reps_done'),
    loadKg: real('load_kg'),
    durationS: real('duration_s'),
    distanceM: real('distance_m'),
    boxHeightMm: integer('box_height_mm'),
    landing: text('landing'),
    rpe: real('rpe'),
    /** Which leg or arm ran the set; NULL is a set logged for both at once. */
    side: text('side'),
    meanVelocityBest: real('mean_velocity_best'),
    meanVelocityLast: real('mean_velocity_last'),
    velocityLossPct: real('velocity_loss_pct'),
    loadSource: text('load_source'),
    entrySource: text('entry_source').notNull().default('typed'),
    completedAt: text('completed_at').notNull(),
    plannedDate: text('planned_date'),
    offsetDays: integer('offset_days').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    editedAt: text('edited_at'),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('set_log_by_session').on(table.sessionId, table.completedAt),
    // One row per set per side. Over `COALESCE(side, 'both')` rather than over
    // `side`, because Postgres counts NULLs as distinct in a unique index and a
    // bare `side` column would let two both-sides logs share a set number, which
    // is the duplicate this constraint exists to refuse.
    uniqueIndex('set_log_by_set').on(
      table.sessionExerciseId,
      table.setNumber,
      sql`coalesce(${table.side}, 'both')`,
    ),
  ],
);

export const jumpTestSession = pgTable(
  'jump_test_session',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    sessionId: text('session_id'),
    localDate: text('local_date').notNull(),
    performedAt: text('performed_at').notNull(),
    instrument: text('instrument').notNull(),
    mode: text('mode').notNull().default('cmj'),
    unitPreference: text('unit_preference').notNull().default('in'),
    boxHeightMm: integer('box_height_mm'),
    deviceFirmware: text('device_firmware'),
    connectVersion: text('connect_version'),
    isBaseline: boolean('is_baseline').notNull().default(false),
    canonical: boolean('canonical').notNull().default(true),
    scheduled: boolean('scheduled').notNull().default(true),
    bodyweightKg: real('bodyweight_kg'),
    whoopSnapshot: jsonb('whoop_snapshot').$type<Json>(),
    notes: text('notes'),
    importBatchId: text('import_batch_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('jump_test_stream').on(table.instrument, table.mode, table.canonical, table.localDate),
  ],
);

export const jumpRep = pgTable(
  'jump_rep',
  {
    id: text('id').primaryKey(),
    jumpTestSessionId: text('jump_test_session_id').notNull(),
    attemptIndex: integer('attempt_index').notNull(),
    heightMm: integer('height_mm'),
    gctMs: integer('gct_ms'),
    rsiCalc: real('rsi_calc'),
    rsiDevice: real('rsi_device'),
    flagged: boolean('flagged').notNull().default(false),
    rejectReason: text('reject_reason'),
    /** Set on a single-leg test, null on every other mode. */
    side: text('side'),
    entrySource: text('entry_source').notNull().default('typed'),
    importBatchId: text('import_batch_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [unique('jump_rep_attempt').on(table.jumpTestSessionId, table.attemptIndex)],
);

/**
 * The readiness gate's neuromuscular channel (`house.sc.readiness_gate`).
 *
 * One row a day per test kind on the phone; the same shape here, without the
 * uniqueness, because the server keys on the phone's own id and a replayed op
 * has to land on the row it landed on before.
 */
export const readinessTestSession = pgTable(
  'readiness_test_session',
  {
    id: text('id').primaryKey(),
    athleteId: text('athlete_id').notNull(),
    localDate: text('local_date').notNull(),
    kind: text('kind').notNull(),
    metric: text('metric'),
    /** Every attempt, in order. The best of them is the day's number. */
    attempts: jsonb('attempts_json').$type<Json>(),
    best: real('best'),
    unit: text('unit'),
    whoopRecoverySnapshot: jsonb('whoop_recovery_snapshot').$type<Json>(),
    entrySource: text('entry_source').notNull().default('typed'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('readiness_test_stream').on(table.athleteId, table.kind, table.localDate)],
);

/** What the gate did to one session, kept so an adjustment is auditable. */
export const readinessOutcome = pgTable(
  'readiness_outcome',
  {
    sessionId: text('session_id').primaryKey(),
    localDate: text('local_date').notNull(),
    state: text('state').notNull(),
    /** [autonomic, neuromuscular], in that fixed order. Never averaged. */
    channels: jsonb('channels_json').$type<Json>(),
    adjustment: jsonb('adjustment_json').$type<Json>(),
    line: text('line'),
    houseRuleId: text('house_rule_id'),
    appliedAt: text('applied_at'),
  },
  (table) => [index('readiness_outcome_day').on(table.localDate)],
);
