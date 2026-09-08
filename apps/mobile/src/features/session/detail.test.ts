import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SetPrescription } from '@vert/engine';
import type { SetLog } from '@/data/types';
import {
  compareSets,
  doneSummaryLine,
  feelLine,
  fingerPainLine,
  finishedAfterBuildLine,
  matchWindow,
  notFinishedLine,
  rowNoteLine,
  sessionMinutes,
  sessionView,
  tonnageLb,
  usesAddedLoadDisplay,
  workoutEvidenceLine,
} from './detail';
import { blockName, groupExercises, isGrouped } from './blockNames';

function prescription(partial: Partial<SetPrescription> & { setNumber: number }): SetPrescription {
  return {
    displayLoad: '5 × 205 lb',
    restS: 180,
    restRule: 'four to five sets',
    isRamp: false,
    isHeld: false,
    reps: 5,
    loadKg: 93,
    ...partial,
  };
}

function log(partial: Partial<SetLog> & { setNumber: number }): SetLog {
  return {
    id: `log-${partial.setNumber}`,
    sessionId: 'sess',
    sessionExerciseId: 'ex',
    repsDone: 5,
    loadKg: 93,
    durationS: null,
    distanceM: null,
    boxHeightMm: null,
    landing: null,
    rpe: null,
    side: null,
    meanVelocityBest: null,
    meanVelocityLast: null,
    velocityLossPct: null,
    loadSource: 'entered',
    entrySource: 'typed',
    completedAt: '2026-10-19T18:21:00.000Z',
    plannedDate: '2026-10-19',
    offsetDays: 0,
    idempotencyKey: `k${partial.setNumber}`,
    editedAt: null,
    createdAt: '2026-10-19T18:21:00.000Z',
    ...partial,
  };
}

describe('sessionView', () => {
  it('sends today to the runner', () => {
    expect(sessionView('2026-10-22', 'planned', '2026-10-22')).toBe('today');
  });

  it('reads a later date as future whatever the status says', () => {
    expect(sessionView('2026-10-24', 'planned', '2026-10-22')).toBe('future');
  });

  it('separates done, part-logged and missed in the past', () => {
    expect(sessionView('2026-10-19', 'done', '2026-10-22')).toBe('done');
    expect(sessionView('2026-10-19', 'not_finished', '2026-10-22')).toBe('not_finished');
    expect(sessionView('2026-10-19', 'missed', '2026-10-22')).toBe('missed');
    expect(sessionView('2026-10-19', 'planned', '2026-10-22')).toBe('missed');
  });
});

describe('compareSets', () => {
  it('keeps the prescription as it was written', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], [log({ setNumber: 1 })]);
    expect(rows[0]?.prescription).toBe('5 × 205 lb');
    expect(rows[0]?.detail).toBeNull();
    expect(rows[0]?.logged).toBe(true);
  });

  it('names the reps that came up short', () => {
    const rows = compareSets(
      [prescription({ setNumber: 1 })],
      [log({ setNumber: 1, repsDone: 4 })],
    );
    expect(rows[0]?.detail).toBe('did 4');
  });

  it('names a load that differed', () => {
    const rows = compareSets(
      [prescription({ setNumber: 1 })],
      [log({ setNumber: 1, loadKg: 106.6 })],
    );
    expect(rows[0]?.detail).toBe('was 5 × 235');
  });

  it('says so when a prescribed set has no log', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], []);
    expect(rows[0]?.detail).toBe('not logged');
    expect(rows[0]?.logged).toBe(false);
  });

  it('calls nothing missing on a day that has not happened yet', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], [], { future: true });
    expect(rows[0]?.detail).toBeNull();
    expect(rows[0]?.logged).toBe(false);
    expect(rows[0]?.prescription).toBe('5 × 205 lb');
  });

  it('still says ramp and each side on a future day', () => {
    const rows = compareSets([prescription({ setNumber: 1, isRamp: true })], [], {
      future: true,
      bothSides: true,
    });
    expect(rows[0]?.detail).toBe('ramp · each side');
  });

  it('numbers a ramp set R1 and says ramp', () => {
    const rows = compareSets([prescription({ setNumber: 1, isRamp: true })], []);
    expect(rows[0]?.index).toBe('R1');
    expect(rows[0]?.detail).toContain('ramp');
  });

  it('carries each side on a unilateral row', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], [log({ setNumber: 1 })], {
      bothSides: true,
    });
    expect(rows[0]?.detail).toBe('each side');
  });

  it('shows the unreduced prescription when soreness cut the set', () => {
    const original = prescription({ setNumber: 1, displayLoad: '5 × 235 lb' });
    const rows = compareSets(
      [prescription({ setNumber: 1, original })],
      [log({ setNumber: 1 })],
    );
    expect(rows[0]?.detail).toBe('was 5 × 235 lb');
  });

  it('shows the logged effort only in RPE mode', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], [log({ setNumber: 1, rpe: 8 })]);
    expect(rows[0]?.rpe).toBeNull();
    const rpeRows = compareSets([prescription({ setNumber: 1 })], [log({ setNumber: 1, rpe: 8 })], {
      rpeMode: true,
    });
    expect(rpeRows[0]?.rpe).toBe(8);
  });

  it('carries the landing rating through', () => {
    const rows = compareSets(
      [prescription({ setNumber: 1 })],
      [log({ setNumber: 1, landing: 'good' })],
    );
    expect(rows[0]?.landing).toBe('good');
  });
});

describe('the session summary', () => {
  it('sums the weight moved', () => {
    expect(Math.round(tonnageLb([log({ setNumber: 1 }), log({ setNumber: 2 })]))).toBe(2050);
  });

  it('ignores a bodyweight row with no load', () => {
    expect(tonnageLb([log({ setNumber: 1, loadKg: null })])).toBe(0);
  });

  it('measures from the first tap to the finish mark', () => {
    expect(
      sessionMinutes('2026-10-19T18:00:00.000Z', '2026-10-19T18:52:00.000Z'),
    ).toBe(52);
  });

  it('is null when the session was never started or never finished', () => {
    expect(sessionMinutes(null, '2026-10-19T18:52:00.000Z')).toBeNull();
    expect(sessionMinutes('2026-10-19T18:00:00.000Z', null)).toBeNull();
  });

  it('writes the facts in one line', () => {
    expect(
      doneSummaryLine({
        loggedSets: 18,
        prescribedSets: 18,
        minutes: 52,
        contacts: {
          extensive: 60,
          highIntensity: 21,
          highAmplitude: 12,
          targetExtensive: 60,
          capHigh: 25,
          capAmplitude: 20,
        },
        tonnageLb: 8240,
        rpe: 7,
      }),
    ).toBe('18 of 18 sets · 52 min · 60 contacts · 8,240 lb · RPE 7');
  });

  it('drops the facts a strength day does not have', () => {
    expect(
      doneSummaryLine({
        loggedSets: 12,
        prescribedSets: 12,
        minutes: null,
        contacts: null,
        tonnageLb: 0,
        rpe: null,
      }),
    ).toBe('12 of 12 sets');
  });

  it('reports the two answers the finish sheet asked for', () => {
    expect(feelLine(3, 'normal')).toBe('Soreness 3/10 · legs normal');
    expect(feelLine(null, null)).toBeNull();
  });
});

describe('the not-finished sentences', () => {
  it('says what finishing still changes', () => {
    expect(notFinishedLine(7, 18)).toBe(
      'Not finished · 7 of 18 sets · counts as missed unless you finish it',
    );
  });

  it('says what it no longer changes once the next week exists', () => {
    expect(finishedAfterBuildLine(8)).toBe(
      'Finished after week 8 was built · counts in the ledger, week 8 unchanged',
    );
  });
});

describe('matchWindow', () => {
  it('opens six hours before the first tap', () => {
    const window = matchWindow('2026-10-19', '2026-10-19T18:00:00.000Z', '2026-10-19T19:00:00.000Z');
    expect(window.fromIso).toBe('2026-10-19T12:00:00.000Z');
    expect(window.toIso).toBe('2026-10-20T01:00:00.000Z');
  });

  it('falls back to the whole day when the session was never started', () => {
    const window = matchWindow('2026-10-19', null, null);
    expect(window.fromIso).toBe('2026-10-18T18:00:00.000Z');
    expect(window.toIso).toBe('2026-10-20T00:00:00.000Z');
  });
});

describe('workoutEvidenceLine', () => {
  it('reports strain as evidence, never as load', () => {
    expect(
      workoutEvidenceLine({
        sportName: 'Weightlifting',
        minutes: 52,
        strain: 12.4,
        averageHeartRate: 132,
        matchSource: 'auto',
      }),
    ).toBe('Weightlifting · 52 min · strain 12.4 · avg HR 132 · matched automatically');
  });

  it('says when the athlete picked the match', () => {
    expect(
      workoutEvidenceLine({
        sportName: null,
        minutes: null,
        strain: null,
        averageHeartRate: null,
        matchSource: 'manual',
      }),
    ).toBe('matched by you');
  });
});

describe('session blocks', () => {
  it('names blocks in the words brief section 13 uses', () => {
    expect(blockName('main_lift')).toBe('Main lift');
    expect(blockName('injury_prevention_core')).toBe('Injury prevention / core');
    expect(blockName(null)).toBe('Session');
  });

  it('groups the warm-up and the cool-down', () => {
    expect(isGrouped('warm_up')).toBe(true);
    expect(isGrouped('cool_down')).toBe(true);
    expect(isGrouped('accessory')).toBe(false);
  });

  it('orders blocks the way the rule book places them', () => {
    const exercise = (id: string, block: string, orderIndex: number) => ({
      id,
      sessionId: 's',
      orderIndex,
      exerciseId: id,
      exerciseName: id,
      block,
      loadType: 'heavy_strength',
      loadMode: 'entered' as const,
      bothSides: false,
      rotationNote: null,
      headerNote: null,
      lastTimeNote: null,
      isNewThisWeek: false,
      restS: null,
      restRule: null,
      perSet: null,
    });
    const groups = groupExercises([
      exercise('c', 'cool_down', 3),
      exercise('a', 'main_lift', 1),
      exercise('w', 'warm_up', 0),
    ]);
    expect(groups.map((group) => group.name)).toEqual(['Warm-up', 'Main lift', 'Cool-down']);
  });
});

/**
 * react-native-web 0.21 drops `accessibilityState`, so a control that sets only
 * the React Native prop ships a role with no state on the web build: the match
 * sheet announced as a radio group with no chosen workout (defect D-12). The
 * kit guards its own primitives in src/ui/ariaState.test.ts; this is the same
 * guard for the one control this feature builds by hand.
 */
describe('whoopMatch keeps its ARIA state on web (defect D-12)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./whoopMatch.tsx', import.meta.url)),
    'utf8',
  );

  it('pairs every accessibilityState with an aria- twin', () => {
    const states = source.match(/accessibilityState=/g)?.length ?? 0;
    const arias = source.match(/\saria-[a-z]+=/g)?.length ?? 0;
    expect(states).toBeGreaterThan(0);
    expect(arias).toBeGreaterThanOrEqual(states);
  });

  it('reports the chosen workout as checked, the attribute role=radio takes', () => {
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('aria-checked={selected}');
  });
});

/**
 * The weighted pull-up prescribes the ADDED load only: bodyweight is not on
 * the bar and is not on the 5 lb grid (house rule `house.sc.upper_power_day`).
 * A past session that reports "was 5 × 35 lb" would be reporting a 35 lb
 * pull-up, which is not what happened.
 */
describe('added-load rows', () => {
  const added = [
    prescription({ setNumber: 1, displayLoad: '5 × BW + 30 lb', reps: 5, loadKg: 13.6 }),
    prescription({ setNumber: 2, displayLoad: '4 × BW + 30 lb', reps: 4, loadKg: 13.6 }),
  ];

  it('recognises a row written as bodyweight plus a load', () => {
    expect(usesAddedLoadDisplay(added)).toBe(true);
  });

  it('leaves a barbell row and a plain bodyweight row alone', () => {
    expect(usesAddedLoadDisplay([prescription({ setNumber: 1 })])).toBe(false);
    expect(
      usesAddedLoadDisplay([
        { displayLoad: '8 × BW', restS: 60, restRule: 'accessory', isRamp: false, isHeld: false, setNumber: 1, reps: 8 },
      ]),
    ).toBe(false);
  });

  it('keeps the prescription in the notation the engine wrote it in', () => {
    const rows = compareSets(added, [log({ setNumber: 1 })], { addedLoad: true });
    expect(rows[0]?.prescription).toBe('5 × BW + 30 lb');
  });

  it('reports what was actually added, not a bare number', () => {
    const rows = compareSets(
      added,
      [log({ setNumber: 1, repsDone: 5, loadKg: 15.9 })],
      { addedLoad: true },
    );
    expect(rows[0]?.detail).toBe('was 5 × BW + 35 lb');
  });

  it('still reads a barbell row as a barbell row', () => {
    const rows = compareSets([prescription({ setNumber: 1 })], [
      log({ setNumber: 1, loadKg: 106.6 }),
    ]);
    expect(rows[0]?.detail).toBe('was 5 × 235');
  });
});

describe('fingerPainLine', () => {
  it('reports the answer as a fact', () => {
    expect(fingerPainLine(4)).toBe('Finger pain 4 out of 10');
  });

  it('treats zero as an answer, not as an absence', () => {
    expect(fingerPainLine(0)).toBe('Finger pain 0 out of 10');
  });

  it('is absent when the question was never asked', () => {
    expect(fingerPainLine(null)).toBeNull();
  });
});

/**
 * The line under an exercise name on a past session. It is the record of what
 * the athlete was told that day, so it survives a change of weaker side or a
 * change of grip answer afterwards.
 */
describe('rowNoteLine', () => {
  it('names the side the row started on', () => {
    expect(rowNoteLine(null, 'Weaker side first: left', null)).toBe('Weaker side first: left');
  });

  it('names the grip a pulling row was prescribed in', () => {
    expect(rowNoteLine(null, null, 'Open hand only.')).toBe('Open hand only.');
  });

  it('says pulling was light on a demoted day', () => {
    expect(rowNoteLine(null, null, 'Light finger work today.')).toBe('Light finger work today.');
  });

  it('keeps the rotation note first, then the side, then the grip', () => {
    expect(
      rowNoteLine('Rotated from Bulgarian split squat (3 weeks)', 'Weaker side first: left', 'Open hand only.'),
    ).toBe('Rotated from Bulgarian split squat (3 weeks) · Weaker side first: left · Open hand only.');
  });

  it('is absent when the row carried none of them', () => {
    expect(rowNoteLine(null, null, null)).toBeNull();
    expect(rowNoteLine('', '', '')).toBeNull();
  });
});
