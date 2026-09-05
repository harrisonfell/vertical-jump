import type {
  ReadinessOutcome as EngineReadinessOutcome,
  SessionExercise as PlanExercise,
  SessionPlan,
  SessionWindow,
  SetPrescription,
  WallWork,
} from '@vert/engine';
import {
  READINESS_TRIM_REASON,
  RULESET_V1,
  applyReadinessAdjustment,
  applySorenessReduction,
  readinessSuffixFor,
} from '@vert/engine';
import type { SessionExercise as ExerciseRow } from '@/data';
import { blockLabel, blockOrder, isGroupedBlock } from './blocks';
import { FINGER_TRIM_REASON, exerciseIndex, removeHardFingerRows } from './climbing';
import { climbCaptions, isRepCountedRow, isRntRow, medBallLine, usesMedBall } from './climbRows';
import { isNoOpAdjustment } from './readinessModel';
import { upperPowerWindowLine } from '../plan/climbLines';

/**
 * One session, as the runner needs it.
 *
 * Two sources are merged. The stored rows carry the identity a set log points
 * at (`session_exercise.id`) and are the only thing that survives a schema the
 * engine does not own. The session's snapshot carries what a column dropped:
 * the landing prompt, contacts per rep, the box height, the cues behind the
 * Video control, and the block's own placement order. Neither alone is enough,
 * so the merge is keyed on block plus exercise id, which is exactly how the
 * rows were written.
 */

export interface TodayExercise {
  /** The `session_exercise` row id. Set logs are written against this. */
  readonly id: string;
  readonly exerciseId: string;
  readonly name: string;
  readonly block: string;
  readonly loadType: string;
  readonly loadMode: string;
  readonly bothSides: boolean;
  readonly rotationNote: string | null;
  readonly headerNote: string | null;
  readonly lastTimeNote: string | null;
  readonly isNewThisWeek: boolean;
  readonly restS: number;
  readonly restRule: string;
  readonly sets: readonly SetPrescription[];
  /** The last set of a height ladder asks how the landing felt. */
  readonly landingPromptOnLastSet: boolean;
  /** House convention: every landing counts. 0 for a row off the budget. */
  readonly contactsPerRep: number;
  readonly cues: readonly string[];
  readonly boxHeightIn: number | null;
  /** Set on a height-ladder exercise: the rung the Finish flow may advance. */
  readonly ladderId: string | null;
  /**
   * The climbing captions, already in their order: "Open hand only",
   * "Weaker side first: left", "Alignment: stop the set when the knee drifts".
   */
  readonly captions: readonly string[];
  /** True when the row is counted in repetitions rather than in bodyweight. */
  readonly repCounted: boolean;
  /** The muted second line every set of this row carries: "6 lb ball". */
  readonly rowNote: string | null;
}

export interface TodayBlock {
  readonly name: string;
  readonly label: string;
  readonly grouped: boolean;
  readonly exercises: readonly TodayExercise[];
}

export interface TodaySession {
  readonly blocks: readonly TodayBlock[];
  readonly notices: readonly string[];
  readonly headerSuffixes: readonly string[];
  readonly estimatedMinutes: number | null;
  readonly contacts: SessionContactsView | null;
  readonly trimmed: readonly { readonly name: string; readonly reason: string }[];
  readonly isTestDay: boolean;
}

export interface SessionContactsView {
  readonly extensive: number;
  readonly highIntensity: number;
  readonly targetExtensive: number;
  readonly capHigh: number;
}

/* --------------------------------------------------------------- parsing */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * The stored SessionPlan, or null when a session predates snapshots. The check
 * is structural on purpose: the snapshot is our own write, and a deep validator
 * here would be a second copy of the engine's types that can drift from them.
 */
export function readSessionPlan(value: unknown): SessionPlan | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value['blocks'])) return null;
  if (typeof value['dayType'] !== 'string') return null;
  return value as unknown as SessionPlan;
}

function readSets(perSet: unknown): SetPrescription[] {
  if (!Array.isArray(perSet)) return [];
  return perSet.filter(isRecord).map((entry) => entry as unknown as SetPrescription);
}

/* ---------------------------------------------------------------- merge */

interface PlanExtras {
  readonly landingPromptOnLastSet: boolean;
  readonly contactsPerRep: number;
  readonly cues: readonly string[];
  readonly boxHeightIn: number | null;
  readonly ladderId: string | null;
  readonly grouped: boolean;
  readonly order: number;
  readonly sideNote: string | null;
  readonly fingerNote: string | null;
}

/** The join key the rows were written under: block plus exercise. */
function keyOf(blockName: string, exerciseId: string): string {
  return `${blockName}::${exerciseId}`;
}

function extrasByKey(plan: SessionPlan | null): Map<string, PlanExtras> {
  const map = new Map<string, PlanExtras>();
  if (plan === null) return map;
  plan.blocks.forEach((block, blockIndex) => {
    for (const row of block.exercises) {
      map.set(keyOf(block.name, row.exerciseId), {
        landingPromptOnLastSet: row.landingPromptOnLastSet === true,
        contactsPerRep: typeof row.contactsPerRep === 'number' ? row.contactsPerRep : 0,
        cues: Array.isArray(row.cues) ? row.cues : [],
        boxHeightIn: typeof row.boxHeightIn === 'number' ? row.boxHeightIn : null,
        ladderId: typeof row.ladderId === 'string' ? row.ladderId : null,
        grouped: block.grouped === true,
        order: blockIndex,
        sideNote: typeof row.sideNote === 'string' ? row.sideNote : null,
        fingerNote: typeof row.fingerNote === 'string' ? row.fingerNote : null,
      });
    }
  });
  return map;
}

export interface MergeOptions {
  /** R27: 7 or higher runs the whole session one tier down before any tap. */
  readonly sorenessPre?: number | null;
  /**
   * House `house.sc.readiness_gate`: today's gate answer, applied through the
   * engine. Downward only, today only, undone by changing the answer.
   */
  readonly readiness?: EngineReadinessOutcome | null;
  /** House `house.sc.finger_pain_ceiling`: today's 0 to 10 answer. */
  readonly fingerPain?: number | null;
  /** The ceiling that answer is measured against. Both or neither. */
  readonly fingerPainCeiling?: number | null;
  /** R162: the smallest load step, so a readiness cut lands on the grid. */
  readonly stepLb?: number;
  /** The med ball's weight, when the inventory names one. */
  readonly medBallLb?: number | null;
  /**
   * The two windows behind the upper-power placement
   * (`house.sc.sport_requirements`). With both on file the session says which
   * day it landed on and why; without them it says nothing.
   */
  readonly wallWork?: WallWork | null;
  readonly sessionWindow?: SessionWindow | null;
}

/* ------------------------------------------------- today's own answers */

const NO_KEYS: ReadonlySet<string> = new Set<string>();
const NO_SETS: ReadonlyMap<string, SetPrescription[]> = new Map<string, SetPrescription[]>();

interface Adjusted {
  readonly plan: SessionPlan | null;
  /** Rows an answer removed from today's session, by join key. */
  readonly dropped: ReadonlySet<string>;
  /** Rows whose sets an answer changed, by join key. */
  readonly changed: ReadonlyMap<string, SetPrescription[]>;
  /** "· Readiness: one tier down", when the gate changed the day. */
  readonly suffix: string | null;
}

/**
 * The stored session as it was before the gate touched it.
 *
 * A snapshot the generator itself reduced cannot be put back: removing a row
 * is not reversible from what is left, so this returns null there and the day
 * keeps the reduction it was built with rather than taking a second one. A
 * snapshot that only carries the gate's line is restored exactly.
 */
function withoutReadiness(plan: SessionPlan): SessionPlan | null {
  const stored = plan.readiness;
  if (stored === undefined) return plan;
  if (!isNoOpAdjustment(stored.adjustment)) return null;
  const next: SessionPlan = {
    ...plan,
    notices: plan.notices.filter((line) => line !== stored.line),
    trimmed: plan.trimmed.filter((entry) => entry.reason !== READINESS_TRIM_REASON),
  };
  delete next.readiness;
  return next;
}

function rowsByKey(plan: SessionPlan): Map<string, PlanExercise> {
  const map = new Map<string, PlanExercise>();
  for (const block of plan.blocks) {
    for (const row of block.exercises) map.set(keyOf(block.name, row.exerciseId), row);
  }
  return map;
}

/**
 * The two answers the runner asks for, applied to the stored session through
 * the engine: the finger ceiling first, because it removes rows, then the
 * readiness gate, which reduces what is left.
 */
function adjustPlan(plan: SessionPlan | null, options: MergeOptions): Adjusted {
  if (plan === null) return { plan: null, dropped: NO_KEYS, changed: NO_SETS, suffix: null };

  const byId = exerciseIndex();
  let next = plan;

  const finger = options.fingerPain ?? null;
  const ceiling = options.fingerPainCeiling ?? null;
  if (finger !== null && ceiling !== null) {
    next = removeHardFingerRows(next, finger, ceiling, byId);
  }

  const outcome = options.readiness ?? null;
  let suffix: string | null =
    next.readiness === undefined ? null : (readinessSuffixFor(next.readiness) ?? null);

  if (outcome !== null) {
    const base = withoutReadiness(next);
    if (base !== null) {
      next = applyReadinessAdjustment(base, outcome, {
        exercisesById: byId,
        ...(options.stepLb === undefined ? null : { stepLb: options.stepLb }),
      });
      suffix = readinessSuffixFor(outcome) ?? null;
    }
  }

  if (next === plan) return { plan, dropped: NO_KEYS, changed: NO_SETS, suffix };

  const before = rowsByKey(plan);
  const after = rowsByKey(next);
  const dropped = new Set<string>();
  for (const key of before.keys()) if (!after.has(key)) dropped.add(key);
  const changed = new Map<string, SetPrescription[]>();
  for (const [key, row] of after) {
    const original = before.get(key);
    if (original !== undefined && original.sets !== row.sets) changed.set(key, row.sets);
  }
  return { plan: next, dropped, changed, suffix };
}

/**
 * The rows and the snapshot, joined into blocks in the engine's own order.
 *
 * The three answers the athlete gives before the first set are applied here,
 * each through the engine, so every reduced row carries its unreduced
 * prescription in `original`: soreness at 7 or higher (R27), the finger
 * ceiling (`house.sc.finger_pain_ceiling`), and the readiness gate
 * (`house.sc.readiness_gate`). None of them is ever written back to the
 * snapshot, which is what lets a changed answer undo itself.
 */
export function buildTodaySession(
  rows: readonly ExerciseRow[],
  snapshot: unknown,
  options: MergeOptions = {},
): TodaySession {
  const stored = readSessionPlan(snapshot);
  const adjusted = adjustPlan(stored, options);
  const plan = adjusted.plan;
  const extras = extrasByKey(plan);
  const byId = exerciseIndex();
  const soreness = options.sorenessPre ?? null;
  const { repsAdd, percentDrop, threshold } = RULESET_V1.constants.soreness;

  const grouping = new Map<string, TodayExercise[]>();
  const blockRank = new Map<string, number>();

  for (const row of [...rows].sort((a, b) => a.orderIndex - b.orderIndex)) {
    const block = row.block ?? 'accessory';
    const key = keyOf(block, row.exerciseId);
    // Today's answers removed this row, so it is not a row the athlete may log.
    if (adjusted.dropped.has(key)) continue;
    const extra = extras.get(key);
    const seeded = byId.get(row.exerciseId);
    const sets = applySorenessReduction(
      adjusted.changed.get(key) ?? readSets(row.perSet),
      soreness,
      repsAdd,
      percentDrop,
      { threshold },
    );

    const exercise: TodayExercise = {
      id: row.id,
      exerciseId: row.exerciseId,
      name: row.exerciseName,
      block,
      loadType: row.loadType,
      loadMode: row.loadMode,
      bothSides: row.bothSides,
      rotationNote: row.rotationNote,
      headerNote: row.headerNote,
      lastTimeNote: row.lastTimeNote,
      isNewThisWeek: row.isNewThisWeek,
      restS: row.restS ?? 0,
      restRule: row.restRule ?? '',
      sets,
      landingPromptOnLastSet: extra?.landingPromptOnLastSet ?? false,
      contactsPerRep: extra?.contactsPerRep ?? 0,
      cues: extra?.cues ?? [],
      boxHeightIn: extra?.boxHeightIn ?? null,
      ladderId: extra?.ladderId ?? null,
      captions: climbCaptions({
        fingerNote: extra?.fingerNote ?? null,
        sideNote: extra?.sideNote ?? null,
        isRnt: isRntRow(seeded),
      }),
      repCounted: isRepCountedRow(seeded),
      rowNote: usesMedBall(seeded) ? medBallLine(options.medBallLb) : null,
    };

    const bucket = grouping.get(block);
    if (bucket === undefined) grouping.set(block, [exercise]);
    else bucket.push(exercise);

    if (!blockRank.has(block)) blockRank.set(block, extra?.order ?? blockOrder(block));
  }

  const blocks: TodayBlock[] = [...grouping.entries()]
    .sort((a, b) => (blockRank.get(a[0]) ?? 0) - (blockRank.get(b[0]) ?? 0))
    .map(([name, exercises]) => ({
      name,
      label: blockLabel(name),
      grouped: isGroupedBlock(name),
      exercises,
    }));

  const contacts = plan === null ? null : readContacts(plan);
  const suffixes = plan === null ? [] : stringArray(plan.headerSuffixes);
  if (adjusted.suffix !== null && !suffixes.includes(adjusted.suffix)) suffixes.push(adjusted.suffix);

  const placement = upperPowerWindowLine({
    wallWork: options.wallWork ?? null,
    sessionWindow: options.sessionWindow ?? null,
    weekday: plan?.weekday ?? -1,
    sessionIntent: plan?.sessionIntent,
  });
  // D-47: the readiness verdict already has a home in the Readiness row, so
  // the Notice under the cards is a repeat of it unless the gate actually
  // changed the day. It stays for a tier down or a held volume, because that
  // is news about the session rather than a reading.
  const readiness = plan?.readiness;
  const repeated =
    readiness === undefined || !isNoOpAdjustment(readiness.adjustment) ? null : readiness.line;
  const notices = (plan === null ? [] : stringArray(plan.notices)).filter(
    (line) => line !== repeated,
  );
  if (placement !== null && !notices.includes(placement)) notices.push(placement);

  return {
    blocks,
    notices,
    headerSuffixes: suffixes,
    estimatedMinutes:
      plan !== null && typeof plan.estimatedMinutes === 'number' ? plan.estimatedMinutes : null,
    contacts,
    trimmed: readTrimmed(plan, rows),
    isTestDay: plan?.isTestDay === true,
  };
}

function readContacts(plan: SessionPlan): SessionContactsView | null {
  const raw: unknown = plan.contacts;
  if (!isRecord(raw)) return null;
  const number = (key: string): number => (typeof raw[key] === 'number' ? raw[key] : 0);
  return {
    extensive: number('extensive'),
    highIntensity: number('highIntensity'),
    targetExtensive: number('targetExtensive'),
    capHigh: number('capHigh'),
  };
}

/** The two removals today's own answers make, each explained by its own notice. */
const ANSWERED_TRIMS: ReadonlySet<string> = new Set([READINESS_TRIM_REASON, FINGER_TRIM_REASON]);

function readTrimmed(
  plan: SessionPlan | null,
  rows: readonly ExerciseRow[],
): { name: string; reason: string }[] {
  if (plan === null || !Array.isArray(plan.trimmed)) return [];
  const names = new Map(rows.map((row) => [row.exerciseId, row.exerciseName]));
  return plan.trimmed
    .filter(isRecord)
    .filter((entry) => !ANSWERED_TRIMS.has(typeof entry['reason'] === 'string' ? entry['reason'] : ''))
    .map((entry) => {
      const id = typeof entry['exerciseId'] === 'string' ? entry['exerciseId'] : '';
      return {
        name: names.get(id) ?? id,
        reason: typeof entry['reason'] === 'string' ? entry['reason'] : '',
      };
    })
    .filter((entry) => entry.name !== '');
}

/* ------------------------------------------------------------- counting */

/** Sets prescribed across every block that carries loggable rows. */
export function plannedSetCount(session: TodaySession): number {
  return session.blocks.reduce(
    (total, block) =>
      total + block.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    0,
  );
}

/** Every loggable exercise, in the order the athlete meets them. */
export function flattenExercises(session: TodaySession): TodayExercise[] {
  return session.blocks.flatMap((block) => [...block.exercises]);
}
