/**
 * The one line under the header on Today and Progress.
 *
 * With no server to reach, the honest thing to render is nothing: a "Synced"
 * line with nothing to sync to would be a lie. `EXPO_PUBLIC_SERVER_URL` is what
 * turns the line on, and Settings reads the same flag. The web build sets it to
 * "/", which means this origin rather than no server, because the bundle is
 * served by the same deploy that answers `/api`.
 */

const MIDDLE_DOT = '·';

export function serverUrl(
  value: string | undefined = process.env.EXPO_PUBLIC_SERVER_URL,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Same rule as the transport's own reader: "/" is this origin, which is what
  // the web build sets, and it reads back as a base of "" so every request goes
  // out as a relative path.
  return trimmed.replace(/\/+$/, '') || '';
}

export function serverConfigured(value?: string | undefined): boolean {
  return serverUrl(value) !== null;
}

/** "1 change", "4 changes". */
export function changeCount(pending: number): string {
  return pending === 1 ? '1 change' : `${pending} changes`;
}

/** "1 day", "2 days". */
function dayCount(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

/** Whole days the oldest queued change has been waiting. */
export function waitingDays(oldestPendingAt: string | null, now: Date): number {
  if (oldestPendingAt === null) return 0;
  const oldest = new Date(oldestPendingAt).getTime();
  if (Number.isNaN(oldest)) return 0;
  return Math.max(0, Math.floor((now.getTime() - oldest) / 86_400_000));
}

/** "6:41 PM" in the reader's own locale. Not a training number. */
export function formatClock(timestamp: string, now: Date = new Date()): string | null {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  void now;
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
  } catch {
    return null;
  }
}

export interface SyncLineInput {
  readonly serverConfigured: boolean;
  /** Web reads navigator.onLine; native reads the last successful fetch. */
  readonly online: boolean;
  readonly pending: number;
  readonly oldestPendingAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly now?: Date;
}

/** After this the line stops saying "saved" and starts saying "not synced". */
export const STALE_AFTER_DAYS = 2;

/**
 * The copy, in the order brief section 06 "Offline" gives it:
 *
 *   "Offline · 4 changes saved on this phone"
 *   "Synced 6:41 PM"
 *   "4 changes not synced for 2 days"
 *
 * and nothing at all when the queue is empty with no server to sync to.
 */
export function syncLineText(input: SyncLineInput): string | null {
  if (!input.serverConfigured) return null;
  const now = input.now ?? new Date();

  if (input.pending <= 0) {
    if (input.lastSyncedAt === null) return null;
    const clock = formatClock(input.lastSyncedAt, now);
    return clock === null ? null : `Synced ${clock}`;
  }

  const days = waitingDays(input.oldestPendingAt, now);
  if (days >= STALE_AFTER_DAYS) {
    return `${changeCount(input.pending)} not synced for ${dayCount(days)}`;
  }

  const saved = `${changeCount(input.pending)} saved on this phone`;
  return input.online ? saved : `Offline ${MIDDLE_DOT} ${saved}`;
}

/**
 * How worried the line should look, which is a different question from what it
 * says. The four states map onto the copy above one for one:
 *
 *   `synced`  "Synced 6:41 PM"                    nothing is owed
 *   `queued`  "4 changes saved on this phone"     working normally, offline-first
 *   `offline` "Offline · 4 changes saved..."      the phone cannot reach the server
 *   `stale`   "4 changes not synced for 2 days"   the only copy on earth is this phone
 *
 * `queued` stays quiet on purpose. Writing to a local queue is how this app is
 * designed to work, so colouring it would train the athlete to ignore the line
 * on the day it finally matters.
 */
export type SyncLineState = 'synced' | 'queued' | 'offline' | 'stale';

export function syncLineState(input: SyncLineInput): SyncLineState | null {
  if (syncLineText(input) === null) return null;
  if (input.pending <= 0) return 'synced';
  const days = waitingDays(input.oldestPendingAt, input.now ?? new Date());
  if (days >= STALE_AFTER_DAYS) return 'stale';
  return input.online ? 'queued' : 'offline';
}
