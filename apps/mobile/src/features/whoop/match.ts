/**
 * Matching a Whoop workout to a session (brief section 11).
 *
 * The window is [session start minus 30 minutes, session finish plus 30
 * minutes], where the finish is the marked-complete stamp or, when the session
 * was never finished, the last logged set. Maximum overlap wins. Ties break
 * first on a sport-name allowlist, then on how close the two start times are.
 *
 * Pure and unit-tested, because this runs again on every workout webhook and
 * after every reconnect, and a match that moves on its own would put someone
 * else's strain on a session the athlete already read.
 */

/** Half an hour either side, in milliseconds. */
export const WINDOW_PAD_MS = 30 * 60 * 1000;

/**
 * Sports a strength session plausibly is, best first. Whoop rarely
 * auto-detects a short low-heart-rate lifting session, so "activity" and
 * "other" stay on the list: they are what an unrecognised session becomes.
 */
export const SPORT_ALLOWLIST: readonly string[] = [
  'strength trainer',
  'weightlifting',
  'powerlifting',
  'functional fitness',
  'hiit',
  'jumping rope',
  'basketball',
  'volleyball',
  'track and field',
  'activity',
  'other',
];

export interface MatchSession {
  readonly id: string;
  /** The first row tap. Null when the session was never started. */
  readonly startedAt: string | null;
  /** The Finish tap, when there was one. */
  readonly markedCompleteAt: string | null;
  /** The last set log, which stands in for a finish that never happened. */
  readonly lastSetAt: string | null;
}

export interface MatchWorkout {
  readonly id: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly sportName: string | null;
}

export interface MatchCandidate {
  readonly workout: MatchWorkout;
  /** Seconds the workout and the session window share. */
  readonly overlapS: number;
  /** Index in the allowlist; the list length when the sport is not on it. */
  readonly sportRank: number;
  /** Milliseconds between the two start times. */
  readonly startGapMs: number;
}

export interface MatchWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

function ms(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The window a workout has to overlap. Null when the session was never
 * started: there is no window without a first row tap, and a session with no
 * logs must never absorb a workout.
 */
export function matchWindow(session: MatchSession): MatchWindow | null {
  const start = ms(session.startedAt);
  if (start === null) return null;
  const finish = ms(session.markedCompleteAt) ?? ms(session.lastSetAt) ?? start;
  return { fromMs: start - WINDOW_PAD_MS, toMs: Math.max(finish, start) + WINDOW_PAD_MS };
}

/** Where a sport sits on the allowlist. Off the list ranks last, never never. */
export function sportRank(sportName: string | null): number {
  if (sportName === null) return SPORT_ALLOWLIST.length;
  const index = SPORT_ALLOWLIST.indexOf(sportName.trim().toLowerCase());
  return index === -1 ? SPORT_ALLOWLIST.length : index;
}

/** Overlap in seconds between a workout and a window. Zero when they miss. */
export function overlapSeconds(workout: MatchWorkout, window: MatchWindow): number {
  const start = ms(workout.startAt);
  if (start === null) return 0;
  // A workout Whoop is still scoring has no end; treat it as instantaneous
  // rather than as infinitely long, so a live workout cannot outrank a
  // finished one on overlap alone.
  const end = ms(workout.endAt) ?? start;
  const from = Math.max(start, window.fromMs);
  const to = Math.min(Math.max(end, start), window.toMs);
  return to <= from ? 0 : Math.round((to - from) / 1000);
}

/** Every workout that touches the window, best first. */
export function rankCandidates(
  session: MatchSession,
  workouts: readonly MatchWorkout[],
): MatchCandidate[] {
  const window = matchWindow(session);
  if (window === null) return [];

  const start = ms(session.startedAt) ?? 0;
  const candidates: MatchCandidate[] = [];

  for (const workout of workouts) {
    const overlapS = overlapSeconds(workout, window);
    if (overlapS <= 0) continue;
    candidates.push({
      workout,
      overlapS,
      sportRank: sportRank(workout.sportName),
      startGapMs: Math.abs((ms(workout.startAt) ?? start) - start),
    });
  }

  candidates.sort((a, b) => {
    if (a.overlapS !== b.overlapS) return b.overlapS - a.overlapS;
    if (a.sportRank !== b.sportRank) return a.sportRank - b.sportRank;
    if (a.startGapMs !== b.startGapMs) return a.startGapMs - b.startGapMs;
    return a.workout.id.localeCompare(b.workout.id);
  });

  return candidates;
}

/** The one workout this session should link to, or null when none touches it. */
export function matchWorkout(
  session: MatchSession,
  workouts: readonly MatchWorkout[],
): MatchCandidate | null {
  return rankCandidates(session, workouts)[0] ?? null;
}

/**
 * "Start Strength Trainer in the Whoop app before warm-up for strain logging"
 * rides the first three sessions after connecting (brief section 11).
 */
export const STRENGTH_TRAINER_HINT =
  'Start Strength Trainer in the Whoop app before warm-up for strain logging';

/** How many sessions after connecting carry that hint. */
export const HINT_SESSIONS = 3;

/** True while the hint still applies. */
export function showsStrengthTrainerHint(sessionsSinceConnect: number): boolean {
  return sessionsSinceConnect < HINT_SESSIONS;
}
