import { useMemo } from 'react';
import type {
  Athlete,
  Block,
  PainStatus,
  Program,
  SessionAnswer,
  SessionWithStatus,
  SetLog,
  Week,
} from '@/data';
import {
  useAthlete,
  useBlocks,
  useCurrentProgram,
  useCurrentWeek,
  useDbState,
  useFingerPain,
  useKvValue,
  usePainStatus,
  useReadinessToday,
  useSessionExercises,
  useSessionsBetween,
  useSessionsByWeek,
  useSetLogs,
  useWeeks,
} from '@/data';
import type { ReadinessOutcome as EngineReadinessOutcome, ReadinessTestConfig } from '@vert/engine';
import { weekdayLabelOf } from '@vert/engine';
import {
  defaultFingerPainCeiling,
  readReadinessConfig,
  readSessionWindow,
  readWallWork,
} from '@/lib/engineAthlete';
import { addDays, daysBetween } from '@/lib/localDay';
import { MISSED_WINDOW_DAYS, readinessSkipKey, sorenessSkipKey } from './cards';
import { hasHardFingerWork } from './climbing';
import { skeletonWeekCount } from './header';
import { buildTodaySession, type TodaySession } from './model';
import {
  readinessRowModel,
  toEngineTest,
  toEngineTests,
  whoopChannel,
  type ReadinessRowModel,
} from './readinessModel';
import { medBallWeightLb } from './climbRows';
import { forcedState, type TodayForcedState } from './states';

/**
 * Everything Today reads, in one hook.
 *
 * The screen never touches a repository: it asks for a day and gets back the
 * session on it, the week around it, and the logs under it. Loading is one flag
 * because the screen has one skeleton; an error keeps whatever is cached, which
 * is why the data is returned beside the error rather than instead of it.
 */

export interface NextTest {
  readonly weekday: string | null;
  readonly inDays: number | null;
  readonly isToday: boolean;
  readonly done: boolean;
}

export interface TodayData {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
  /** When the cached copy on screen was last read, so an error can say how old it is. */
  readonly cachedAt: string | null;
  readonly today: string;
  readonly athlete: Athlete | null;
  readonly program: Program | null;
  readonly week: Week | null;
  readonly totalWeeks: number;
  readonly blockType: string | null;
  /** The session scheduled for today, if there is one. */
  readonly session: SessionWithStatus | null;
  /** The merged plan: blocks, notices, contacts. Null on a rest day. */
  readonly plan: TodaySession | null;
  readonly logs: readonly SetLog[];
  /** exercise row id to set number to reps done. Contacts count from this. */
  readonly repsByExercise: ReadonlyMap<string, ReadonlyMap<number, number>>;
  readonly loggedByExercise: ReadonlyMap<string, ReadonlySet<number>>;
  readonly logByKey: ReadonlyMap<string, SetLog>;
  readonly weekSessions: readonly SessionWithStatus[];
  /** The next session after today, for the rest-day view. */
  readonly nextSession: SessionWithStatus | null;
  /** A missed session earlier in this week that has not been dismissed. */
  readonly missedSession: SessionWithStatus | null;
  readonly nextTest: NextTest;
  readonly painStatus: readonly PainStatus[];
  readonly restricted: boolean;
  /** The severe, uncleared row the restriction comes from, so copy can name it. */
  readonly restrictedPain: PainStatus | null;
  /** True once the athlete declined the soreness question for this session. */
  readonly sorenessSkipped: boolean;
  /**
   * The gate's configuration, or null for an athlete who has none, which is
   * every athlete outside the climbing house rules
   * (`house.sc.readiness_gate`).
   */
  readonly readinessConfig: ReadinessTestConfig | null;
  /** Both channels and the verdict, or null when the gate does not run. */
  readonly readiness: ReadinessRowModel | null;
  /** The engine outcome the session was adjusted with, when one applied. */
  readonly readinessOutcome: EngineReadinessOutcome | null;
  /** True once the athlete declined today's readiness test. */
  readonly readinessSkipped: boolean;
  /** True when today's session carries hard finger work, so the question is asked. */
  readonly fingerAsked: boolean;
  /** Today's finger answer: absent means unanswered, a null value means skipped. */
  readonly fingerAnswer: SessionAnswer | null;
  /** House `house.sc.finger_pain_ceiling`: above this the hard rows come off. */
  readonly fingerPainCeiling: number;
  readonly lastCompletedDate: string | null;
  /** True while this is the week's final scheduled workout and it is unfinished. */
  readonly isWeekFinalWorkout: boolean;
  readonly forced: TodayForcedState;
}

function blockFor(blocks: readonly Block[], week: Week | null): string | null {
  if (week === null) return null;
  const byId = blocks.find((block) => block.id === week.blockId);
  if (byId !== undefined) return byId.type;
  const byRange = blocks.find((block) => week.w >= block.weekStart && week.w <= block.weekEnd);
  return byRange?.type ?? null;
}

function logKey(exerciseId: string, setNumber: number): string {
  return `${exerciseId}:${setNumber}`;
}

export function useTodayData(): TodayData {
  const { today, status: dbStatus, error: dbError } = useDbState();
  const forced = forcedState();

  const athlete = useAthlete();
  const program = useCurrentProgram();
  const programId = program.data?.id;
  const weeks = useWeeks(programId);
  const blocks = useBlocks(programId);
  const week = useCurrentWeek(programId);
  const weekSessions = useSessionsByWeek(week.data?.id);
  // The cards below reach past the current week: a Saturday miss and a
  // fourteen-day break both live in weeks the week-scoped read cannot see.
  const programSessions = useSessionsBetween(program.data?.startDate, today);
  const pain = usePainStatus();

  const session = useMemo(
    () => (weekSessions.data ?? []).find((entry) => entry.scheduledDate === today) ?? null,
    [today, weekSessions.data],
  );

  const exercises = useSessionExercises(session?.id);
  const logs = useSetLogs(session?.id);

  // The climbing answers. Both are read for every athlete and are null for one
  // who never answered the questions, so the hook shape never depends on sport.
  const readinessConfig = useMemo<ReadinessTestConfig | null>(() => {
    const raw = athlete.data?.readinessConfig;
    return raw == null ? null : readReadinessConfig(raw);
  }, [athlete.data?.readinessConfig]);

  const readinessDay = useReadinessToday(readinessConfig?.kind ?? 'seated_mb_throw');
  const fingerAnswerQuery = useFingerPain();

  const readiness = useMemo<ReadinessRowModel | null>(() => {
    const day = readinessDay.data;
    if (readinessConfig === null || day == null) return null;
    return readinessRowModel({
      config: readinessConfig,
      whoop: whoopChannel(day.whoop),
      test: toEngineTest(day.test),
      history: toEngineTests(day.history),
    });
  }, [readinessConfig, readinessDay.data]);

  const fingerAsked = useMemo(
    () => hasHardFingerWork(exercises.data ?? []),
    [exercises.data],
  );
  const fingerPainCeiling = athlete.data?.fingerPainCeiling ?? defaultFingerPainCeiling();
  const fingerAnswer = fingerAnswerQuery.data ?? null;
  const medBallLb = useMemo(
    () => medBallWeightLb(athlete.data?.inventory),
    [athlete.data?.inventory],
  );

  const readinessOutcome = readiness?.outcome ?? null;
  const wallWork = useMemo(
    () => readWallWork(athlete.data?.wallWork ?? null),
    [athlete.data?.wallWork],
  );
  const sessionWindow = useMemo(
    () => readSessionWindow(athlete.data?.sessionWindow ?? null),
    [athlete.data?.sessionWindow],
  );

  const plan = useMemo(() => {
    if (session === null || exercises.data === undefined) return null;
    return buildTodaySession(exercises.data, session.snapshot, {
      sorenessPre: session.sorenessPre,
      readiness: readinessOutcome,
      fingerPain: fingerAnswer?.value ?? null,
      fingerPainCeiling,
      medBallLb,
      wallWork,
      sessionWindow,
    });
  }, [
    exercises.data,
    fingerAnswer?.value,
    fingerPainCeiling,
    medBallLb,
    readinessOutcome,
    session,
    sessionWindow,
    wallWork,
  ]);

  const { repsByExercise, loggedByExercise, logByKey } = useMemo(() => {
    const reps = new Map<string, Map<number, number>>();
    const logged = new Map<string, Set<number>>();
    const byKey = new Map<string, SetLog>();

    for (const log of logs.data ?? []) {
      const forExercise = logged.get(log.sessionExerciseId) ?? new Set<number>();
      forExercise.add(log.setNumber);
      logged.set(log.sessionExerciseId, forExercise);

      if (log.repsDone !== null) {
        const counts = reps.get(log.sessionExerciseId) ?? new Map<number, number>();
        counts.set(log.setNumber, log.repsDone);
        reps.set(log.sessionExerciseId, counts);
      }
      byKey.set(logKey(log.sessionExerciseId, log.setNumber), log);
    }

    return { repsByExercise: reps, loggedByExercise: logged, logByKey: byKey };
  }, [logs.data]);

  const all = weekSessions.data ?? [];

  const nextSession = useMemo(
    () =>
      [...all]
        .filter((entry) => entry.scheduledDate > today)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0] ?? null,
    [all, today],
  );

  const past = programSessions.data ?? [];

  const missedSession = useMemo(() => {
    const from = addDays(today, -MISSED_WINDOW_DAYS);
    return (
      [...past]
        .filter(
          (entry) =>
            entry.status === 'missed' &&
            entry.scheduledDate < today &&
            entry.scheduledDate >= from &&
            !entry.dismissed,
        )
        .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0] ?? null
    );
  }, [past, today]);

  const nextTest = useMemo<NextTest>(() => {
    const testSession = all.find((entry) => entry.testStatus !== null);
    if (testSession === undefined) {
      return { weekday: null, inDays: null, isToday: false, done: false };
    }
    const isToday = testSession.scheduledDate === today;
    return {
      weekday: weekdayLabelOf(
        testSession.scheduledDate,
        new Date(`${testSession.scheduledDate}T00:00:00Z`).getUTCDay(),
      ),
      inDays: daysBetween(today, testSession.scheduledDate),
      isToday,
      done: testSession.testStatus === 'done',
    };
  }, [all, today]);

  const lastCompletedDate = useMemo(() => {
    const done = [...past]
      .filter((entry) => entry.status === 'done' && entry.scheduledDate < today)
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0];
    return done?.scheduledDate ?? null;
  }, [past, today]);

  const isWeekFinalWorkout = useMemo(() => {
    if (session === null) return false;
    const later = all.filter((entry) => entry.scheduledDate > session.scheduledDate);
    return later.length === 0;
  }, [all, session]);

  const restrictedPain =
    (pain.data ?? []).find(
      (entry) => entry.severityDerived === 'severe' && entry.clearedAt === null,
    ) ?? null;
  const restricted = restrictedPain !== null;

  // A declined question is a decision, so it outlives the component that asked.
  const skipped = useKvValue(sorenessSkipKey(session?.id ?? 'none'));
  const readinessDeclined = useKvValue(readinessSkipKey(session?.id ?? 'none'));

  const queries = [athlete, program, weeks, blocks, week];
  const loading =
    dbStatus === 'opening' || queries.some((query) => query.isPending && query.fetchStatus !== 'idle');
  const failed = queries.find((query) => query.error instanceof Error)?.error ?? null;

  const status: TodayData['status'] =
    dbStatus === 'error' || failed !== null ? 'error' : loading ? 'loading' : 'ready';

  const freshest = Math.max(0, ...queries.map((query) => query.dataUpdatedAt));

  return {
    status,
    error: dbError ?? (failed instanceof Error ? failed : null),
    cachedAt: freshest > 0 ? new Date(freshest).toISOString() : null,
    today,
    athlete: athlete.data ?? null,
    program: program.data ?? null,
    week: week.data ?? null,
    totalWeeks: skeletonWeekCount(program.data?.snapshot) ?? weeks.data?.length ?? 0,
    blockType: blockFor(blocks.data ?? [], week.data ?? null),
    session,
    plan,
    logs: logs.data ?? [],
    repsByExercise,
    loggedByExercise,
    logByKey,
    weekSessions: all,
    nextSession,
    missedSession,
    nextTest,
    painStatus: pain.data ?? [],
    restricted,
    restrictedPain,
    sorenessSkipped: skipped.data !== null && skipped.data !== undefined,
    readinessConfig,
    readiness,
    readinessOutcome,
    readinessSkipped: readinessDeclined.data !== null && readinessDeclined.data !== undefined,
    fingerAsked,
    fingerAnswer,
    fingerPainCeiling,
    lastCompletedDate,
    isWeekFinalWorkout,
    forced,
  };
}

export { logKey };
