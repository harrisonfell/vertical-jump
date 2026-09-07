import { inToMm, lbToKg } from '@vert/engine';
import type { Athlete as EngineAthlete, SetPrescription } from '@vert/engine';
import type { Athlete, Program, SqlExecutor } from '@/data';
import { upsertAthlete } from '@/data/store/athlete';
import { getCurrentProgram } from '@/data/store/program';
import {
  listSessionExercises,
  listSessionsByWeek,
  markSessionComplete,
} from '@/data/store/sessions';
import { logSet } from '@/data/store/setLogs';
import { toEngineAthlete } from '@/lib/engineAthlete';
import { buildProgramPlan } from '../setup/buildProgram';
import { writeProgramPlan } from '../setup/writeProgram';

/**
 * A whole built program, for the tests that need one.
 *
 * Test-only: nothing in the app imports this. It exists because both the
 * revision tests and the backfill test need the same twelve weeks written the
 * way the build writes them, and a second copy of the athlete's answers would
 * drift from the first.
 */

export const BUILT_AT = '2026-09-04';

const CLEAR = {
  heartCondition: false,
  chestPain: false,
  dizziness: false,
  chronicCondition: false,
  prescriptionMedication: false,
  boneOrJointProblem: false,
  supervisedActivityOnly: false,
  isAdult: true,
  attestedAt: BUILT_AT,
};

const INVENTORY = {
  barbell: true,
  rack: true,
  plates: { smallestPairLb: 5 },
  trapBar: true,
  dumbbells: { maxLb: 100, incrementLb: 5 },
  kettlebells: false,
  boxHeightsIn: [12, 18, 24, 30],
  hurdleHeightsIn: [6, 9, 12],
  bands: true,
  medBall: true,
  vestLb: 20,
  bench: true,
  pullupBar: true,
  cable: false,
  sled: false,
};

export const BASELINE = { heightMm: inToMm(29.4), instrument: 'ovr_jump_regular' } as const;

export interface BuiltProgram {
  readonly athlete: Athlete;
  readonly engineAthlete: EngineAthlete;
  readonly program: Program;
}

/** The owner's answers, built and written exactly as the setup flow writes them. */
export async function buildTestProgram(db: SqlExecutor): Promise<BuiltProgram> {
  const athlete: Athlete = await upsertAthlete(db, {
    primaryGoal: 'vertical_jump',
    sport: 'basketball',
    trainingAgeYears: 5,
    level: 'advanced',
    daysPerWeek: 4,
    weekdays: [1, 2, 4, 6],
    isAdult: true,
    clearance: CLEAR,
    inventory: INVENTORY,
    weightRoomAccess: true,
    bodyweightKg: lbToKg(181),
    workingMax: {
      back_squat: {
        exerciseId: 'back_squat',
        valueKg: lbToKg(275),
        source: 'entered',
        confidence: 1,
        frozenAt: `${BUILT_AT}T03:00:00.000Z`,
        lastRaiseAt: null,
      },
    },
    goalHeightMm: inToMm(36),
    targetDate: '2026-11-29',
    timezone: 'America/New_York',
    rolloverHour: 3,
  });

  await writeProgramPlan(
    db,
    buildProgramPlan({
      athlete,
      pains: [],
      baseline: BASELINE,
      today: BUILT_AT,
      generatedAt: `${BUILT_AT}T12:00:00.000Z`,
    }),
  );

  const program = await getCurrentProgram(db);
  if (program === null) throw new Error('the program did not build');
  return {
    athlete,
    engineAthlete: toEngineAthlete({ athlete, pains: [], baseline: BASELINE }),
    program,
  };
}

/** Train a week exactly as it was written: every set logged, every session done. */
export async function trainWeek(
  db: SqlExecutor,
  weekId: string,
  today: string,
): Promise<number> {
  const sessions = await listSessionsByWeek(db, weekId, today);
  let logged = 0;
  for (const session of sessions) {
    for (const row of await listSessionExercises(db, session.id)) {
      const sets = (Array.isArray(row.perSet) ? row.perSet : []) as SetPrescription[];
      for (const set of sets) {
        await logSet(db, {
          sessionId: session.id,
          sessionExerciseId: row.id,
          setNumber: set.setNumber,
          ...(set.reps === undefined ? null : { repsDone: set.reps }),
          loadSource: row.loadMode,
          completedAt: `${session.scheduledDate}T18:00:00.000Z`,
          plannedDate: session.scheduledDate,
        });
        logged += 1;
      }
    }
    await markSessionComplete(db, session.id, `${session.scheduledDate}T19:15:00.000Z`);
  }
  return logged;
}

/**
 * One set logged against a week, the way a set entered late lands.
 *
 * Enough to make the week "observed" for the trigger while leaving it nothing
 * like trained, which is the shape that separates the newest week holding a
 * log from the last week a revision actually folds in.
 */
export async function logOneSet(db: SqlExecutor, weekId: string, today: string): Promise<void> {
  const sessions = await listSessionsByWeek(db, weekId, today);
  const session = sessions[0];
  if (session === undefined) throw new Error('the week has no sessions to log against');
  const row = (await listSessionExercises(db, session.id))[0];
  if (row === undefined) throw new Error('the session has no exercises to log against');
  await logSet(db, {
    sessionId: session.id,
    sessionExerciseId: row.id,
    setNumber: 1,
    repsDone: 5,
    loadSource: row.loadMode,
    completedAt: `${session.scheduledDate}T18:00:00.000Z`,
    plannedDate: session.scheduledDate,
  });
}
