import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RULESET_V1, loadExercises, projectWeeks } from '@vert/engine';
import type { Athlete as EngineAthlete } from '@vert/engine';
import {
  programStore,
  queryKeys,
  useAthlete,
  useCurrentProgram,
  useDbOrNull,
  usePainStatus,
  useToday,
} from '@/data';
import type { LocalDate, Program, SqlExecutor } from '@/data';
import { toEngineAthlete } from '@/lib/engineAthlete';
import { baselineReading, useBaselineTest } from '../setup/useBaseline';
import { readSkeleton } from './engine';
import { readObserved, readWeekFacts, writeReplacedWeek, type WeekFacts } from './rebuild';

/**
 * The one-time backfill for a program built before the app projected past
 * week 1.
 *
 * Those programs hold weeks 2..W as bare skeleton rows: no stored WeekPlan, no
 * sessions. Nothing in the app can open them, and a revision cannot rescue them
 * either, because the fold refuses a week with no readable saved plan. So a
 * plan built last month would stay a one-week plan forever.
 *
 * This runs once at app start, after the database is open, and projects the
 * empty weeks from the weeks before them. It is deliberately silent: an athlete
 * with a current program has nothing to fix and never learns this exists, and
 * an athlete whose program cannot be projected is no worse off than before.
 * Nothing that has been trained is ever touched.
 */

/** One week, reduced to what deciding a backfill needs. */
export interface BackfillWeekFacts {
  readonly w: number;
  /** True when the week carries a stored plan the app can open. */
  readonly hasPlan: boolean;
  readonly sessionCount: number;
  readonly loggedSets: number;
}

export interface BackfillRange {
  readonly fromWeek: number;
  readonly toWeek: number;
}

/**
 * The run of weeks to project, or null when there is nothing to do.
 *
 * A week qualifies only when it holds no plan, no sessions and nothing logged.
 * The run stops at the first week that fails any of those, so a week the
 * athlete has touched, and everything after it, is left exactly as it is.
 */
export function backfillRange(weeks: readonly BackfillWeekFacts[]): BackfillRange | null {
  const sorted = [...weeks].sort((a, b) => a.w - b.w);
  const empty = (week: BackfillWeekFacts): boolean =>
    !week.hasPlan && week.sessionCount === 0 && week.loggedSets === 0;

  const start = sorted.findIndex(empty);
  if (start === -1) return null;

  let end = start;
  while (end + 1 < sorted.length) {
    const next = sorted[end + 1];
    if (next === undefined || !empty(next)) break;
    end += 1;
  }

  const fromWeek = sorted[start]?.w;
  const toWeek = sorted[end]?.w;
  if (fromWeek === undefined || toWeek === undefined) return null;
  return { fromWeek, toWeek };
}

function factsFor(facts: readonly WeekFacts[]): BackfillWeekFacts[] {
  return facts.map((fact) => ({
    w: fact.row.w,
    hasPlan: fact.row.snapshot !== null && fact.row.snapshot !== undefined,
    sessionCount: fact.sessions.length,
    loggedSets: fact.loggedSets,
  }));
}

export interface BackfillInput {
  readonly athlete: EngineAthlete;
  readonly program: Program;
  readonly today: LocalDate;
}

/**
 * Project every empty week of this program and write it, or do nothing.
 *
 * Returns the weeks it filled, so a caller can decide whether anything needs
 * invalidating. No version row is written: a backfill is not a revision, it is
 * the build finishing a job it started, and leaving the newest version's reason
 * as it stands is what keeps the revision trigger armed afterwards.
 */
export async function backfillProgram(db: SqlExecutor, input: BackfillInput): Promise<number[]> {
  const skeleton = readSkeleton(input.program.snapshot);
  if (skeleton === null) return [];
  const seed = Number.parseInt(input.program.seed, 10);
  if (!Number.isFinite(seed)) return [];

  const facts = await readWeekFacts(db, input.program.id, input.today);
  const range = backfillRange(factsFor(facts));
  if (range === null) return [];

  const observed = await readObserved(db, facts, range.fromWeek);
  const { exercises, ladders } = loadExercises();
  const projected = projectWeeks({
    athlete: input.athlete,
    ruleset: RULESET_V1,
    exercises,
    ladders,
    skeleton,
    seed,
    today: input.today,
    fromWeek: range.fromWeek,
    toWeek: range.toWeek,
    observed,
    workingMaxes: input.athlete.workingMaxes,
  });

  const latest = await programStore.getLatestProgramVersion(db, input.program.id);
  const byWeek = new Map(facts.map((fact) => [fact.row.w, fact.row]));
  const filled: number[] = [];
  for (const plan of projected.weeks) {
    // 'projection', not 'revision': these weeks come from the plan as written,
    // not from anything the athlete logged, and the Plan tab says so.
    await writeReplacedWeek(
      db,
      input.program,
      latest?.id ?? null,
      plan,
      byWeek.get(plan.w),
      'projection',
    );
    filled.push(plan.w);
  }
  return filled;
}

/* ------------------------------------------------------------- the guard */

/** One run per program at a time, however many mounts ask for it. */
const inFlight = new Map<string, Promise<number[]>>();

/**
 * `backfillProgram`, run at most once at a time for one program.
 *
 * Two mounts racing would project the same weeks twice, and the second run
 * would delete sessions the first had just written. The map is keyed by program
 * id and cleared when the run settles, so a program whose backfill failed is
 * tried again on the next start rather than never again.
 */
export function backfillOnce(db: SqlExecutor, input: BackfillInput): Promise<number[]> {
  const running = inFlight.get(input.program.id);
  if (running !== undefined) return running;

  const run = backfillProgram(db, input).finally(() => {
    inFlight.delete(input.program.id);
  });
  inFlight.set(input.program.id, run);
  return run;
}

/* -------------------------------------------------------------- the hook */

/**
 * Fills an old program's missing weeks, once, after the database opens.
 *
 * Mounted beside the app's other boot-time effects. Everything it reads is
 * already loaded by the screens, so on a healthy program it costs one pass over
 * rows that are in the cache and writes nothing.
 */
export function useProjectionBackfill(): void {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();
  const program = useCurrentProgram();
  const athlete = useAthlete();
  const pains = usePainStatus();
  const baseline = useBaselineTest();
  const attempted = useRef<string | null>(null);

  const programRow = program.data ?? null;
  const athleteRow = athlete.data ?? null;

  useEffect(() => {
    if (db === null || programRow === null || athleteRow === null) return;
    if (attempted.current === programRow.id) return;
    attempted.current = programRow.id;

    const run = async (): Promise<void> => {
      let engineAthlete: EngineAthlete;
      try {
        engineAthlete = toEngineAthlete({
          athlete: athleteRow,
          pains: pains.data ?? [],
          baseline: baselineReading(baseline.data),
        });
      } catch {
        // An incomplete profile cannot be projected from. Nothing to say: the
        // athlete is mid-setup, and the build writes these weeks itself.
        return;
      }

      let filled: number[] = [];
      try {
        filled = await backfillOnce(db, { athlete: engineAthlete, program: programRow, today });
      } catch {
        // A refused projection leaves every row as it was. The plan is no worse
        // than it was a moment ago and there is nothing to ask of the athlete,
        // so this stays quiet and tries again on the next start.
        attempted.current = null;
        return;
      }

      if (filled.length === 0) return;
      client.invalidateQueries({ queryKey: ['week'] }).catch(() => undefined);
      client.invalidateQueries({ queryKey: ['session'] }).catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.currentProgram() }).catch(() => undefined);
    };

    void run();
  }, [athleteRow, baseline.data, client, db, pains.data, programRow, today]);
}
