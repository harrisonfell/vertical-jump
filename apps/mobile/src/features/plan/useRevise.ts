import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  newId,
  nowIso,
  programStore,
  queryKeys,
  revisionStore,
  sessionStore,
  syncStore,
  useAthlete,
  useCurrentProgram,
  useDbOrNull,
  usePainStatus,
  useProgramVersions,
  useSessionsBetween,
  useToday,
  useWeeks,
} from '@/data';
import type { Json, LocalDate, Program, SessionWithStatus, SqlExecutor, Week } from '@/data';
import { IncompleteProfileError, toEngineAthlete } from '@/lib/engineAthlete';
import { baselineReading, useBaselineTest } from '../setup/useBaseline';
import { writeWeekPlan } from '../setup/writeProgram';
import { readSkeleton } from './engine';
import {
  regeneratedSkeleton,
  revisionReason,
  revisionTarget,
  toObservedWeeks,
  weekHasWork,
  type ObservedWeekSource,
  type RevisionTarget,
} from './revise';

/**
 * Rebuilding the unstarted weeks from what the athlete has actually logged.
 *
 * The weeks before `fromWeek` are handed to the engine as observed history and
 * are never written to. The weeks from `fromWeek` on are deleted and written
 * again from the new projection, one week per transaction, so a process killed
 * mid-revision never leaves a week holding its old snapshot beside new
 * sessions.
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

export interface ReviseInput {
  readonly athlete: EngineAthlete;
  readonly program: Program;
  readonly today: LocalDate;
}

export interface RevisionResult {
  /** The weeks actually rebuilt, in order. Empty for a no-op. */
  readonly revisedWeeks: readonly number[];
  readonly fromWeek: number | null;
  readonly observedThrough: number;
  /** Null when nothing was rebuilt, because a no-op writes no version row. */
  readonly versionNumber: number | null;
}

/* ------------------------------------------------------------- the write */

/**
 * One week, replaced: its old sessions go, then the build's own week writer
 * puts the new week row and its sessions down.
 *
 * The whole week is one transaction, so a process killed mid-revision never
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
 * week or the taper. And a settings regeneration hands the revision a skeleton
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
 * Put the calendar back in step with the skeleton the revision ended on.
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
  // `before` is what the program currently *stores*, not what this revision
  // projected from. The two differ after a settings regeneration, whose
  // skeleton lives only on a version row, and that is exactly the case where
  // the snapshot has to be brought forward.
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
    facts.push({ row, sessions, loggedSets });
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

/* ---------------------------------------------------------- the mutation */

/** Whatever refused, said in the words it refused with. */
function refusal(caught: unknown): RevisionFailedError {
  if (caught instanceof ObservedWeekError) return new RevisionFailedError(caught.sentence);
  if (caught instanceof WeekInvariantError) return new RevisionFailedError(caught.message);
  if (caught instanceof GenerationBlockedError) return new RevisionFailedError(caught.message);
  if (caught instanceof IncompleteProfileError) return new RevisionFailedError(caught.message);
  if (caught instanceof Error) return new RevisionFailedError(caught.message);
  return new RevisionFailedError('The plan could not be revised.');
}

const NOTHING: RevisionResult = {
  revisedWeeks: [],
  fromWeek: null,
  observedThrough: 0,
  versionNumber: null,
};

/**
 * Revise the program. Returns what it did, and writes nothing when there is
 * nothing to do or when a rule refuses.
 *
 * Written as a plain function rather than only as a hook so the integration
 * test can run the whole path against a migrated database without React.
 */
export async function reviseProgram(
  db: SqlExecutor,
  input: ReviseInput,
): Promise<RevisionResult> {
  const latest = await programStore.getLatestProgramVersion(db, input.program.id);

  // The plan to project from. A settings regeneration re-plans the whole
  // skeleton from the athlete's new answers and stores it on its version row
  // without ever touching `program.snapshot`, so reading the snapshot would
  // rebuild every unstarted week from answers the athlete has already
  // replaced. Only the newest version row is consulted, which is what makes
  // this compose with the write below: a revision leaves an array-layout row
  // behind it and puts the skeleton it ended on into the snapshot, so the next
  // revision reads the snapshot again.
  const stored = readSkeleton(input.program.snapshot);
  const skeleton = readSkeleton(regeneratedSkeleton(latest?.weekLayout ?? null)) ?? stored;
  if (skeleton === null) {
    throw new RevisionFailedError('This program has no saved plan, so it cannot be revised.');
  }
  const seed = Number.parseInt(input.program.seed, 10);
  if (!Number.isFinite(seed)) {
    throw new RevisionFailedError('This program has no readable seed, so it cannot be revised.');
  }

  const facts = await readWeekFacts(db, input.program.id, input.today);
  const target = revisionTarget({
    weeks: facts.map((fact) => ({
      w: fact.row.w,
      windowStart: fact.row.windowStart,
      loggedSets: fact.loggedSets,
    })),
    today: input.today,
    latestReason: latest?.reason,
  });
  if (!target.shouldRevise || target.fromWeek === null) return NOTHING;

  // The guard, before anything is written: the run of weeks from `fromWeek`
  // that nothing has been logged into. By construction of `fromWeek` this is
  // every week from there on, but a week that somehow carries work stops the
  // revision at itself rather than being rewritten under the athlete.
  const rebuildable: number[] = [];
  for (const fact of facts) {
    if (fact.row.w < target.fromWeek) continue;
    if (weekHasWork(fact.sessions)) break;
    rebuildable.push(fact.row.w);
  }
  if (rebuildable.length === 0) return NOTHING;
  // Clamped to the skeleton being projected from: a regenerated skeleton may
  // be shorter than the week rows the old one left behind, and asking the
  // chain for a week the skeleton does not have would throw.
  const lastRebuildable = Math.min(
    rebuildable[rebuildable.length - 1] ?? target.fromWeek,
    skeleton.W,
  );
  if (lastRebuildable < target.fromWeek) return NOTHING;

  let projected;
  try {
    const observed = await readObserved(db, facts, target.fromWeek);
    const { exercises, ladders } = loadExercises();
    // No `generatedAt`. One instant would become the `asOf` for every
    // projected week, and `bestEpley` drops any log dated after it, so no
    // projected week would see the week before it. Each week freezes at its
    // own window start instead; the real instant belongs on the row's
    // `generated_at` column, which `writeRevisedWeek` sets.
    projected = projectWeeks({
      athlete: input.athlete,
      ruleset: RULESET_V1,
      exercises,
      ladders,
      skeleton,
      seed,
      today: input.today,
      fromWeek: target.fromWeek,
      toWeek: lastRebuildable,
      observed,
      workingMaxes: input.athlete.workingMaxes,
    });
  } catch (caught) {
    throw refusal(caught);
  }

  // The version id is reserved here and the version row is written last, once
  // every week is down. The row is what `projectedFromReason` reads to decide
  // whether there is anything to revise, so a row written first would survive a
  // week write that threw and permanently disable the trigger: the plan would
  // sit half rebuilt, the Settings row would say "Nothing to revise yet", and
  // nothing would ever try again. `week.program_version_id` carries no foreign
  // key, so a week may point at the version before the version exists.
  const versionId = newId('pver');

  const byWeek = new Map(facts.map((fact) => [fact.row.w, fact.row]));
  const revisedWeeks: number[] = [];
  for (const plan of projected.weeks) {
    await writeReplacedWeek(db, input.program, versionId, plan, byWeek.get(plan.w));
    revisedWeeks.push(plan.w);
  }

  await writeCalendar(db, input.program.id, stored, projected.skeleton);

  const version = await programStore.createProgramVersion(
    db,
    input.program.id,
    weekLayoutFor(projected.weeks) as unknown as Json,
    revisionReason(target.foldedThrough),
    versionId,
  );

  return {
    revisedWeeks,
    fromWeek: target.fromWeek,
    observedThrough: target.observedThrough,
    versionNumber: version.version,
  };
}

/**
 * The layout the new version row stores.
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

/* ------------------------------------------------------------- the hooks */

/**
 * The trigger's arithmetic, over rows the app already loads.
 *
 * Null until there is a program with weeks. Nothing here queries anything the
 * Plan and Today do not already hold, which is what makes the automatic check
 * free when there is nothing to do.
 */
export function useRevisionTarget(): RevisionTarget | null {
  const today = useToday();
  const program = useCurrentProgram();
  const programId = program.data?.id;
  const weeks = useWeeks(programId);
  const sessions = useSessionsBetween(program.data?.startDate, program.data?.endDate);
  const versions = useProgramVersions(programId);

  const rows = weeks.data;
  const inRange = sessions.data;
  const history = versions.data;

  return useMemo(() => {
    if (rows === undefined || rows.length === 0) return null;
    const loggedByWeek = new Map<string, number>();
    for (const session of inRange ?? []) {
      loggedByWeek.set(
        session.weekId,
        (loggedByWeek.get(session.weekId) ?? 0) + session.loggedSetCount,
      );
    }
    return revisionTarget({
      weeks: rows.map((row) => ({
        w: row.w,
        windowStart: row.windowStart,
        loggedSets: loggedByWeek.get(row.id) ?? 0,
      })),
      today,
      latestReason: history?.[0]?.reason,
    });
  }, [rows, inRange, history, today]);
}

export function useRevise(): ReturnType<
  typeof useMutation<RevisionResult, Error, void>
> {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();
  const program = useCurrentProgram();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const baseline = useBaselineTest();

  return useMutation<RevisionResult, Error, void>({
    mutationFn: async () => {
      if (db === null) throw new RevisionFailedError('The database is not open yet.');
      const row = athlete.data ?? null;
      const current = program.data ?? null;
      if (row === null || current === null) return NOTHING;

      let engineAthlete: EngineAthlete;
      try {
        engineAthlete = toEngineAthlete({
          athlete: row,
          pains: pains.data ?? [],
          baseline: baselineReading(baseline.data),
        });
      } catch (caught) {
        throw refusal(caught);
      }
      return reviseProgram(db, { athlete: engineAthlete, program: current, today });
    },
    onSuccess: (result) => {
      if (result.revisedWeeks.length === 0) return;
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: queryKeys.currentProgram() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
