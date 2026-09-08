import { describe, expect, it } from 'vitest';
import {
  LANDING_SECONDS,
  canLog,
  initialSetRowState,
  logResult,
  setRowReducer,
  type SetRowConfig,
  type SetRowEvent,
  type SetRowState,
} from './setRowState';

function run(config: SetRowConfig, events: readonly SetRowEvent[], done = false): SetRowState {
  let state = initialSetRowState(config, done);
  for (const event of events) state = setRowReducer(state, event, config);
  return state;
}

const loadable: SetRowConfig = { kind: 'loadable' };
const timed: SetRowConfig = { kind: 'timed', durationS: 30 };
const rpe: SetRowConfig = { kind: 'rpe', initialLoadLb: null };
const ladder: SetRowConfig = { kind: 'loadable', promptsLanding: true };
const perSide: SetRowConfig = { kind: 'rpe', initialLoadLb: null, perSide: true };

describe('a loadable row', () => {
  it('logs as written on one tap', () => {
    const state = run(loadable, [{ type: 'press' }]);
    expect(state.done).toBe(true);
    expect(state.phase).toBe('idle');
  });

  it('undoes on a second tap inside the session', () => {
    const state = run(loadable, [{ type: 'press' }, { type: 'press' }]);
    expect(state.done).toBe(false);
  });

  it('ignores an undo it has nothing to undo', () => {
    const before = initialSetRowState(loadable);
    expect(setRowReducer(before, { type: 'undo' }, loadable)).toBe(before);
  });

  it('ignores ticks it did not ask for', () => {
    const before = initialSetRowState(loadable);
    expect(setRowReducer(before, { type: 'tick' }, loadable)).toBe(before);
  });
});

describe('a timed row', () => {
  it('starts a countdown on the first tap', () => {
    const state = run(timed, [{ type: 'press' }]);
    expect(state.phase).toBe('running');
    expect(state.secondsRemaining).toBe(30);
    expect(state.done).toBe(false);
  });

  it('counts down one second at a time and completes at zero', () => {
    const events: SetRowEvent[] = [{ type: 'press' }];
    for (let i = 0; i < 30; i += 1) events.push({ type: 'tick' });
    const state = run(timed, events);
    expect(state.done).toBe(true);
    expect(state.phase).toBe('idle');
    expect(state.secondsRemaining).toBeNull();
    expect(state.secondsHeld).toBe(30);
  });

  it('stops early and logs the seconds held', () => {
    const state = run(timed, [
      { type: 'press' },
      { type: 'tick' },
      { type: 'tick' },
      { type: 'tick' },
      { type: 'press' },
    ]);
    expect(state.done).toBe(true);
    expect(state.secondsHeld).toBe(3);
  });

  it('restarts clean after an undo', () => {
    const state = run(timed, [
      { type: 'press' },
      { type: 'tick' },
      { type: 'press' },
      { type: 'press' },
    ]);
    expect(state.done).toBe(false);
    expect(state.secondsHeld).toBeNull();
    expect(state.secondsRemaining).toBeNull();
  });
});

describe('an RPE row', () => {
  it('expands rather than logging on the first tap', () => {
    const state = run(rpe, [{ type: 'press' }]);
    expect(state.phase).toBe('expanded');
    expect(state.done).toBe(false);
  });

  it('collapses again on a second tap', () => {
    const state = run(rpe, [{ type: 'press' }, { type: 'press' }]);
    expect(state.phase).toBe('idle');
    expect(state.done).toBe(false);
  });

  it('refuses to log until a load exists', () => {
    const expanded = run(rpe, [{ type: 'press' }]);
    expect(canLog(expanded, rpe)).toBe(false);
    expect(setRowReducer(expanded, { type: 'log' }, rpe).done).toBe(false);
  });

  it('logs once a load is set, with the effort optional', () => {
    const state = run(rpe, [{ type: 'press' }, { type: 'setLoad', loadLb: 185 }, { type: 'log' }]);
    expect(state.done).toBe(true);
    expect(logResult(state)).toEqual({
      loadLb: 185,
      rpe: null,
      rpeLeft: null,
      rpeRight: null,
      secondsHeld: null,
      landing: null,
    });
  });

  it('keeps the effort when one is given', () => {
    const state = run(rpe, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 185 },
      { type: 'setRpe', rpe: 7 },
      { type: 'log' },
    ]);
    expect(state.rpe).toBe(7);
  });

  it('keeps the load but drops the effort across an undo', () => {
    const state = run(rpe, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 185 },
      { type: 'setRpe', rpe: 8 },
      { type: 'log' },
      { type: 'press' },
    ]);
    expect(state.done).toBe(false);
    expect(state.loadLb).toBe(185);
    expect(state.rpe).toBeNull();
  });
});

describe('a unilateral RPE row', () => {
  /**
   * The session that asked for this: single-leg RDLs where the same weight is an
   * easy 6 on the right leg and an 8 on the left. Two answers, one set.
   */
  it('keeps an effort per leg', () => {
    const state = run(perSide, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 40 },
      { type: 'setRpe', rpe: 8, side: 'left' },
      { type: 'setRpe', rpe: 6, side: 'right' },
      { type: 'log' },
    ]);
    expect(state.done).toBe(true);
    expect(logResult(state)).toEqual({
      loadLb: 40,
      rpe: null,
      rpeLeft: 8,
      rpeRight: 6,
      secondsHeld: null,
      landing: null,
    });
  });

  it('logs on the load alone, so neither leg is required to answer', () => {
    const state = run(perSide, [{ type: 'press' }, { type: 'setLoad', loadLb: 40 }, { type: 'log' }]);
    expect(state.done).toBe(true);
    expect(state.rpeLeft).toBeNull();
    expect(state.rpeRight).toBeNull();
  });

  it('takes one leg answer without inventing the other', () => {
    const state = run(perSide, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 40 },
      { type: 'setRpe', rpe: 8, side: 'left' },
      { type: 'log' },
    ]);
    expect(state.rpeLeft).toBe(8);
    expect(state.rpeRight).toBeNull();
    expect(state.rpe).toBeNull();
  });

  it('drops both legs across an undo, and keeps the load', () => {
    const state = run(perSide, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 40 },
      { type: 'setRpe', rpe: 8, side: 'left' },
      { type: 'setRpe', rpe: 6, side: 'right' },
      { type: 'log' },
      { type: 'press' },
    ]);
    expect(state.done).toBe(false);
    expect(state.loadLb).toBe(40);
    expect(state.rpeLeft).toBeNull();
    expect(state.rpeRight).toBeNull();
  });

  it('leaves a bilateral row answering once, as it always has', () => {
    const state = run(rpe, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 185 },
      { type: 'setRpe', rpe: 7 },
      { type: 'log' },
    ]);
    expect(state.rpe).toBe(7);
    expect(state.rpeLeft).toBeNull();
    expect(state.rpeRight).toBeNull();
  });
});

describe('the landing prompt', () => {
  it('opens for five seconds after the last ladder set', () => {
    const state = run(ladder, [{ type: 'press' }]);
    expect(state.done).toBe(true);
    expect(state.phase).toBe('landing');
    expect(state.landingCountdown).toBe(LANDING_SECONDS);
  });

  it('defaults to Good when it is ignored', () => {
    const events: SetRowEvent[] = [{ type: 'press' }];
    for (let i = 0; i < LANDING_SECONDS; i += 1) events.push({ type: 'tick' });
    const state = run(ladder, events);
    expect(state.phase).toBe('idle');
    expect(state.landing).toBe('good');
  });

  it('takes the answer it is given and closes', () => {
    const state = run(ladder, [{ type: 'press' }, { type: 'landing', quality: 'poor' }]);
    expect(state.landing).toBe('poor');
    expect(state.phase).toBe('idle');
    expect(state.landingCountdown).toBeNull();
  });

  it('holds the row while the prompt is open', () => {
    const opened = run(ladder, [{ type: 'press' }]);
    expect(setRowReducer(opened, { type: 'press' }, ladder)).toBe(opened);
  });

  it('is not offered on an ordinary set', () => {
    const state = run(loadable, [{ type: 'press' }]);
    expect(state.phase).toBe('idle');
    expect(state.landingCountdown).toBeNull();
  });
});

describe('seeding from the log', () => {
  it('starts done when the set is already in the ledger', () => {
    const state = initialSetRowState(loadable, true);
    expect(state.done).toBe(true);
    expect(setRowReducer(state, { type: 'press' }, loadable).done).toBe(false);
  });
});

describe('reconciling with the store', () => {
  it('unticks a row the log says was never written', () => {
    // The tick is optimistic. When the write failed, the store still says the
    // set is not there, and a row left green is the athlete believing a set is
    // saved that is not.
    const optimistic = run(loadable, [{ type: 'press' }]);
    expect(optimistic.done).toBe(true);
    expect(setRowReducer(optimistic, { type: 'reconcile', done: false }, loadable).done).toBe(
      false,
    );
  });

  it('ticks a row the log already holds', () => {
    const fresh = initialSetRowState(loadable, false);
    expect(setRowReducer(fresh, { type: 'reconcile', done: true }, loadable).done).toBe(true);
  });

  it('changes nothing when the store already agrees', () => {
    const fresh = initialSetRowState(loadable, false);
    expect(setRowReducer(fresh, { type: 'reconcile', done: false }, loadable)).toBe(fresh);
  });

  it('keeps the typed load when it unticks, so nothing has to be retyped', () => {
    const typed = run(rpe, [
      { type: 'press' },
      { type: 'setLoad', loadLb: 225 },
      { type: 'setRpe', rpe: 8 },
      { type: 'log' },
    ]);
    const back = setRowReducer(typed, { type: 'reconcile', done: false }, rpe);
    expect(back.done).toBe(false);
    expect(back.loadLb).toBe(225);
  });
});
