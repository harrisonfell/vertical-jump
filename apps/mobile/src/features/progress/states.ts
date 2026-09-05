import { inToMm, mmToIn } from '@vert/engine/units';
import type { JumpTestWithReps } from '@/data';
import { addDays } from '../../ui/charts/scale';
import type { ProgressSources } from './types';

/**
 * Forcing the states of brief section 06 in development.
 *
 * The owner fixture is one honest moment: week 7, six tests, behind pace. The
 * states either side of it (no tests, plateau, goal met, the target date gone
 * by, the program finished) are real readings of real data, so they are
 * reached by reshaping the rows rather than by faking a screen. Off in
 * production: the override is read once and ignored unless __DEV__ is set.
 */
export const PROGRESS_STATES = [
  'default',
  'no-tests',
  'one-test',
  'three-tests',
  'goal-met',
  'goal-acknowledged',
  'plateau',
  'target-passed',
  'program-complete',
  'instrument-changed',
  'device-changed',
  'whoop-importing',
  'no-whoop',
] as const;

export type ProgressState = (typeof PROGRESS_STATES)[number];

function isState(value: string | null | undefined): value is ProgressState {
  return value !== null && value !== undefined && (PROGRESS_STATES as readonly string[]).includes(value);
}

/**
 * The override, from `?state=` on the web or EXPO_PUBLIC_PROGRESS_STATE.
 * Guarded behind a platform check so the static web render never touches
 * `window`.
 */
export function progressStateOverride(): ProgressState {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return 'default';
  const fromEnv = process.env.EXPO_PUBLIC_PROGRESS_STATE;
  if (isState(fromEnv)) return fromEnv;
  // Native has a `window` global too, but no `location`; the static web render
  // has neither, so both are checked before either is read.
  if (typeof window === 'undefined' || typeof window.location === 'undefined') return 'default';
  try {
    const value = new URL(window.location.href).searchParams.get('state');
    return isState(value) ? value : 'default';
  } catch {
    return 'default';
  }
}

function withHeight(test: JumpTestWithReps, heightMm: number): JumpTestWithReps {
  return {
    ...test,
    bestHeightMm: heightMm,
    reps: test.reps.map((rep, index) => ({
      ...rep,
      heightMm: index === 0 ? heightMm : Math.round(heightMm - index * 3),
    })),
  };
}

/** Reshape the loaded rows so one section-06 state is the honest reading. */
export function applyProgressState(
  sources: ProgressSources,
  state: ProgressState,
): ProgressSources {
  const tests = sources.tests;
  const canonical = tests.filter((test) => test.canonical && !test.isBaseline);
  const newest = canonical[canonical.length - 1];

  switch (state) {
    case 'no-tests':
      return { ...sources, tests: tests.filter((test) => test.isBaseline) };

    case 'one-test':
      return {
        ...sources,
        tests: [...tests.filter((test) => test.isBaseline), ...canonical.slice(0, 1)],
      };

    case 'three-tests':
      return {
        ...sources,
        tests: [...tests.filter((test) => test.isBaseline), ...canonical.slice(0, 3)],
      };

    case 'goal-met':
    case 'goal-acknowledged': {
      const goalMm = sources.athlete?.goalHeightMm ?? inToMm(36);
      if (newest === undefined) return sources;
      const raised = withHeight(newest, goalMm + inToMm(0.5));
      return {
        ...sources,
        tests: tests.map((test) => (test.id === newest.id ? raised : test)),
        goalAcknowledgedAt: state === 'goal-acknowledged' ? sources.today : null,
      };
    }

    case 'plateau': {
      const flat = canonical.slice(-5);
      const anchor = flat[0]?.bestHeightMm ?? inToMm(32);
      const flattened = new Map(
        flat.map((test, index) => [test.id, withHeight(test, anchor + inToMm(index * 0.1))]),
      );
      return {
        ...sources,
        tests: tests.map((test) => flattened.get(test.id) ?? test),
      };
    }

    case 'target-passed':
      return { ...sources, today: addDays(sources.athlete?.targetDate ?? sources.today, 3) };

    case 'program-complete':
      return {
        ...sources,
        today: addDays(sources.program?.endDate ?? sources.today, 1),
        programAcknowledgedAt: null,
      };

    case 'instrument-changed': {
      if (newest === undefined) return sources;
      const moved: JumpTestWithReps = {
        ...newest,
        id: `${newest.id}-vertec`,
        instrument: 'vertec_reach_touch',
        mode: 'reach_touch',
        isPr: false,
        localDate: addDays(newest.localDate, 7),
      };
      return { ...sources, tests: [...tests, moved] };
    }

    case 'device-changed': {
      if (newest === undefined) return sources;
      const updated: JumpTestWithReps = {
        ...newest,
        id: `${newest.id}-v21`,
        connectVersion: '2.1',
        isPr: false,
        localDate: addDays(newest.localDate, 7),
      };
      return { ...sources, tests: [...tests, updated] };
    }

    case 'whoop-importing':
      return {
        ...sources,
        connection:
          sources.connection === null
            ? null
            : { ...sources.connection, status: 'connecting', backfillDaysDone: 40, backfillDaysTotal: 90 },
      };

    case 'no-whoop':
      return { ...sources, recovery: [], sleep: [], workouts: [], connection: null };

    case 'default':
      return sources;
  }
}

/** A one-line description of what the override is showing, for the dev bar. */
export function describeState(state: ProgressState, goalHeightMm: number | null): string {
  if (state === 'default') return '';
  const goalIn = goalHeightMm === null ? '' : ` (goal ${mmToIn(goalHeightMm).toFixed(1)} in)`;
  return `Dev state: ${state}${goalIn}`;
}
