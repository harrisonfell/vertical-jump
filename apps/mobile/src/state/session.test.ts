import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseRestTimer,
  remainingSeconds,
  restEndsAt,
  restIsRunning,
  useSessionStore,
  type RestTimer,
} from './session';

const NOW = new Date('2026-10-22T18:41:00.000Z');

function timerEndingIn(seconds: number): RestTimer {
  return {
    endsAt: new Date(NOW.getTime() + seconds * 1000).toISOString(),
    nextLabel: 'set 2 · 4 × 220 lb',
    sessionId: 'sess_1',
  };
}

describe('rest timer math', () => {
  it('rounds up so a fresh 3:00 rest reads 180, not 179', () => {
    expect(remainingSeconds(timerEndingIn(180).endsAt, NOW)).toBe(180);
    expect(remainingSeconds(new Date(NOW.getTime() + 179_400).toISOString(), NOW)).toBe(180);
  });

  it('never counts into the past', () => {
    expect(remainingSeconds(timerEndingIn(0).endsAt, NOW)).toBe(0);
    expect(remainingSeconds(timerEndingIn(-90).endsAt, NOW)).toBe(0);
  });

  it('treats an unparseable end as finished rather than counting forever', () => {
    expect(remainingSeconds('not a timestamp', NOW)).toBe(0);
  });

  it('knows whether a rest is still running', () => {
    expect(restIsRunning(null, NOW)).toBe(false);
    expect(restIsRunning(timerEndingIn(45), NOW)).toBe(true);
    expect(restIsRunning(timerEndingIn(-1), NOW)).toBe(false);
  });

  it('builds the end stamp the bar counts down to', () => {
    expect(restEndsAt(180, NOW)).toBe('2026-10-22T18:44:00.000Z');
    expect(remainingSeconds(restEndsAt(90, NOW), NOW)).toBe(90);
    // A negative rest is a bug upstream; it must not produce a past deadline.
    expect(remainingSeconds(restEndsAt(-30, NOW), NOW)).toBe(0);
  });
});

describe('the session store', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it('keeps one rest at a time and clears it on stop', () => {
    const store = useSessionStore.getState();
    store.startRest(timerEndingIn(180));
    expect(useSessionStore.getState().restTimer?.sessionId).toBe('sess_1');
    store.startRest({ ...timerEndingIn(90), nextLabel: 'set 3 · 3 × 235 lb' });
    expect(useSessionStore.getState().restTimer?.nextLabel).toBe('set 3 · 3 × 235 lb');
    store.stopRest();
    expect(useSessionStore.getState().restTimer).toBeNull();
  });

  it('drops expanded rows when the athlete moves to another session', () => {
    const store = useSessionStore.getState();
    store.setActiveSession('sess_1');
    store.toggleExercise('ex_squat');
    expect(useSessionStore.getState().expandedExerciseIds).toEqual(['ex_squat']);
    useSessionStore.getState().setActiveSession('sess_2');
    expect(useSessionStore.getState().expandedExerciseIds).toEqual([]);
  });

  it('toggles an exercise open and shut', () => {
    const store = useSessionStore.getState();
    store.toggleExercise('ex_squat');
    store.toggleExercise('ex_rdl');
    expect(useSessionStore.getState().expandedExerciseIds).toEqual(['ex_squat', 'ex_rdl']);
    useSessionStore.getState().toggleExercise('ex_squat');
    expect(useSessionStore.getState().expandedExerciseIds).toEqual(['ex_rdl']);
  });

  it('dismisses a coach mark once', () => {
    const store = useSessionStore.getState();
    store.setDismissedCoachMarks(['today.firstSession']);
    store.dismissCoachMark('today.firstSession');
    store.dismissCoachMark('plan.cells');
    expect(useSessionStore.getState().dismissedCoachMarks).toEqual([
      'today.firstSession',
      'plan.cells',
    ]);
  });
});

describe('surviving a relaunch', () => {
  const timer: RestTimer = {
    endsAt: '2026-09-08T18:03:00.000Z',
    nextLabel: 'set 2 · 4 × 220 lb (+15 lb)',
    sessionId: 'sess_1',
  };

  it('reads a rest that is still running back onto the screen', () => {
    const at = new Date('2026-09-08T18:01:00.000Z');
    expect(parseRestTimer(JSON.stringify(timer), at)).toEqual(timer);
  });

  it('drops a rest that has already run out rather than resurrecting it', () => {
    // A bar counting 0:00 from three days ago is worse than no bar.
    const at = new Date('2026-09-11T09:00:00.000Z');
    expect(parseRestTimer(JSON.stringify(timer), at)).toBeNull();
  });

  it('keeps the notification id, so any mount can still cancel it', () => {
    const withId = { ...timer, notificationId: 'notif_7' };
    const at = new Date('2026-09-08T18:01:00.000Z');
    expect(parseRestTimer(JSON.stringify(withId), at)?.notificationId).toBe('notif_7');
  });

  it('drops anything unparseable or the wrong shape', () => {
    const at = new Date('2026-09-08T18:01:00.000Z');
    expect(parseRestTimer(null, at)).toBeNull();
    expect(parseRestTimer('', at)).toBeNull();
    expect(parseRestTimer('{not json', at)).toBeNull();
    expect(parseRestTimer('{"endsAt":"2026-09-08T18:03:00.000Z"}', at)).toBeNull();
  });
});
