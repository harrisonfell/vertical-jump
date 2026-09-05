import { create } from 'zustand';

/**
 * Ephemeral session UI. Almost nothing here is durable: every fact that matters
 * is a row in the local database, and this store mostly remembers what the
 * athlete is looking at right now. Losing it costs a scroll position, never a
 * logged set.
 *
 * The one exception is the rest timer. iOS reclaims a backgrounded app hard,
 * and a 3:00 rest with the screen off is exactly when it happens; coming back
 * to a runner with no bar and no idea how long you have been standing there is
 * not a lost scroll position. So the rest timer is written through to a store
 * the app installs (the kv table), and read back on boot.
 */

export interface RestTimer {
  /** The instant the rest ends, so a backgrounded app recomputes rather than ticks. */
  readonly endsAt: string;
  /** "set 2 · 4 × 220 lb (+15 lb)". Rendered by the rest bar, built by the runner. */
  readonly nextLabel: string;
  readonly sessionId: string;
  /**
   * The scheduled local notification, so any mount can cancel it.
   *
   * Held here rather than in a ref inside the rest hook: the ref dies with the
   * component and the timer does not, so tapping Finish and coming back left
   * a notification nothing could cancel, and the phone buzzed mid-rep.
   */
  readonly notificationId?: string | null;
}

export interface SessionUiState {
  readonly activeSessionId: string | null;
  readonly restTimer: RestTimer | null;
  /** Exercise ids the athlete has expanded, or kept open after finishing them. */
  readonly expandedExerciseIds: readonly string[];
  /** Mirrored from kv so a coach mark never flashes while the read is in flight. */
  readonly dismissedCoachMarks: readonly string[];

  setActiveSession(sessionId: string | null): void;
  startRest(timer: RestTimer): void;
  stopRest(): void;
  toggleExercise(exerciseId: string): void;
  setExpandedExercises(ids: readonly string[]): void;
  setDismissedCoachMarks(marks: readonly string[]): void;
  dismissCoachMark(mark: string): void;
  reset(): void;
}

const EMPTY: readonly string[] = [];

export const useSessionStore = create<SessionUiState>((set) => ({
  activeSessionId: null,
  restTimer: null,
  expandedExerciseIds: EMPTY,
  dismissedCoachMarks: EMPTY,

  setActiveSession: (sessionId) =>
    set((state) =>
      state.activeSessionId === sessionId
        ? state
        : { activeSessionId: sessionId, expandedExerciseIds: EMPTY },
    ),

  // One rest at a time: a second tap replaces the bar rather than stacking one.
  startRest: (timer) => {
    set({ restTimer: timer });
    void writeRestTimer(timer);
  },
  stopRest: () => {
    set({ restTimer: null });
    void writeRestTimer(null);
  },

  toggleExercise: (exerciseId) =>
    set((state) => ({
      expandedExerciseIds: state.expandedExerciseIds.includes(exerciseId)
        ? state.expandedExerciseIds.filter((id) => id !== exerciseId)
        : [...state.expandedExerciseIds, exerciseId],
    })),

  setExpandedExercises: (ids) => set({ expandedExerciseIds: [...ids] }),

  setDismissedCoachMarks: (marks) => set({ dismissedCoachMarks: [...marks] }),

  dismissCoachMark: (mark) =>
    set((state) =>
      state.dismissedCoachMarks.includes(mark)
        ? state
        : { dismissedCoachMarks: [...state.dismissedCoachMarks, mark] },
    ),

  reset: () => {
    set({
      activeSessionId: null,
      restTimer: null,
      expandedExerciseIds: EMPTY,
      dismissedCoachMarks: EMPTY,
    });
    void writeRestTimer(null);
  },
}));

/* --------------------------------------------------------- rest timer store */

/**
 * Where the rest timer is kept across a relaunch. The app installs one backed
 * by the kv table; tests and the static render pass install nothing and the
 * store stays purely in memory.
 */
export interface RestTimerStorage {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
}

let restStorage: RestTimerStorage | null = null;

export function setRestTimerStorage(next: RestTimerStorage | null): void {
  restStorage = next;
}

async function writeRestTimer(timer: RestTimer | null): Promise<void> {
  if (restStorage === null) return;
  await restStorage.write(timer === null ? null : JSON.stringify(timer));
}

/**
 * Reads a stored rest back, or null.
 *
 * A rest that has already run out is dropped rather than resurrected: a bar
 * counting 0:00 from three days ago is worse than no bar. Anything unparseable
 * is dropped for the same reason.
 */
export function parseRestTimer(raw: string | null, now: Date = new Date()): RestTimer | null {
  if (raw === null || raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const { endsAt, nextLabel, sessionId, notificationId } = record;
  const shaped =
    typeof endsAt === 'string' && typeof nextLabel === 'string' && typeof sessionId === 'string';
  if (!shaped) return null;
  if (remainingSeconds(endsAt, now) === 0) return null;
  return {
    endsAt,
    nextLabel,
    sessionId,
    ...(typeof notificationId === 'string' ? { notificationId } : null),
  };
}

/** Reads the stored rest on boot and puts it back on screen if it is still running. */
export async function hydrateRestTimer(now: Date = new Date()): Promise<RestTimer | null> {
  if (restStorage === null) return null;
  const timer = parseRestTimer(await restStorage.read(), now);
  if (timer === null) {
    await restStorage.write(null);
    return null;
  }
  useSessionStore.setState({ restTimer: timer });
  return timer;
}

/* ------------------------------------------------------------ rest timer */

/**
 * Seconds left on a rest, rounded up so the bar shows 3:00 for the whole first
 * second rather than 2:59. Never negative, and 0 for anything unparseable: a
 * broken timestamp must not leave a bar counting into the past.
 */
export function remainingSeconds(endsAt: string, now: Date = new Date()): number {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  const left = Math.ceil((end - now.getTime()) / 1000);
  return left > 0 ? left : 0;
}

/** True while a rest is still running. */
export function restIsRunning(timer: RestTimer | null, now: Date = new Date()): boolean {
  return timer !== null && remainingSeconds(timer.endsAt, now) > 0;
}

/** The instant a rest of `seconds` started now would end. */
export function restEndsAt(seconds: number, now: Date = new Date()): string {
  return new Date(now.getTime() + Math.max(0, Math.round(seconds)) * 1000).toISOString();
}

/** Selector helpers, so screens do not subscribe to the whole store. */
export const selectRestTimer = (state: SessionUiState): RestTimer | null => state.restTimer;
export const selectActiveSessionId = (state: SessionUiState): string | null =>
  state.activeSessionId;
