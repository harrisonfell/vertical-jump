import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Athlete as EngineAthlete } from '@vert/engine';
import {
  newId,
  programStore,
  queryKeys,
  useAthlete,
  useCurrentProgram,
  useDbOrNull,
  usePainStatus,
  useProgramVersions,
  useSessionsBetween,
  useToday,
  useWeeks,
} from '@/data';
import type { Json, LocalDate, Program, SqlExecutor } from '@/data';
import { toEngineAthlete } from '@/lib/engineAthlete';
import { baselineReading, useBaselineTest } from '../setup/useBaseline';
import { readSkeleton } from './engine';
import {
  RevisionFailedError,
  readWeekFacts,
  rebuildFromWeek,
  refusalSentence,
  weekLayoutFor,
} from './rebuild';
import { weekProgressFrom } from '../settings/regenerate';
import { regeneratedSkeleton, revisionReason, revisionTarget, type RevisionTarget } from './revise';

/**
 * The automatic and manual revision: rebuilding every unstarted week from what
 * the athlete has actually logged.
 *
 * The rows are written by `rebuildFromWeek`, which the settings regeneration
 * shares. What lives here is the part only a revision does: deciding whether
 * there is anything new to fold in, and recording that it happened on a version
 * row whose reason the trigger reads back.
 */

export { RevisionFailedError } from './rebuild';

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

/* ---------------------------------------------------------- the mutation */

/** Whatever refused, said in the words it refused with. */
function refusal(caught: unknown): RevisionFailedError {
  return new RevisionFailedError(refusalSentence(caught, 'The plan could not be revised.'));
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
  // skeleton from the athlete's new answers and stores it on its version row,
  // so reading the snapshot alone could rebuild every unstarted week from
  // answers the athlete has already replaced. Only the newest version row is
  // consulted, which is what makes this compose with the write below: a
  // revision leaves an array-layout row behind it and puts the skeleton it
  // ended on into the snapshot, so the next revision reads the snapshot again.
  const stored = readSkeleton(input.program.snapshot);
  const skeleton = readSkeleton(regeneratedSkeleton(latest?.weekLayout ?? null)) ?? stored;
  if (skeleton === null) {
    throw new RevisionFailedError('This program has no saved plan, so it cannot be revised.');
  }

  const facts = await readWeekFacts(db, input.program.id, input.today);
  const target = revisionTarget({
    weeks: facts.map((fact) => ({
      w: fact.row.w,
      windowStart: fact.row.windowStart,
      windowEnd: fact.row.windowEnd,
      loggedSets: fact.loggedSets,
      startedSessions: fact.startedSessions,
    })),
    today: input.today,
    latestReason: latest?.reason,
    latestLayout: latest?.weekLayout ?? null,
  });
  if (!target.shouldRevise || target.fromWeek === null) return NOTHING;

  // The version id is reserved here and the version row is written last, once
  // every week is down. The row is what the trigger reads to decide whether
  // there is anything to revise, so a row written first would survive a week
  // write that threw and permanently disable the trigger: the plan would sit
  // half rebuilt, the Settings row would say "Nothing to revise yet", and
  // nothing would ever try again. `week.program_version_id` carries no foreign
  // key, so a week may point at the version before the version exists.
  const versionId = newId('pver');

  let rebuilt;
  try {
    rebuilt = await rebuildFromWeek(db, {
      athlete: input.athlete,
      program: input.program,
      today: input.today,
      fromWeek: target.fromWeek,
      skeleton,
      stored,
      versionId,
      facts,
    });
  } catch (caught) {
    throw refusal(caught);
  }
  if (rebuilt.rebuiltWeeks.length === 0) return NOTHING;

  const version = await programStore.createProgramVersion(
    db,
    input.program.id,
    weekLayoutFor(rebuilt.weeks) as unknown as Json,
    revisionReason(target.foldedThrough),
    versionId,
  );

  return {
    revisedWeeks: rebuilt.rebuiltWeeks,
    fromWeek: target.fromWeek,
    observedThrough: target.observedThrough,
    versionNumber: version.version,
  };
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
    return revisionTarget({
      weeks: weekProgressFrom(rows, inRange ?? []),
      today,
      latestReason: history?.[0]?.reason,
      latestLayout: history?.[0]?.weekLayout ?? null,
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
