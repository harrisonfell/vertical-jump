import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { deriveLevel } from '@vert/engine';
import type { ClearanceScreen } from '@vert/engine';
import { athleteStore, queryKeys, syncStore, useDbOrNull, useToday } from '@/data';
import type { LocalDate, PainSeverity, SqlExecutor } from '@/data';
import { climbingPatchFrom, showsGripBlock } from './climbing';
import { painGateFor, reassessDueAt } from './clearanceModel';
import { TRAINING_AGE_YEARS } from './engineAthlete';
import type { StepOneValues } from './stepOne';

/**
 * Saving step 1 is one action with two halves: the five answers on the athlete
 * row, and the pain site as its own row so its history survives an edit. The
 * gate runs on what was just written, never on the values in the form, so the
 * routing decision and the stored program read the same facts.
 */

export interface StepOneSaveResult {
  /** The screen the athlete is routed to, or null to carry on to step 2. */
  readonly clearance: ClearanceScreen | null;
}

function severityWord(raw: 1 | 3 | 5): PainSeverity {
  if (raw >= 5) return 'severe';
  if (raw >= 3) return 'moderate';
  return 'mild';
}

async function writeStepOne(
  db: SqlExecutor,
  values: StepOneValues,
  today: LocalDate,
): Promise<void> {
  const patch = {
    primaryGoal: 'vertical_jump',
    sport: values.sport,
    trainingAgeYears: TRAINING_AGE_YEARS[values.trainingAge],
    level: deriveLevel(values.trainingAge),
    daysPerWeek: values.daysPerWeek,
    // The climbing answers ride the same upsert: they are athlete answers, not
    // a second entity, and the server projects `athlete.upsert` as a patch.
    ...climbingPatchFrom(values, showsGripBlock(values.sport, values.fingerHistory)),
  } as const;

  await athleteStore.upsertAthlete(db, patch);
  await syncStore.enqueue(db, {
    kind: 'athlete.upsert',
    entityId: athleteStore.ATHLETE_ID,
    payload: patch,
  });

  const open = await athleteStore.listPainStatus(db);

  if (!values.hasPain || values.painLocation === null || values.painSeverity === null) {
    // "No" clears every open site: the answer is about right now, and a stale
    // row would keep excluding exercises the athlete no longer needs excluded.
    for (const row of open) {
      await athleteStore.clearPain(db, row.id);
      await syncStore.enqueue(db, { kind: 'pain.clear', entityId: row.id, payload: { id: row.id } });
    }
    return;
  }

  const onset = values.painDuration ?? 'acute';
  const input = {
    location: values.painLocation,
    severityRaw: values.painSeverity,
    severityDerived: severityWord(values.painSeverity),
    onset,
    reportedAt: `${today}T00:00:00.000Z`,
    reassessDueAt: reassessDueAt(today),
  } as const;

  for (const row of open) {
    if (row.location === values.painLocation) continue;
    await athleteStore.clearPain(db, row.id);
    await syncStore.enqueue(db, { kind: 'pain.clear', entityId: row.id, payload: { id: row.id } });
  }
  const saved = await athleteStore.reportPain(db, input);
  await syncStore.enqueue(db, { kind: 'pain.report', entityId: saved.id, payload: input });
}

export function useSaveStepOne(): UseMutationResult<StepOneSaveResult, Error, StepOneValues> {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();

  return useMutation<StepOneSaveResult, Error, StepOneValues>({
    mutationFn: async (values) => {
      if (db === null) throw new Error('The database is not open yet.');
      await writeStepOne(db, values, today);
      // Step 2 seeds its form once, from the cache, the moment it mounts, and
      // the routing runs before an invalidation's refetch has landed. So the
      // saved row is read back here and awaited: what step 2 opens on is what
      // step 1 just wrote (the days a week, the sport, the wall), not the row
      // from before it. The key is a prefix of the pain rows' key, so both
      // reads come back together.
      await client.refetchQueries({ queryKey: queryKeys.athlete() }, { cancelRefetch: true });
      const athlete = await athleteStore.getAthlete(db);
      const pains = await athleteStore.listPainStatus(db);
      return { clearance: painGateFor({ athlete, pains, today }).clearanceScreen };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.pain() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
