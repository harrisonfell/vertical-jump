import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loadRuleset, planSkeleton } from '@vert/engine';
import type { PlanSkeleton } from '@vert/engine';
import {
  programStore,
  queryKeys,
  useDbOrNull,
  useToday,
  useUpdateAthlete,
  type Athlete,
  type PainStatus,
  type Program,
} from '@/data';
import { IncompleteProfileError, toEngineAthlete } from '@/lib/engineAthlete';
import { versionReason, type ParamChange } from './regenerate';

/**
 * Saving a program-affecting edit.
 *
 * The engine decides the shape of what follows: `planSkeleton` re-plans blocks,
 * week kinds, ladder rungs and the test weekday from the new answers, and the
 * result is stored as a new `ProgramVersion` rather than overwriting the old
 * one, so the Plan's version history keeps every past layout with its logs.
 *
 * Weeks before `fromWeek` are not touched. Materialising `fromWeek` itself is
 * the week-build path's job, which already carries the ladder state and the
 * working maxes; this writes the layout it will read.
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
  readonly skeleton: PlanSkeleton;
  readonly changedFields: readonly string[];
}

export function useRegenerate(): ReturnType<
  typeof useMutation<RegenerateResult, Error, RegenerateInput>
> {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();
  const updateAthlete = useUpdateAthlete();

  return useMutation<RegenerateResult, Error, RegenerateInput>({
    mutationFn: async (input) => {
      if (db === null) throw new Error('The database is not open yet.');

      const next: Athlete = { ...input.athlete, ...input.patch };
      await updateAthlete.mutateAsync(input.patch);

      if (input.program === null || input.fromWeek === null || input.changes.length === 0) {
        return { saved: true, versionNumber: null, fromWeek: input.fromWeek };
      }

      let skeleton: PlanSkeleton;
      try {
        const engineAthlete = toEngineAthlete({ athlete: next, pains: input.pain, baseline: null });
        skeleton = planSkeleton(engineAthlete, today, loadRuleset());
      } catch (caught) {
        // An incomplete profile names its own fix; anything else keeps the
        // engine's sentence, because the engine says why it refused.
        throw new RegenerationFailedError(
          caught instanceof IncompleteProfileError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : 'The plan could not be rebuilt.',
        );
      }

      const layout: WeekLayout = {
        fromWeek: input.fromWeek,
        skeleton,
        changedFields: input.changes.map((change) => change.field),
      };

      const version = await programStore.createProgramVersion(
        db,
        input.program.id,
        layout,
        versionReason(input.changes),
      );

      return { saved: true, versionNumber: version.version, fromWeek: input.fromWeek };
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
