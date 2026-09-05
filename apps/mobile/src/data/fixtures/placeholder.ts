import { addDays, weekdayOf } from '../../lib/localDay';
import type { LocalDate } from '../types';
import type {
  FixtureData,
  FixtureJumpTest,
  FixtureSession,
  FixtureSetLog,
  FixtureWhoopCycle,
  FixtureWhoopRecovery,
  FixtureWhoopSleep,
} from './types';

/**
 * A small, honest stand-in so screens can be built before the engine lands.
 *
 * It is the owner's own shape: advanced, four days a week on Mon, Tue, Thu,
 * Sat, one materialised week, three canonical OVR Jump tests (still
 * calibrating, so no PR moment), and 14 days of Whoop mirrors with one day
 * still PENDING_SCORE. Everything is anchored to the athlete's today, so Today
 * always has something real to render. @vert/engine's buildOwnerFixture
 * replaces this wholesale when it exists.
 */

const IN = 25.4;

function inches(value: number): number {
  return Math.round(value * IN);
}

function mondayOf(day: LocalDate): LocalDate {
  const weekday = weekdayOf(day);
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

function at(day: LocalDate, hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${day}T${hh}:${mm}:00.000Z`;
}

interface Prescription {
  readonly setNumber: number;
  readonly reps?: number;
  readonly durationS?: number;
  readonly distanceM?: number;
  readonly loadPercent?: number;
  readonly loadKg?: number;
  readonly displayLoad: string;
  readonly targetRpe?: number;
  readonly restS: number;
  readonly restRule: string;
  readonly isRamp: boolean;
  readonly isHeld: boolean;
}

function loaded(sets: number, reps: number, loadKg: number, restS: number): Prescription[] {
  const lb = Math.round(loadKg / 0.45359237 / 5) * 5;
  return Array.from({ length: sets }, (_, index) => ({
    setNumber: index + 1,
    reps,
    loadKg,
    displayLoad: `${reps} × ${lb} lb`,
    restS,
    restRule: 'R164',
    isRamp: false,
    isHeld: false,
  }));
}

function bodyweight(sets: number, reps: number, restS: number): Prescription[] {
  return Array.from({ length: sets }, (_, index) => ({
    setNumber: index + 1,
    reps,
    displayLoad: `${reps} × BW`,
    restS,
    restRule: 'R164',
    isRamp: false,
    isHeld: false,
  }));
}

function held(sets: number, durationS: number, restS: number): Prescription[] {
  return Array.from({ length: sets }, (_, index) => ({
    setNumber: index + 1,
    durationS,
    displayLoad: `${durationS} s hold`,
    restS,
    restRule: 'R164',
    isRamp: false,
    isHeld: true,
  }));
}

function sprint(sets: number, distanceM: number, restS: number): Prescription[] {
  return Array.from({ length: sets }, (_, index) => ({
    setNumber: index + 1,
    distanceM,
    displayLoad: `${distanceM} m`,
    restS,
    restRule: 'R164',
    isRamp: false,
    isHeld: false,
  }));
}

function buildSessions(monday: LocalDate): FixtureSession[] {
  return [
    {
      key: 'mon',
      weekW: 1,
      scheduledDate: monday,
      orderIndex: 0,
      dayType: 'Lower Strength',
      isMaximalCns: true,
      exercises: [
        {
          key: 'mon-squat',
          exerciseId: 'back_squat',
          exerciseName: 'Back squat',
          orderIndex: 0,
          loadType: 'heavy_strength',
          block: 'main',
          restS: 180,
          restRule: 'R164',
          perSet: loaded(4, 5, 102.5, 180),
        },
        {
          key: 'mon-rdl',
          exerciseId: 'romanian_deadlift',
          exerciseName: 'Romanian deadlift',
          orderIndex: 1,
          loadType: 'hypertrophy',
          block: 'accessory',
          restS: 90,
          restRule: 'R164',
          perSet: loaded(3, 8, 70, 90),
        },
        {
          key: 'mon-calf',
          exerciseId: 'standing_calf_raise',
          exerciseName: 'Standing calf raise',
          orderIndex: 2,
          loadType: 'prehab',
          block: 'accessory',
          bothSides: true,
          restS: 60,
          restRule: 'R164',
          perSet: bodyweight(3, 12, 60),
        },
      ],
    },
    {
      key: 'tue',
      weekW: 1,
      scheduledDate: addDays(monday, 1),
      orderIndex: 1,
      dayType: 'Upper Strength',
      exercises: [
        {
          key: 'tue-bench',
          exerciseId: 'db_bench_press',
          exerciseName: 'Dumbbell bench press',
          orderIndex: 0,
          loadType: 'hypertrophy',
          block: 'main',
          restS: 120,
          restRule: 'R164',
          perSet: loaded(4, 8, 32.5, 120),
        },
        {
          key: 'tue-row',
          exerciseId: 'chest_supported_row',
          exerciseName: 'Chest-supported row',
          orderIndex: 1,
          loadType: 'hypertrophy',
          block: 'accessory',
          restS: 90,
          restRule: 'R164',
          perSet: loaded(3, 10, 30, 90),
        },
      ],
    },
    {
      key: 'thu',
      weekW: 1,
      scheduledDate: addDays(monday, 3),
      orderIndex: 2,
      dayType: 'Power + Speed',
      isMaximalCns: true,
      testStatus: 'planned',
      exercises: [
        {
          key: 'thu-cmj',
          exerciseId: 'countermovement_jump',
          exerciseName: 'Countermovement jump',
          orderIndex: 0,
          loadType: 'ballistic',
          block: 'test',
          headerNote: 'Test day. Log the jump test after the primer.',
          restS: 120,
          restRule: 'R164',
          perSet: bodyweight(3, 3, 120),
        },
        {
          key: 'thu-tbj',
          exerciseId: 'trap_bar_jump',
          exerciseName: 'Trap-bar jump',
          orderIndex: 1,
          loadType: 'power',
          block: 'main',
          restS: 180,
          restRule: 'R164',
          perSet: loaded(4, 3, 60, 180),
        },
        {
          key: 'thu-sprint',
          exerciseId: 'acceleration_sprint',
          exerciseName: 'Acceleration sprint',
          orderIndex: 2,
          loadType: 'speed',
          block: 'speed',
          headerNote: 'acceleration',
          restS: 180,
          restRule: 'R164',
          perSet: sprint(4, 15, 180),
        },
      ],
    },
    {
      key: 'sat',
      weekW: 1,
      scheduledDate: addDays(monday, 5),
      orderIndex: 3,
      dayType: 'Recovery - Mobility',
      exercises: [
        {
          key: 'sat-couch',
          exerciseId: 'couch_stretch',
          exerciseName: 'Couch stretch',
          orderIndex: 0,
          loadType: 'mobility',
          block: 'mobility',
          bothSides: true,
          restS: 30,
          restRule: 'R164',
          perSet: held(2, 30, 30),
        },
        {
          key: 'sat-ankle',
          exerciseId: 'ankle_rocker',
          exerciseName: 'Ankle rocker',
          orderIndex: 1,
          loadType: 'mobility',
          block: 'mobility',
          bothSides: true,
          restS: 30,
          restRule: 'R164',
          perSet: held(2, 30, 30),
        },
      ],
    },
  ];
}

function buildSetLogs(sessions: readonly FixtureSession[], today: LocalDate): FixtureSetLog[] {
  const logs: FixtureSetLog[] = [];
  for (const session of sessions) {
    if (session.scheduledDate >= today) continue;
    for (const exercise of session.exercises) {
      const prescriptions = Array.isArray(exercise.perSet) ? (exercise.perSet as Prescription[]) : [];
      for (const prescription of prescriptions) {
        logs.push({
          sessionKey: session.key,
          exerciseKey: exercise.key,
          setNumber: prescription.setNumber,
          repsDone: prescription.reps,
          loadKg: prescription.loadKg,
          durationS: prescription.durationS,
          distanceM: prescription.distanceM,
          completedAt: at(session.scheduledDate, 18, 5 * prescription.setNumber),
          plannedDate: session.scheduledDate,
          entrySource: 'typed',
        });
      }
    }
  }
  return logs;
}

function buildTests(today: LocalDate): FixtureJumpTest[] {
  const days: readonly { day: LocalDate; best: number }[] = [
    { day: addDays(today, -21), best: 29.4 },
    { day: addDays(today, -14), best: 30.6 },
    { day: addDays(today, -7), best: 31.4 },
  ];
  return days.map(({ day, best }, index) => ({
    localDate: day,
    performedAt: at(day, 18, 30),
    instrument: 'ovr_jump_regular',
    mode: 'cmj',
    isBaseline: index === 0,
    canonical: true,
    bodyweightKg: 84,
    attempts: [
      { attemptIndex: 1, heightMm: inches(best - 0.8) },
      { attemptIndex: 2, heightMm: inches(best) },
      { attemptIndex: 3, heightMm: inches(best - 0.3) },
    ],
  }));
}

interface WhoopMirrors {
  readonly cycles: FixtureWhoopCycle[];
  readonly recoveries: FixtureWhoopRecovery[];
  readonly sleeps: FixtureWhoopSleep[];
}

function buildWhoop(today: LocalDate): WhoopMirrors {
  const cycles: FixtureWhoopCycle[] = [];
  const recoveries: FixtureWhoopRecovery[] = [];
  const sleeps: FixtureWhoopSleep[] = [];
  const scores = [61, 74, 82, 55, 47, 68, 79, 88, 71, 63, 58, 76, 84, 0];

  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = addDays(today, -offset);
    const index = 13 - offset;
    const isToday = offset === 0;
    const score = scores[index] ?? 70;
    const scoreState = isToday ? 'PENDING_SCORE' : 'SCORED';

    cycles.push({
      id: `cycle_${day}`,
      localDate: day,
      scoreState,
      startAt: at(day, 4),
      endAt: isToday ? undefined : at(addDays(day, 1), 4),
      strain: isToday ? undefined : 8 + (index % 7),
      raw: { id: `cycle_${day}`, score_state: scoreState },
    });

    recoveries.push({
      id: `recovery_${day}`,
      localDate: day,
      scoreState,
      userCalibrating: false,
      recoveryScore: isToday ? undefined : score,
      restingHeartRate: isToday ? undefined : 48 + (index % 5),
      hrvRmssdMilli: isToday ? undefined : 74 + (index % 11),
      raw: { cycle_id: `cycle_${day}`, score_state: scoreState },
    });

    sleeps.push({
      id: `sleep_${day}`,
      localDate: day,
      scoreState,
      startAt: at(day, 23),
      endAt: at(addDays(day, 1), 7),
      sleepPerformancePercentage: isToday ? undefined : 78 + (index % 15),
      raw: { id: `sleep_${day}`, score_state: scoreState },
    });
  }

  return { cycles, recoveries, sleeps };
}

export function buildPlaceholderFixture(today: LocalDate, timezone: string): FixtureData {
  const monday = mondayOf(today);
  // A session in the past was trained and finished; today and later stay planned.
  const sessions = buildSessions(monday).map((session) =>
    session.scheduledDate < today
      ? { ...session, markedCompleteAt: at(session.scheduledDate, 19, 30), rpe: 7, sorenessPre: 3 }
      : session,
  );
  const whoop = buildWhoop(today);

  return {
    athlete: {
      primaryGoal: 'Jump higher',
      sport: 'Basketball',
      trainingAgeYears: 4,
      level: 'advanced',
      daysPerWeek: 4,
      weekdays: [1, 2, 4, 6],
      weightRoomAccess: true,
      bodyweightKg: 84,
      goalHeightMm: inches(36),
      targetDate: addDays(today, 84),
      timezone,
      rolloverHour: 4,
      inSeason: false,
      inventory: { barbell: true, rack: true, trapBar: true, dumbbellMaxKg: 40, boxHeightsIn: [12, 18, 24] },
      clearance: { attestedAt: at(addDays(today, -30), 9), redFlags: [] },
      workingMax: {
        back_squat: {
          exerciseId: 'back_squat',
          valueKg: 125,
          source: 'entered',
          confidence: 1,
          frozenAt: null,
          lastRaiseAt: null,
        },
      },
    },
    program: {
      rulesetVersion: 'placeholder-0',
      seed: 'placeholder',
      startDate: monday,
      endDate: addDays(monday, 83),
      snapshot: { note: 'Placeholder fixture. Replaced by @vert/engine buildOwnerFixture.' },
      weekLayout: { weeks: 12, blocks: ['Strength 1-4', 'Deload 5', 'Power 6-10', 'Taper 11', 'Peak 12'] },
      blocks: [
        { type: 'Strength', orderIndex: 0, weekStart: 1, weekEnd: 4 },
        { type: 'Power', orderIndex: 1, weekStart: 6, weekEnd: 10 },
      ],
    },
    weeks: [
      {
        w: 1,
        windowStart: monday,
        windowEnd: addDays(monday, 6),
        kind: 'load',
        k: 0,
        prescribedCount: sessions.length,
        extensiveTarget: 90,
        highContactAllowance: 25,
      },
    ],
    sessions,
    setLogs: buildSetLogs(sessions, today),
    jumpTests: buildTests(today),
    whoopCycles: whoop.cycles,
    whoopRecoveries: whoop.recoveries,
    whoopSleeps: whoop.sleeps,
  };
}
