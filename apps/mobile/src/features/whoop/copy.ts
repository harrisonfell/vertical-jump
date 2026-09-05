/**
 * Every sentence the Whoop screen can show, in one place.
 *
 * Whoop's own words are never renamed or abbreviated (brief section 11
 * "Brand and terms"), "Data by WHOOP" sits beside Whoop-sourced numbers, and
 * nothing here recommends against Whoop's own coaching. The states are the
 * ones brief section 06 enumerates, and each is reachable from the dev
 * selector on this screen.
 */
import type { analytics } from '@vert/engine';
import { formatClock } from '../../app/syncLineText';
import type { WhoopErrorKind, WhoopStatusResponse } from './client';

export const DATA_BY_WHOOP = 'Data by WHOOP';

/** The section title, spelled Whoop's way. */
export const WHOOP_TITLE = 'Whoop';

export const NO_SERVER_LINE =
  'Whoop needs the sync server, which is not part of this build yet. Everything else works offline on this phone.';

export const CONNECTING_LINE = 'Finishing connection';

export const CANCELLED_LINE = 'Connection cancelled, nothing changed.';

export const REVOKED_LINE = 'Whoop disconnected';

export const REVOKED_MATCH_LINE = 'Sessions awaiting a workout match after reconnect.';

export const AUTOREGULATION_PAUSED_LINE = 'Autoregulation paused: Whoop disconnected';

export const DISCONNECT_CONFIRM_TITLE = 'Disconnect Whoop?';

export const DISCONNECT_CONFIRM_BODY =
  'Whoop stops sending new data. The 90 days already imported stay on this phone and on the charts, and sessions keep the workouts they matched. Delete Whoop data removes them.';

export const DELETE_DATA_CONFIRM_TITLE = 'Delete Whoop data?';

export const DELETE_DATA_CONFIRM_BODY =
  'Every recovery, sleep, cycle and workout mirror is removed from this phone, and sessions lose their matched workouts. Your sessions, sets and jump tests are untouched.';

/** "Importing 90 days · 40/90" (brief section 06). */
export function importingLine(done: number, total: number): string {
  return `Importing ${total} days · ${done}/${total}`;
}

/** "Connected · last sync 6:41 AM · 88 days imported". */
export function connectedLine(status: WhoopStatusResponse, now: Date = new Date()): string {
  const parts = ['Connected'];
  const clock = status.lastSyncAt === null ? null : formatClock(status.lastSyncAt, now);
  if (clock !== null) parts.push(`last sync ${clock}`);
  if (status.backfillDaysDone > 0) parts.push(`${status.backfillDaysDone} days imported`);
  return parts.join(' · ');
}

/**
 * "Whoop's API is unavailable, retrying at 7:15" and "Rate limited, next sync
 * at 7:02" (brief section 06, verbatim).
 */
export function errorLine(
  kind: WhoopErrorKind,
  nextRetryAt: string | null,
  now: Date = new Date(),
): string {
  const clock = nextRetryAt === null ? null : formatClock(nextRetryAt, now);
  switch (kind) {
    case 'api_down':
      return clock === null
        ? "Whoop's API is unavailable, retrying shortly"
        : `Whoop's API is unavailable, retrying at ${clock}`;
    case 'rate_limited':
      return clock === null ? 'Rate limited, next sync shortly' : `Rate limited, next sync at ${clock}`;
    case 'needs_reauth':
      return 'Whoop needs authorising again. Reconnect to keep syncing.';
    case 'network':
      return 'Could not reach the sync server. Check your connection.';
  }
}

/** The one line the screen leads with, whatever state it is in. */
export function headlineFor(
  status: WhoopStatusResponse,
  configured: boolean,
  now: Date = new Date(),
): string {
  if (!configured) return NO_SERVER_LINE;
  switch (status.status) {
    case 'connecting':
      return CONNECTING_LINE;
    case 'importing':
      return importingLine(status.backfillDaysDone, status.backfillDaysTotal);
    case 'connected':
      return connectedLine(status, now);
    case 'revoked':
      return REVOKED_LINE;
    case 'error':
      return errorLine(status.lastError ?? 'network', status.nextRetryAt, now);
    case 'disconnected':
      return 'Not connected. Whoop adds recovery, sleep and strain beside your own numbers.';
  }
}

/** The noun each counted gate criterion is measured in. */
const GATE_NOUN: Readonly<Record<string, string>> = {
  scored_days: 'scored days',
  paired_days: 'paired days',
  paired_weeks: 'weeks of pairs',
  canonical_tests: 'canonical tests',
};

/**
 * "86 scored days (28 needed)": the count the athlete has first, the
 * requirement in parentheses. The engine writes the requirement first, which
 * reads as a ratio the wrong way round on the row (defect D-29). The
 * relationship criterion carries prose rather than a count, so it is passed
 * through unchanged.
 */
export function gateCriterionLine(criterion: analytics.GateCriterion): string {
  const noun = GATE_NOUN[criterion.id];
  if (noun === undefined) return criterion.line;
  return `${criterion.count} ${noun} (${criterion.needed} needed)`;
}

/** What the actions say while there is no sync server to talk to. */
export const NO_SERVER_ACTION_CAPTION = 'Available once the review server is set up.';

/** Sync now is disabled for a minute after it is used (brief section 06). */
export const SYNC_COOLDOWN_MS = 60_000;

/** Milliseconds left on the cooldown, floored at zero. */
export function cooldownRemainingMs(lastUsedAt: number | null, now: number): number {
  if (lastUsedAt === null) return 0;
  return Math.max(0, SYNC_COOLDOWN_MS - (now - lastUsedAt));
}

/** "Sync now" or "Sync now (42 s)". */
export function syncLabel(remainingMs: number): string {
  if (remainingMs <= 0) return 'Sync now';
  return `Sync now (${Math.ceil(remainingMs / 1000)} s)`;
}
