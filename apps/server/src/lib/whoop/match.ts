/**
 * Matching a Whoop workout to a session, on the server (brief section 11).
 *
 * The window is [session start minus 30 minutes, session finish plus 30
 * minutes], where the finish is the Finish tap or, when the session was never
 * finished, the last logged set. Maximum overlap wins; ties break on a
 * sport-name allowlist, then on how close the two start times are.
 *
 * The pure half is a copy of the phone's `features/whoop/match.ts` on purpose:
 * both sides must reach the same answer, and the server cannot import from
 * apps/mobile. The tests here assert the same cases the phone's do.
 *
 * This runs again on every workout webhook and after every reconnect, so a
 * workout is claimed by exactly one session: a match that quietly moved would
 * put someone else's strain on a session the athlete has already read.
 */

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { session } from '../../db/tables/mirror';
import { sessionWorkoutLink, whoopWorkout } from '../../db/tables/whoop';

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
  /** The first row tap, or the first set log. Null when never started. */
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
  readonly overlapS: number;
  readonly sportRank: number;
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
export function matchWindow(candidate: MatchSession): MatchWindow | null {
  const start = ms(candidate.startedAt);
  if (start === null) return null;
  const finish = ms(candidate.markedCompleteAt) ?? ms(candidate.lastSetAt) ?? start;
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

function compare(a: MatchCandidate, b: MatchCandidate): number {
  if (a.overlapS !== b.overlapS) return b.overlapS - a.overlapS;
  if (a.sportRank !== b.sportRank) return a.sportRank - b.sportRank;
  if (a.startGapMs !== b.startGapMs) return a.startGapMs - b.startGapMs;
  return a.workout.id.localeCompare(b.workout.id);
}

/** Every workout that touches the window, best first. */
export function rankCandidates(
  candidate: MatchSession,
  workouts: readonly MatchWorkout[],
): MatchCandidate[] {
  const window = matchWindow(candidate);
  if (window === null) return [];

  const start = ms(candidate.startedAt) ?? 0;
  const ranked: MatchCandidate[] = [];
  for (const workout of workouts) {
    const overlapS = overlapSeconds(workout, window);
    if (overlapS <= 0) continue;
    ranked.push({
      workout,
      overlapS,
      sportRank: sportRank(workout.sportName),
      startGapMs: Math.abs((ms(workout.startAt) ?? start) - start),
    });
  }
  ranked.sort(compare);
  return ranked;
}

/** The one workout this session should link to, or null when none touches it. */
export function matchWorkout(
  candidate: MatchSession,
  workouts: readonly MatchWorkout[],
): MatchCandidate | null {
  return rankCandidates(candidate, workouts)[0] ?? null;
}

/* ------------------------------------------------------------- the store */

/** A day either side, so a session late on the 3rd sees a workout on the 4th. */
const DAY_MS = 86_400_000;

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The sessions in a date range, with start and finish derived from their
 * events and logs rather than from a stored status stamp, exactly as the
 * phone derives them.
 */
export async function loadMatchSessions(
  db: Database,
  fromDate: string,
  toDate: string,
): Promise<MatchSession[]> {
  // The outer table is spelled out rather than interpolated: drizzle renders a
  // column reference unqualified, and an unqualified "id" inside these
  // subqueries would bind to the subquery's own table.
  const outer = '"session"."id"';
  const startedAt = sql<string | null>`coalesce(
    (select min(e.at) from session_event e where e.session_id = ${sql.raw(outer)} and e.kind = 'start'),
    (select min(l.completed_at) from set_log l
      where l.session_id = ${sql.raw(outer)} and l.deleted_at is null))`;
  const markedCompleteAt = sql<string | null>`(
    select e.at from session_event e
     where e.session_id = ${sql.raw(outer)} and e.kind = 'complete'
       and e.at > coalesce((select max(u.at) from session_event u
                             where u.session_id = ${sql.raw(outer)} and u.kind = 'uncomplete'), '')
     order by e.at desc limit 1)`;
  const lastSetAt = sql<string | null>`(
    select max(l.completed_at) from set_log l
     where l.session_id = ${sql.raw(outer)} and l.deleted_at is null)`;

  return db
    .select({ id: session.id, startedAt, markedCompleteAt, lastSetAt })
    .from(session)
    .where(and(gte(session.scheduledDate, fromDate), lte(session.scheduledDate, toDate)));
}

/** The workouts whose start falls inside a window, oldest first. */
export async function loadMatchWorkouts(
  db: Database,
  fromIso: string,
  toIso: string,
): Promise<MatchWorkout[]> {
  return db
    .select({
      id: whoopWorkout.id,
      startAt: whoopWorkout.startAt,
      endAt: whoopWorkout.endAt,
      sportName: whoopWorkout.sportName,
    })
    .from(whoopWorkout)
    .where(and(gte(whoopWorkout.startAt, fromIso), lte(whoopWorkout.startAt, toIso)))
    .orderBy(whoopWorkout.startAt);
}

export interface RelinkResult {
  readonly linked: number;
  readonly unlinked: number;
  readonly unchanged: number;
}

interface Pair {
  readonly sessionId: string;
  readonly candidate: MatchCandidate;
}

/**
 * Re-runs the match over one window and writes the links.
 *
 * A workout belongs to exactly one session, so the pairs are taken best first
 * and a workout already claimed is skipped: two sessions an hour apart cannot
 * both show the same strain. A link the owner made by hand is never moved.
 */
export async function relinkSessions(
  db: Database,
  options: { readonly from: Date; readonly to: Date; readonly now?: Date },
): Promise<RelinkResult> {
  const now = options.now ?? new Date();
  const fromDate = isoDate(new Date(options.from.getTime() - DAY_MS));
  const toDate = isoDate(new Date(options.to.getTime() + DAY_MS));
  const sessions = await loadMatchSessions(db, fromDate, toDate);
  if (sessions.length === 0) return { linked: 0, unlinked: 0, unchanged: 0 };

  const workouts = await loadMatchWorkouts(
    db,
    new Date(options.from.getTime() - DAY_MS).toISOString(),
    new Date(options.to.getTime() + DAY_MS).toISOString(),
  );

  const existing = await db
    .select()
    .from(sessionWorkoutLink)
    .where(
      inArray(
        sessionWorkoutLink.sessionId,
        sessions.map((row) => row.id),
      ),
    );
  const bySession = new Map(existing.map((row) => [row.sessionId, row]));

  const takenSessions = new Set<string>();
  const takenWorkouts = new Set<string>();
  for (const link of existing) {
    if (link.matchSource !== 'manual') continue;
    takenSessions.add(link.sessionId);
    takenWorkouts.add(link.whoopWorkoutId);
  }

  const pairs: Pair[] = [];
  for (const candidate of sessions) {
    if (takenSessions.has(candidate.id)) continue;
    for (const ranked of rankCandidates(candidate, workouts)) {
      pairs.push({ sessionId: candidate.id, candidate: ranked });
    }
  }
  pairs.sort((a, b) => compare(a.candidate, b.candidate));

  const chosen = new Map<string, MatchCandidate>();
  for (const pair of pairs) {
    if (takenSessions.has(pair.sessionId) || takenWorkouts.has(pair.candidate.workout.id)) continue;
    takenSessions.add(pair.sessionId);
    takenWorkouts.add(pair.candidate.workout.id);
    chosen.set(pair.sessionId, pair.candidate);
  }

  let linked = 0;
  let unlinked = 0;
  let unchanged = 0;

  for (const candidate of sessions) {
    const link = bySession.get(candidate.id);
    if (link !== undefined && link.matchSource === 'manual') {
      unchanged += 1;
      continue;
    }
    const best = chosen.get(candidate.id);
    if (best === undefined) {
      if (link !== undefined) {
        await db.delete(sessionWorkoutLink).where(eq(sessionWorkoutLink.sessionId, candidate.id));
        unlinked += 1;
      }
      continue;
    }
    if (link !== undefined && link.whoopWorkoutId === best.workout.id && link.overlapS === best.overlapS) {
      unchanged += 1;
      continue;
    }
    await db
      .insert(sessionWorkoutLink)
      .values({
        sessionId: candidate.id,
        whoopWorkoutId: best.workout.id,
        matchSource: 'auto',
        overlapS: best.overlapS,
        linkedAt: now.toISOString(),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessionWorkoutLink.sessionId,
        set: {
          whoopWorkoutId: best.workout.id,
          matchSource: 'auto',
          overlapS: best.overlapS,
          linkedAt: now.toISOString(),
          updatedAt: now,
        },
      });
    linked += 1;
  }

  return { linked, unlinked, unchanged };
}

/** One workout changed, so only the days around it need looking at again. */
export async function relinkAroundWorkout(
  db: Database,
  workoutId: string,
  now: Date = new Date(),
): Promise<RelinkResult> {
  const rows = await db
    .select({ startAt: whoopWorkout.startAt, endAt: whoopWorkout.endAt })
    .from(whoopWorkout)
    .where(eq(whoopWorkout.id, workoutId));
  const row = rows[0];
  if (row === undefined) return { linked: 0, unlinked: 0, unchanged: 0 };
  const start = new Date(row.startAt);
  const end = row.endAt === null ? start : new Date(row.endAt);
  if (Number.isNaN(start.getTime())) return { linked: 0, unlinked: 0, unchanged: 0 };
  return relinkSessions(db, { from: start, to: Number.isNaN(end.getTime()) ? start : end, now });
}
