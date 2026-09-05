/**
 * Forcing a session state in development.
 *
 * The owner fixture has done sessions and missed ones, but no session left
 * part-logged and no week built after a session was still open. `?state=` puts
 * those two in front of a reviewer without editing the fixture. Nothing here
 * writes to the database.
 */

export const SESSION_STATES = ['not-finished', 'built', 'future', 'loading'] as const;

export type SessionState = (typeof SESSION_STATES)[number];

function isSessionState(value: string): value is SessionState {
  return (SESSION_STATES as readonly string[]).includes(value);
}

/** Reads `?state=not-finished` or `?state=not-finished,built`. */
export function readSessionStates(param: string | string[] | undefined): ReadonlySet<SessionState> {
  const raw = param === undefined ? [] : Array.isArray(param) ? param : param.split(',');
  const states = new Set<SessionState>();
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (isSessionState(trimmed)) states.add(trimmed);
  }
  return states;
}
