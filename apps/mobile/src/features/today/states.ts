/**
 * Forcing a Today state in development.
 *
 * Section 06 lists states that depend on a calendar the fixture cannot be in
 * two of at once: a rest day and a test day are different Thursdays. Rather
 * than fake data, this reads one environment variable and one query parameter
 * and tells the screen which branch to take, so a reviewer can walk every state
 * without editing the database.
 *
 * `EXPO_PUBLIC_TODAY_STATE=rest` or, on the web, `?today=rest`.
 */

export type TodayForcedState =
  | 'none'
  | 'loading'
  | 'error'
  | 'rest'
  | 'done'
  | 'notFinished'
  | 'coachMark'
  | 'missed'
  | 'reentry'
  | 'reassess';

const STATES: readonly TodayForcedState[] = [
  'none',
  'loading',
  'error',
  'rest',
  'done',
  'notFinished',
  'coachMark',
  'missed',
  'reentry',
  'reassess',
];

function normalize(value: string | null | undefined): TodayForcedState {
  if (value == null) return 'none';
  const found = STATES.find((state) => state === value);
  return found ?? 'none';
}

/**
 * Read once per render, never cached: the web reads the URL so a reviewer can
 * change it without a reload, and the guard keeps the static render pass off
 * `window`.
 */
export function forcedState(): TodayForcedState {
  const fromEnv = normalize(process.env['EXPO_PUBLIC_TODAY_STATE']);
  if (fromEnv !== 'none') return fromEnv;

  if (typeof window === 'undefined' || typeof window.location === 'undefined') return 'none';
  try {
    const params = new URLSearchParams(window.location.search);
    return normalize(params.get('today'));
  } catch {
    return 'none';
  }
}
