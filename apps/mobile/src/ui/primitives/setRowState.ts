/**
 * The set row's state machine, kept pure and import-free.
 *
 * The runner's whole contract lives here: one tap logs a set as written, a
 * second tap inside the session undoes it, a timed row counts down in the row,
 * an RPE row expands to a load and an effort before it can be logged, and a
 * ladder's last set asks how the landing felt for five seconds and defaults to
 * Good if nobody answers. Nothing here knows about React.
 */

export type SetRowKind = 'loadable' | 'bodyweight' | 'timed' | 'distance' | 'rpe';

export type LandingQuality = 'good' | 'ok' | 'poor';

/** The five landing seconds, from the brief's interaction section. */
export const LANDING_SECONDS = 5;

export interface SetRowConfig {
  readonly kind: SetRowKind;
  /** Seconds for a timed row: "30 s hold". */
  readonly durationS?: number;
  /** True on the last set of a height-ladder exercise. */
  readonly promptsLanding?: boolean;
  /** Prefill for an RPE row: last set of this lift, then last session. */
  readonly initialLoadLb?: number | null;
}

export type SetRowPhase = 'idle' | 'expanded' | 'running' | 'landing';

export interface SetRowState {
  readonly done: boolean;
  readonly phase: SetRowPhase;
  /** RPE mode only: the load the athlete used. */
  readonly loadLb: number | null;
  /** RPE mode only: 6 to 10, optional and never defaulted. */
  readonly rpe: number | null;
  /** Timed rows: seconds left while running, seconds held once logged. */
  readonly secondsRemaining: number | null;
  readonly secondsHeld: number | null;
  readonly landing: LandingQuality | null;
  /** Seconds left on the landing prompt before it settles on Good. */
  readonly landingCountdown: number | null;
}

export type SetRowEvent =
  /** The row itself was tapped. */
  | { readonly type: 'press' }
  /** One second passed, for a countdown or the landing prompt. */
  | { readonly type: 'tick' }
  | { readonly type: 'setLoad'; readonly loadLb: number }
  | { readonly type: 'setRpe'; readonly rpe: number }
  /** The Log control inside an expanded RPE row. */
  | { readonly type: 'log' }
  | { readonly type: 'landing'; readonly quality: LandingQuality }
  /** Explicit undo, from a long press or an edit sheet. */
  | { readonly type: 'undo' }
  /**
   * The store spoke. The row's tick is optimistic, so when the log underneath
   * it says otherwise (a remount, a refetch, an undo from another surface) the
   * store wins and nothing is reported back outward.
   */
  | { readonly type: 'reconcile'; readonly done: boolean };

export function initialSetRowState(config: SetRowConfig, done = false): SetRowState {
  return {
    done,
    phase: 'idle',
    loadLb: config.initialLoadLb ?? null,
    rpe: null,
    secondsRemaining: null,
    secondsHeld: null,
    landing: null,
    landingCountdown: null,
  };
}

/** True when the row holds everything it needs to be written to the log. */
export function canLog(state: SetRowState, config: SetRowConfig): boolean {
  if (config.kind !== 'rpe') return true;
  return state.loadLb !== null;
}

function finish(state: SetRowState, config: SetRowConfig, patch: Partial<SetRowState>): SetRowState {
  const landingPhase = config.promptsLanding === true;
  return {
    ...state,
    ...patch,
    done: true,
    phase: landingPhase ? 'landing' : 'idle',
    landingCountdown: landingPhase ? LANDING_SECONDS : null,
  };
}

function undo(state: SetRowState, config: SetRowConfig): SetRowState {
  return {
    ...initialSetRowState(config, false),
    loadLb: state.loadLb,
  };
}

export function setRowReducer(
  state: SetRowState,
  event: SetRowEvent,
  config: SetRowConfig,
): SetRowState {
  switch (event.type) {
    case 'press': {
      if (state.phase === 'landing') return state;

      if (state.done) return undo(state, config);

      if (config.kind === 'timed') {
        if (state.phase === 'running') {
          const remaining = state.secondsRemaining ?? 0;
          const total = config.durationS ?? 0;
          return finish(state, config, {
            secondsRemaining: null,
            secondsHeld: Math.max(0, total - remaining),
          });
        }
        return {
          ...state,
          phase: 'running',
          secondsRemaining: config.durationS ?? 0,
          secondsHeld: null,
        };
      }

      if (config.kind === 'rpe') {
        return { ...state, phase: state.phase === 'expanded' ? 'idle' : 'expanded' };
      }

      return finish(state, config, {});
    }

    case 'tick': {
      if (state.phase === 'running') {
        const remaining = (state.secondsRemaining ?? 0) - 1;
        if (remaining > 0) return { ...state, secondsRemaining: remaining };
        return finish(state, config, {
          secondsRemaining: null,
          secondsHeld: config.durationS ?? 0,
        });
      }
      if (state.phase === 'landing') {
        const left = (state.landingCountdown ?? 0) - 1;
        if (left > 0) return { ...state, landingCountdown: left };
        return { ...state, phase: 'idle', landingCountdown: null, landing: state.landing ?? 'good' };
      }
      return state;
    }

    case 'setLoad':
      return { ...state, loadLb: event.loadLb };

    case 'setRpe':
      return { ...state, rpe: event.rpe };

    case 'log': {
      if (state.done || !canLog(state, config)) return state;
      return finish(state, config, {});
    }

    case 'landing': {
      if (state.phase !== 'landing') return state;
      return { ...state, phase: 'idle', landing: event.quality, landingCountdown: null };
    }

    case 'undo':
      return state.done ? undo(state, config) : state;

    case 'reconcile': {
      if (state.done === event.done) return state;
      if (event.done) return { ...state, done: true, phase: 'idle', landingCountdown: null };
      return undo(state, config);
    }
  }
}

/** What a log callback hands back to the screen once a row is written. */
export interface SetRowLogResult {
  readonly loadLb: number | null;
  readonly rpe: number | null;
  readonly secondsHeld: number | null;
  readonly landing: LandingQuality | null;
}

export function logResult(state: SetRowState): SetRowLogResult {
  return {
    loadLb: state.loadLb,
    rpe: state.rpe,
    secondsHeld: state.secondsHeld,
    landing: state.landing,
  };
}
