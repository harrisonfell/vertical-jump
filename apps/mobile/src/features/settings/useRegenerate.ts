import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loadRuleset, planSkeleton } from '@vert/engine';
import type { Athlete as EngineAthlete, PlanSkeleton } from '@vert/engine';
import {
  newId,
  programStore,
  queryKeys,
  useDbOrNull,
  useToday,
  useUpdateAthlete,
  type Athlete,
  type Json,
  type LocalDate,
  type PainStatus,
  type Program,
  type SqlExecutor,
} from '@/data';
import {
  IncompleteProfileError,
  toEngineAthlete,
  type BaselineReading,
} from '@/lib/engineAthlete';
import { readSkeleton } from '../plan/engine';
import { rebuildFromWeek, refusalSentence } from '../plan/rebuild';
import { baselineReading, useBaselineTest } from '../setup/useBaseline';
import { versionReason, type ParamChange } from './regenerate';

/**
 * Saving a program-affecting edit.
 *
 * The engine decides the shape of what follows: `planSkeleton` re-plans blocks,
 * week kinds, ladder rungs and the test weekday from the new answers, and the
 * result is stored as a new `ProgramVersion` rather than overwriting the old
 * one, so the Plan's version history keeps every past layout with its logs.
 *
 * Weeks before `fromWeek` are not touched: they are what the athlete actually
 * trained, and they go into the rebuild as evidence. Weeks from `fromWeek` on
 * are written again here and now, through the revision's own `rebuildFromWeek`,
 * so an athlete who moves from "1-3 years" to "4+ years" sees the new plan on
 * Today and on the Plan the moment they confirm, rather than whenever a later
 * automatic revision happens to run.
 */

export interface RegenerateInput {
  readonly athlete: Athlete;
  readonly pain: readonly PainStatus[];
  readonly program: Program | null;
  readonly patch: Partial<Athlete>;
  readonly changes: readonly ParamChange[];
  readonly fromWeek: number | null;
}

export interface RegenerateResult {
  readonly saved: true;
  /** Null when nothing needed rebuilding. */
  readonly versionNumber: number | null;
  readonly fromWeek: number | null;
  /** The weeks written again from the new answers, in order. */
  readonly rebuiltWeeks: readonly number[];
}

/** The engine's own error, surfaced with its sentence kept. */
export class RegenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegenerationFailedError';
  }
}

/** The week layout stored on the new version row. */
export interface WeekLayout {
  readonly fromWeek: number;
  /**
   * The plan the rebuild ended on, not the one it started from: an absorbed
   * repeat moves the two apart, and the next revision reads this.
   */
  readonly skeleton: PlanSkeleton;
  readonly changedFields: readonly string[];
  /**
   * The weeks this regeneration actually wrote. Empty means the rebuild found
   * nothing it was allowed to touch, and the revision trigger stays armed.
   */
  readonly rebuiltWeeks: readonly number[];
}

/* ---------------------------------------------------------- the mutation */

export interface RegenerateProgramInput {
  /** The athlete row as it now stands, with the edit already applied. */
  readonly athlete: Athlete;
  readonly pain: readonly PainStatus[];
  readonly program: Program;
  readonly changes: readonly ParamChange[];
  /** The first week that may be rewritten. */
  readonly fromWeek: number;
  readonly today: LocalDate;
  readonly baseline: BaselineReading | null;
}

/**
 * Re-plan from the new answers, rebuild every unstarted week, and record the
 * whole thing as one version.
 *
 * Written as a plain function rather than only as a hook so the integration
 * test can run the path against a migrated database without React.
 */
export async function regenerateProgram(
  db: SqlExecutor,
  input: RegenerateProgramInput,
): Promise<RegenerateResult> {
  const { program, fromWeek } = input;

  let engineAthlete: EngineAthlete;
  let skeleton: PlanSkeleton;
  try {
    engineAthlete = toEngineAthlete({
      athlete: input.athlete,
      pains: input.pain,
      baseline: input.baseline,
    });
    // Planned from the day the program started, never from today. The week
    // grid has to land on the rows that already exist: re-planning at today
    // would put programStart on the *next* Monday, renumber every week, and
    // write what the athlete knows as week 3 into the week 2 row, leaving a
    // whole week of the calendar unplanned and the last week holding the old
    // answers. Only the content of the weeks is meant to change here.
    skeleton = planSkeleton(engineAthlete, program.startDate, loadRuleset());
  } catch (caught) {
    // An incomplete profile names its own fix; anything else keeps the
    // engine's sentence, because the engine says why it refused.
    throw new RegenerationFailedError(
      caught instanceof IncompleteProfileError
        ? caught.message
        : refusalSentence(caught, 'The plan could not be rebuilt.'),
    );
  }

  // The id is reserved and the row written last, for the reason the revision
  // writes its own row last: the row is the record that the rebuild finished,
  // and the trigger reads it. A row written first would survive a week write
  // that threw, tell the trigger the weeks had already been rebuilt, and leave
  // the plan sitting half in the answers the athlete has replaced.
  const versionId = newId('pver');

  let rebuilt;
  try {
    rebuilt = await rebuildFromWeek(db, {
      athlete: engineAthlete,
      program,
      today: input.today,
      fromWeek,
      skeleton,
      stored: readSkeleton(program.snapshot),
      versionId,
    });
  } catch (caught) {
    throw new RegenerationFailedError(refusalSentence(caught, 'The plan could not be rebuilt.'));
  }

  const layout: WeekLayout = {
    fromWeek,
    skeleton: rebuilt.skeleton,
    changedFields: input.changes.map((change) => change.field),
    rebuiltWeeks: rebuilt.rebuiltWeeks,
  };

  const version = await programStore.createProgramVersion(
    db,
    program.id,
    layout as unknown as Json,
    versionReason(input.changes),
    versionId,
  );

  return {
    saved: true,
    versionNumber: version.version,
    fromWeek,
    rebuiltWeeks: rebuilt.rebuiltWeeks,
  };
}

/* -------------------------------------------------------------- the hook */

export function useRegenerate(): ReturnType<
  typeof useMutation<RegenerateResult, Error, RegenerateInput>
> {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();
  const updateAthlete = useUpdateAthlete();
  const baseline = useBaselineTest();

  return useMutation<RegenerateResult, Error, RegenerateInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');

      const next: Athlete = { ...input.athlete, ...input.patch };
      await updateAthlete.mutateAsync(input.patch);

      const { program, fromWeek } = input;
      if (program === null || fromWeek === null || input.changes.length === 0) {
        return { saved: true, versionNumber: null, fromWeek, rebuiltWeeks: [] };
      }

      return regenerateProgram(db, {
        athlete: next,
        pain: input.pain,
        program,
        changes: input.changes,
        fromWeek,
        today,
        baseline: baselineReading(baseline.data),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.currentProgram() });
      void client.invalidateQueries({ queryKey: ['week'] });
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
