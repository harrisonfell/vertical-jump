import type { LandingQuality, WeekKind } from '@vert/engine';
import { formatInteger, kgToLb } from '@vert/engine/units';
import { formatCount } from '@vert/engine/analytics';
import { EditWindowClosedError } from '../../data/store/setLogs';
import { REVOKED_MATCH_LINE } from '../whoop/copy';

/**
 * What finishing a session decides.
 *
 * Two things happen at the end of a workout that nothing else can do: the
 * height ladders take their rung for the week, and, on the week's last
 * scheduled workout, the next week is built. Both are the caller's job (the
 * engine's generator reads ladder state, it does not advance it), so the rules
 * live here, pure, and the sheet only calls them.
 */

export interface LadderState {
  readonly rung: number;
  readonly advancesThisBlock: number;
}

/** At most two rungs in one block, and never more than one in a week. */
export const MAX_ADVANCES_PER_BLOCK = 2;

/**
 * A ladder advances one rung when every landing it was rated on was Good or
 * OK. A Poor landing holds it. Reduced weeks (deload, taper) hold everything:
 * a week that cut the volume in half has not earned a higher box.
 */
export function advanceLadder(
  state: LadderState,
  landings: readonly LandingQuality[],
  weekKind: WeekKind,
  maxPerBlock: number = MAX_ADVANCES_PER_BLOCK,
): LadderState {
  if (weekKind !== 'load') return state;
  if (landings.length === 0) return state;
  if (landings.some((landing) => landing === 'poor')) return state;
  if (state.advancesThisBlock >= maxPerBlock) return state;
  return { rung: state.rung + 1, advancesThisBlock: state.advancesThisBlock + 1 };
}

/** The same decision across every ladder the week touched. */
export function advanceLadders(
  state: Readonly<Record<string, LadderState>>,
  landings: Readonly<Record<string, readonly LandingQuality[]>>,
  weekKind: WeekKind,
  maxPerBlock: number = MAX_ADVANCES_PER_BLOCK,
): Record<string, LadderState> {
  const next: Record<string, LadderState> = {};
  for (const [ladderId, current] of Object.entries(state)) {
    next[ladderId] = advanceLadder(current, landings[ladderId] ?? [], weekKind, maxPerBlock);
  }
  for (const [ladderId, quality] of Object.entries(landings)) {
    if (next[ladderId] !== undefined) continue;
    next[ladderId] = advanceLadder({ rung: 0, advancesThisBlock: 0 }, quality, weekKind, maxPerBlock);
  }
  return next;
}

/* ------------------------------------------------------------- summaries */

export interface DoneSummary {
  readonly setsLogged: number;
  readonly setsPlanned: number;
  readonly minutes: number | null;
  readonly contacts: number;
  readonly tonnageKg: number;
  readonly sessionRpe: number | null;
}

/** "18 of 18 sets · 74 min · 112 contacts · 12,450 lb · RPE 8". */
export function doneSummaryLine(summary: DoneSummary): string {
  const parts = [`${formatInteger(summary.setsLogged)} of ${formatInteger(summary.setsPlanned)} sets`];
  if (summary.minutes !== null && summary.minutes > 0) {
    parts.push(`${formatInteger(summary.minutes)} min`);
  }
  if (summary.contacts > 0) parts.push(`${formatInteger(summary.contacts)} contacts`);
  // Tonnage is the one four-figure number on the screen, so it groups.
  if (summary.tonnageKg > 0) parts.push(`${formatCount(kgToLb(summary.tonnageKg))} lb`);
  if (summary.sessionRpe !== null) parts.push(`RPE ${summary.sessionRpe}`);
  return parts.join(' · ');
}

/** "Not finished · 7/18 sets · counts as missed unless you finish it". */
export function notFinishedLine(logged: number, planned: number, weekBuilt: boolean, w: number): string {
  if (weekBuilt) {
    return `Finished after week ${formatInteger(w)} was built · counts in the ledger, week ${formatInteger(
      w,
    )} unchanged`;
  }
  return `Not finished · ${formatInteger(logged)}/${formatInteger(
    planned,
  )} sets · counts as missed unless you finish it`;
}

/** Whoop matches a workout after the fact, so the summary says how long it waits. */
export const AWAITING_WORKOUT = 'Whoop: awaiting workout (checks for 24 h)';

export interface WhoopWaitInput {
  readonly connectionStatus: string | null;
  readonly workoutLinked: boolean;
}

/**
 * What the summary can honestly say about the Whoop workout.
 *
 * "Checks for 24 h" is a promise only a live connection can keep, so a phone
 * that never connected, or one whose connection was revoked, says something
 * else or says nothing at all (brief section 06 "Revoked").
 */
export function whoopWaitLine({
  connectionStatus,
  workoutLinked,
}: WhoopWaitInput): string | null {
  if (workoutLinked) return null;
  if (connectionStatus === 'revoked' || connectionStatus === 'error') return REVOKED_MATCH_LINE;
  if (connectionStatus === 'connected' || connectionStatus === 'connecting') {
    return AWAITING_WORKOUT;
  }
  return null;
}

/** The Finish sheet's own chips. Session RPE is 6 to 10, legs feel is three words. */
export const SESSION_RPE_SCALE: readonly number[] = [6, 7, 8, 9, 10];
export const LEGS_FEEL: readonly { readonly value: 'fresh' | 'normal' | 'heavy'; readonly label: string }[] =
  [
    { value: 'fresh', label: 'Fresh' },
    { value: 'normal', label: 'Normal' },
    { value: 'heavy', label: 'Heavy' },
  ];

/** Minutes between the first tap and the finish tap, never negative. */
export function sessionMinutes(startedAt: string | null, finishedAt: string | null): number | null {
  if (startedAt === null) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt === null ? Date.now() : new Date(finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = Math.round((end - start) / 60000);
  return minutes > 0 ? minutes : null;
}

/** Sets stay editable for a week after the session (brief section 06). */
export const EDIT_WINDOW_DAYS = 7;

/**
 * Errors name the cause they actually have. The seven-day window is a real
 * refusal with a class behind it; everything else is a write that did not land,
 * and telling the athlete their set is too old to edit when the database simply
 * failed sends them to delete and re-log a row that was never stale.
 */
export function editErrorLine(error: unknown): string {
  if (error instanceof EditWindowClosedError) return error.message;
  return "Couldn't save that change. Check your connection, then save again.";
}
