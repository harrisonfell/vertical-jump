import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { lbToKg } from '@vert/engine';
import {
  athleteStore,
  jumpTestStore,
  nowIso,
  queryKeys,
  syncStore,
  useDbOrNull,
  useToday,
} from '@/data';
import type { Json, LocalDate, SqlExecutor } from '@/data';
import { weightRoomAccess } from './inventory';
import { toReadinessTestConfig } from './readinessConfig';
import { inchesToMm, parseNumber } from './stepTwoValidation';
import { MAX_LIFT_IDS, PULL_UP_ENTRY_REPS, baselineFrom, workingMaxesFrom } from './enteredMaxes';
import { bestSetsFrom } from './bestSets';
import type { StepTwoValues } from './stepTwoValues';

/**
 * Saving step 2 writes the profile and stores the baseline as jump test
 * number one. The baseline is an open marker unless "Measured today under
 * test conditions" was checked, which is exactly what `canonical` means to
 * every chart and every PR downstream.
 *
 * The arithmetic behind the numbers it writes lives in `enteredMaxes.ts`,
 * which is pure; this file is only the write.
 */

export { MAX_LIFT_IDS, PULL_UP_ENTRY_REPS, baselineFrom, workingMaxesFrom };

async function writeStepTwo(
  db: SqlExecutor,
  values: StepTwoValues,
  today: LocalDate,
): Promise<void> {
  const at = nowIso();
  const baseline = baselineFrom(values);
  if (baseline === null) throw new Error('Enter your baseline jump height.');
  const goalIn = parseNumber(values.goalIn);
  if (goalIn === null) throw new Error('Enter a goal jump height.');
  const bodyweightLb = parseNumber(values.bodyweightLb);

  const readinessPassed =
    values.readiness.squat &&
    values.readiness.landing &&
    values.readiness.training &&
    values.readiness.pain;

  const patch = {
    weekdays: [...values.weekdays],
    goalHeightMm: inchesToMm(goalIn),
    targetDate: values.targetDate.trim(),
    standingReachMm: baseline.standingReachMm,
    bodyweightKg: bodyweightLb === null ? null : lbToKg(bodyweightLb),
    inventory: values.inventory as unknown as Json,
    weightRoomAccess: weightRoomAccess(values.inventory),
    inSeason: values.inSeason,
    readinessPassedAt: readinessPassed ? today : null,
    testConditionsNote: values.canonical
      ? 'Measured under test conditions on the day the program was built.'
      : null,
    workingMax: workingMaxesFrom(values, at),
    // R73's own source. The engine reads it at the next weekly freeze, so
    // nothing here estimates a max from it.
    bestSets: bestSetsFrom(values.bestSets, today) as unknown as Json,
    // The gate's configuration is copied onto the athlete, so swapping the
    // test later never rewrites how an earlier day was scored.
    readinessConfig: toReadinessTestConfig(values.readinessConfig) as unknown as Json,
  };

  await athleteStore.upsertAthlete(db, patch);
  await syncStore.enqueue(db, {
    kind: 'athlete.upsert',
    entityId: athleteStore.ATHLETE_ID,
    payload: patch,
  });

  // Setup is the only place a baseline is created, so re-saving step 2
  // replaces the marker rather than leaving two firsts on the stream.
  for (const existing of await jumpTestStore.listJumpTests(db, {})) {
    if (existing.isBaseline) await jumpTestStore.deleteJumpTest(db, existing.id);
  }

  const test = {
    localDate: today,
    performedAt: at,
    instrument: baseline.instrument,
    isBaseline: true,
    canonical: values.canonical,
    scheduled: false,
    bodyweightKg: bodyweightLb === null ? null : lbToKg(bodyweightLb),
    attempts: [{ attemptIndex: 1, heightMm: baseline.heightMm, entrySource: 'typed' as const }],
  };
  const saved = await jumpTestStore.createJumpTest(db, test);
  await syncStore.enqueue(db, { kind: 'jumpTest.create', entityId: saved.id, payload: test });
}

export function useSaveStepTwo(): UseMutationResult<void, Error, StepTwoValues> {
  const db = useDbOrNull();
  const today = useToday();
  const client = useQueryClient();

  return useMutation<void, Error, StepTwoValues>({
    mutationFn: async (values) => {
      if (db === null) throw new Error('The database is not open yet.');
      await writeStepTwo(db, values, today);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.athlete() });
      void client.invalidateQueries({ queryKey: queryKeys.testsAll() });
      void client.invalidateQueries({ queryKey: queryKeys.sync() });
    },
  });
}
