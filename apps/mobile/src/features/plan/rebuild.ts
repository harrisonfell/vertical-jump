import {
  GenerationBlockedError,
  ObservedWeekError,
  RULESET_V1,
  WeekInvariantError,
  loadExercises,
  projectWeeks,
} from '@vert/engine';
import type {
  Athlete as EngineAthlete,
  PlanSkeleton,
  PreviousWeekContext,
  WeekPlan,
} from '@vert/engine';
import { nowIso, programStore, revisionStore, sessionStore, syncStore } from '@/data';
import type { Json, LocalDate, Program, SessionWithStatus, SqlExecutor, Week } from '@/data';
import { IncompleteProfileError } from '@/lib/engineAthlete';
import { writeWeekPlan } from '../setup/writeProgram';
import { toObservedWeeks, weekHasWork, type ObservedWeekSource } from './revise';

/**
 * Rebuilding a run of unstarted weeks from a plan and from what the athlete has
 * actually logged.
 *
 * Two callers share every line of this. A revision rebuilds from the plan the
 * program already holds, because a real week has been logged and the weeks
 * after it are now a better guess. A settings regeneration rebuilds from a plan
 * re-made out of the athlete's new answers, because the answers the old weeks
 * were built from no longer describe the athlete. What happens to the rows is
 * identical, and writing it twice is how the two paths would drift.
 *
 * The weeks before `fromWeek` are handed to the engine as observed history and
 * are never written to. The weeks from `fromWeek` on are deleted and written
 * again from the new projection, one week per transaction, so a process killed
 * mid-rebuild never leaves a week holding its old snapshot beside new sessions.
 *
 * Nothing is written when the engine refuses. A rule that fails mid-projection
 * throws before the first delete, and the refusal is surfaced as the engine's
 * own sentence.
 */

/** The engine's own error, kept as the sentence it wrote. */
export class RevisionFailedError extends Error {
  readonly sentence: string;

  constructor(sentence: string) {
    super(sentence);
    this.name = 'RevisionFailedError';
    this.sentence = sentence;
  }
}

/**
 * Whatever refused, said in the words it refused with.
 *
 * The fallback is only reached by a throw that is not an `Error` at all, which
 * no path in the engine does; it exists so the caller never shows an empty
 * sentence.
 */
export function refusalSentence(caught: unknown, fallback: string): string {
  if (caught instanceof ObservedWeekError) return caught.sentence;
  if (caught instanceof WeekInvariantError) return caught.message;
  if (caught instanceof GenerationBlockedError) return caught.message;
  if (caught instanceof IncompleteProfileError) return caught.message;
  if (caught instanceof Error) return caught.message;
  return fallback;
}

/* ------------------------------------------------------------- the write */

/**
 * One week, replaced: its old sessions go, then the build's own week writer
 * puts the new week row and its sessions down.
 *
 * The whole week is one transaction, so a process killed mid-rebuild never
 * leaves a week holding its old snapshot beside new sessions. Deleting first
 * is this caller's job: `writeWeekPlan` only ever inserts.
 *
 * Exported for the backfill, which writes the same way and calls the weeks it
 * writes 'projection' rather than 'revision'.
 */
export async function writeReplacedWeek(
  db: SqlExecutor,
  program: Program,
  versionId: string | null,
  plan: WeekPlan,
  existing: Week | undefined,
  generatedBy: 'revision' | 'projection' = 'revision',
): Promise<void> {
  const generatedAt = nowIso();
  await db.withTransactionAsync(async () => {
    if (existing !== undefined) await revisionStore.deleteWeekSessions(db, existing.id);
    const weekId = await writeWeekPlan(db, {
      programId: program.id,
      programVersionId: versionId,
      plan,
      generatedBy,
      generatedAt,
    });
    // `week.generated` already exists as an op kind. Sessions need none: the
    // whole database file reaches the server through /api/snapshot, exactly as
    // it does for the first build.
    await syncStore.enqueue(db, {
      kind: 'week.generated',
      entityId: weekId,
      payload: { w: plan.w, generatedBy },
    });
  });
}

/**
 * The week sequence, as a string that changes when the calendar does.
 *
 * A projection that only moved targets leaves this identical, which is the
 * ordinary case and the one design decision 6 is about: the Plan's calendar
 * stays the planned one. Two things do move it. A folded week judged a repeat
 * makes the engine clone that week and pay for the clone out of a later load
 * week or the taper. And a settings regeneration hands the rebuild a skeleton
 * planned from new answers, where the days of the week themselves may differ,
 * which is why the session days are part of the comparison.
 */
function calendarShape(skeleton: PlanSkeleton): string {
  return JSON.stringify(
    skeleton.weeks.map((week) => [
      week.w,
      week.kind,
      week.blockType,
      week.windowStart,
      week.windowEnd,
      week.repeatOfWeek ?? null,
      week.sessions.map((session) => [session.dayIndex, session.weekday]),
    ]),
  );
}

/**
 * Put the calendar back in step with the skeleton the rebuild ended on.
 *
 * Two rows go stale together when a repeat is absorbed, and both are written
 * once by the build and never again: `program.snapshot`, which the Plan reads
 * for its week bands and the next revision reads as the plan to project from,
 * and the `block` table, which the Plan reads for the band a week sits in.
 * Leaving them behind would draw the old bands over the new weeks and, worse,
 * hand the next revision a skeleton in which the repeat never happened.
 *
 * Nothing is written when the sequence did not move, so a run of ordinary
 * revisions touches neither row.
 */
async function writeCalendar(
  db: SqlExecutor,
  programId: string,
  before: PlanSkeleton | null,
  after: PlanSkeleton,
): Promise<void> {
  // `before` is what the program currently *stores*, not what this rebuild
  // projected from. The two differ after a settings regeneration, whose
  // skeleton is planned from answers the snapshot has never seen, and that is
  // exactly the case where the snapshot has to be brought forward.
  if (before !== null && calendarShape(before) === calendarShape(after)) return;
  await db.withTransactionAsync(async () => {
    await revisionStore.updateProgramSnapshot(db, programId, after as unknown as Json);
    await revisionStore.replaceBlocks(
      db,
      programId,
      after.blocks.map((block, index) => ({
        type: block.type,
        orderIndex: index,
        weekStart: block.weekFrom,
        weekEnd: block.weekTo,
      })),
    );
  });
}

/* -------------------------------------------------------------- the read */

export interface WeekFacts {
  readonly row: Week;
  readonly sessions: SessionWithStatus[];
  readonly loggedSets: number;
  /** Sessions the athlete has opened or finished. */
  readonly startedSessions: number;
}

export async function readWeekFacts(
  db: SqlExecutor,
  programId: string,
  today: LocalDate,
): Promise<WeekFacts[]> {
  const rows = await programStore.listWeeks(db, programId);
  const facts: WeekFacts[] = [];
  for (const row of rows) {
    const sessions = await sessionStore.listSessionsByWeek(db, row.id, today);
    const loggedSets = sessions.reduce((total, session) => total + session.loggedSetCount, 0);
    const startedSessions = sessions.filter(
      (session) => session.startedAt !== null || session.markedCompleteAt !== null,
    ).length;
    facts.push({ row, sessions, loggedSets, startedSessions });
  }
  return facts;
}

/** Weeks 1 to `fromWeek - 1` as the engine's fold reads them. */
export async function readObserved(
  db: SqlExecutor,
  facts: readonly WeekFacts[],
  fromWeek: number,
): Promise<PreviousWeekContext[]> {
  const sources: ObservedWeekSource[] = [];
  for (const fact of facts) {
    if (fact.row.w >= fromWeek) continue;
    sources.push({
      w: fact.row.w,
      snapshot: fact.row.snapshot,
      sessions: fact.sessions,
      logs: await revisionStore.listWeekEngineLogs(db, fact.row.id),
    });
  }
  return toObservedWeeks(sources);
}

/* ----------------------------------------------------------- the rebuild */

export interface RebuildInput {
  /** The athlete as the engine reads them **now**, new answers and all. */
  readonly athlete: EngineAthlete;
  readonly program: Program;
  readonly today: LocalDate;
  /** The first week that may be rewritten. Everything below it is evidence. */
  readonly fromWeek: number;
  /** The plan to project from. Never mutated. */
  readonly skeleton: PlanSkeleton;
  /**
   * What `program.snapshot` holds right now, so the calendar is only rewritten
   * when the week sequence actually moved. Null forces the write.
   */
  readonly stored: PlanSkeleton | null;
  /** The version row the rebuilt weeks point at. */
  readonly versionId: string | null;
  /**
   * What the week rows call themselves. Both values mean "written ahead of the
   * athlete reaching it" to `isProjectedWeek`; 'revision' is the honest one for
   * a rebuild that folded real outcomes in, which both callers here do.
   */
  readonly generatedBy?: 'revision' | 'projection';
  /** Week facts the caller has already read, so nothing is read twice. */
  readonly facts?: readonly WeekFacts[];
}

export interface RebuildResult {
  /** The weeks actually rebuilt, in order. Empty when there was nothing to do. */
  readonly rebuiltWeeks: number[];
  /** Those weeks as the engine planned them, for the version row's layout. */
  readonly weeks: readonly WeekPlan[];
  /**
   * The skeleton the projection ended on, which is what `program.snapshot` now
   * holds. Equal to the input skeleton unless an absorbed repeat moved it.
   */
  readonly skeleton: PlanSkeleton;
}

/**
 * Rebuild `fromWeek` to the end of the program, and return what was written.
 *
 * Writes no version row: the caller owns that, because the two callers order it
 * differently for the same reason. A revision reserves the id, writes the weeks
 * and records the row last, so a write that dies halfway leaves nothing claiming
 * the rebuild finished. A regeneration does the same, and stores the skeleton
 * this returns rather than the one it planned, so the next revision reads the
 * plan the rebuild actually ended on.
 */
export async function rebuildFromWeek(
  db: SqlExecutor,
  input: RebuildInput,
): Promise<RebuildResult> {
  const seed = Number.parseInt(input.program.seed, 10);
  if (!Number.isFinite(seed)) {
    throw new RevisionFailedError('This program has no readable seed, so it cannot be rebuilt.');
  }

  const facts = input.facts ?? (await readWeekFacts(db, input.program.id, input.today));
  const nothing: RebuildResult = { rebuiltWeeks: [], weeks: [], skeleton: input.skeleton };

  // The guard, before anything is written: the run of weeks from `fromWeek`
  // that nothing has been logged into. By construction of `fromWeek` this is
  // every week from there on, but a week that somehow carries work stops the
  // rebuild at itself rather than being rewritten under the athlete.
  const rebuildable: number[] = [];
  for (const fact of facts) {
    if (fact.row.w < input.fromWeek) continue;
    if (weekHasWork(fact.sessions)) break;
    rebuildable.push(fact.row.w);
  }
  if (rebuildable.length === 0) return nothing;
  // Clamped to the skeleton being projected from: a regenerated skeleton may
  // be shorter than the week rows the old one left behind, and asking the
  // chain for a week the skeleton does not have would throw.
  const lastRebuildable = Math.min(
    rebuildable[rebuildable.length - 1] ?? input.fromWeek,
    input.skeleton.W,
  );
  if (lastRebuildable < input.fromWeek) return nothing;

  let projected;
  try {
    const observed = await readObserved(db, facts, input.fromWeek);
    const { exercises, ladders } = loadExercises();
    // No `generatedAt`. One instant would become the `asOf` for every
    // projected week, and `bestEpley` drops any log dated after it, so no
    // projected week would see the week before it. Each week freezes at its
    // own window start instead; the real instant belongs on the row's
    // `generated_at` column, which `writeReplacedWeek` sets.
    projected = projectWeeks({
      athlete: input.athlete,
      ruleset: RULESET_V1,
      exercises,
      ladders,
      skeleton: input.skeleton,
      seed,
      today: input.today,
      fromWeek: input.fromWeek,
      toWeek: lastRebuildable,
      observed,
      workingMaxes: input.athlete.workingMaxes,
    });
  } catch (caught) {
    throw new RevisionFailedError(refusalSentence(caught, 'The plan could not be rebuilt.'));
  }

  const byWeek = new Map(facts.map((fact) => [fact.row.w, fact.row]));
  const rebuiltWeeks: number[] = [];
  for (const plan of projected.weeks) {
    await writeReplacedWeek(
      db,
      input.program,
      input.versionId,
      plan,
      byWeek.get(plan.w),
      input.generatedBy ?? 'revision',
    );
    rebuiltWeeks.push(plan.w);
  }

  await writeCalendar(db, input.program.id, input.stored, projected.skeleton);

  return { rebuiltWeeks, weeks: projected.weeks, skeleton: projected.skeleton };
}

/**
 * The layout a version row stores for the weeks a rebuild wrote.
 *
 * It keeps the array shape `createProgram` writes, because `versionSpan` reads
 * the first entry's `windowStart` and the last entry's `windowEnd` and returns
 * null for anything that is not an array. Store an object here and the version
 * history quietly loses its "9 weeks, Mon 28 Sep to Sat 29 Nov" line.
 */
export function weekLayoutFor(
  weeks: readonly WeekPlan[],
): { w: number; kind: string; blockType: string; windowStart: string; windowEnd: string; k: number }[] {
  return weeks.map((plan) => ({
    w: plan.w,
    kind: plan.kind,
    blockType: plan.blockType,
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd,
    k: plan.snapshot.k,
  }));
}
