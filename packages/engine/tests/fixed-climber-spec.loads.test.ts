/**
 * FIXED: SPEC FIDELITY, part 2 of 3.
 *
 * The prescription half of the owner's athlete spec (climber-spec.md): the box
 * squat's 320 lb numbers and the discarded 345, the weighted pull-up's Epley
 * on added load and its display, R117 on the upper-power day, the ban on
 * sprints and change-of-direction work, the calf cap, and the block sequence.
 *
 * Every gap the lens found is fixed and this file now proves the fix. Two
 * readings the owner still has to settle are named OPEN, assert what the rule
 * book gives today, and quote the spec line they sit against.
 */
import { describe, expect, it } from 'vitest';
import { diffDays } from '../src/calendar.js';
import { getPerSetPrescription } from '../src/prescribe/index.js';
import { findHouseRule } from '../src/ruleset/index.js';
import { addedLoadFirstFreeze, usesAddedLoad } from '../src/prescribe/pullUp.js';
import { isCalfVolume, sportRequirementsFor } from '../src/select/sport.js';
import { formatAddedLoadSet, kgToLb, lbToKg } from '../src/units.js';
import {
  CLIMBER_BOX_SQUAT_LB,
  CLIMBER_STALE_BOX_SQUAT_LB,
  buildClimberFixture,
  climberAthlete,
} from '../src/fixtures/climber.js';
import {
  FIVE_DAY,
  FOUR_DAY,
  WEEKDAY_SETS,
  allWeeks,
  byId,
  climber,
  climberOnDays,
  climbing,
  prescribedRows,
  rowsOf,
  ruleset,
  weekContextFor,
} from './fixed-climber-spec.support.js';
import type { WorkingMax } from '../src/types/athlete.js';

/** The Power family of day types (R135, R136). */
const POWER_DAYS = new Set(['power_speed', 'power', 'speed']);
/* ------------------------------------- 6. box squat 320 and the 345 discard */

describe('spec: box squat 320 lb, the 345 discarded', () => {
  it('the entered 320 replaces the frozen 345', () => {
    const max = climberAthlete().workingMaxes.find((entry) => entry.lift === 'box_squat');
    if (max === undefined) throw new Error('no box squat working max');
    expect(Math.round(kgToLb(max.valueKg))).toBe(CLIMBER_BOX_SQUAT_LB);
    expect(Math.round(kgToLb(max.valueKg))).not.toBe(CLIMBER_STALE_BOX_SQUAT_LB);
    expect(max.source).toBe('entered');
  });

  it('three sets are 5 x 240, 4 x 255, 3 x 270', () => {
    const athlete = climberAthlete();
    const box = byId.get('box_squat');
    if (box === undefined) throw new Error('seed is missing box_squat');
    const sets = getPerSetPrescription(box, athlete, weekContextFor(athlete, 6, 3));
    expect(sets.map((set) => set.displayLoad)).toEqual(['5 × 240 lb', '4 × 255 lb', '3 × 270 lb']);
    expect(sets.map((set) => set.loadPercent)).toEqual([75, 80, 85]);
  });

  it('the seven-set heavy day ramps 190 and 225, then 240, 255, 270, 290, 290', () => {
    const athlete = climberAthlete();
    const box = byId.get('box_squat');
    if (box === undefined) throw new Error('seed is missing box_squat');
    const sets = getPerSetPrescription(box, athlete, weekContextFor(athlete, 6, 7));
    expect(sets.map((set) => set.displayLoad)).toEqual([
      '5 × 190 lb',
      '5 × 225 lb',
      '5 × 240 lb',
      '4 × 255 lb',
      '3 × 270 lb',
      '3 × 290 lb',
      '3 × 290 lb',
    ]);
    expect(sets.slice(0, 2).every((set) => set.isRamp)).toBe(true);
    expect(sets[6]?.isHeld).toBe(true);
  });

  it('OPEN: four and five sets ascend to 290, they do not hold at 270', () => {
    // OPEN QUESTION for the owner, left as the rule book has it. Spec line:
    // "5 x 240, 4 x 255, 3 x 270 (75, 80, 85 percent of 320 on the 5 lb grid),
    // 4 OR 5 SETS HOLD AT 270". The engine ascends to 90 percent, because the
    // advanced cap is 92 (R154) and R155 only holds a step above the cap. That
    // matches brief section 09's advanced ladder and the same spec line's own
    // seven-set numbers, which end 270, 290, 290; the "hold at 270" clause
    // contradicts both, so the rule book stands until the owner rules.
    const athlete = climberAthlete();
    const box = byId.get('box_squat');
    if (box === undefined) throw new Error('seed is missing box_squat');
    const four = getPerSetPrescription(box, athlete, weekContextFor(athlete, 6, 4));
    const five = getPerSetPrescription(box, athlete, weekContextFor(athlete, 6, 5));
    expect(four.map((set) => set.displayLoad)).toEqual([
      '5 × 240 lb',
      '4 × 255 lb',
      '3 × 270 lb',
      '3 × 290 lb',
    ]);
    expect(five[4]?.displayLoad).toBe('3 × 290 lb');
  });

  it('the box squat is the lower main lift in every week', () => {
    for (const week of allWeeks(climber())) {
      for (const session of week.sessions) {
        if (session.dayType !== 'lower_strength') continue;
        const main = rowsOf(session).find((row) => row.role === 'main_lift');
        expect(main?.exerciseId, `w${week.w}`).toBe('box_squat');
      }
    }
  });
});

/* --------------------------- 7. weighted pull-up: Epley on added load only */

describe('spec: weighted pull-up, Epley on added load, BW plus lb display', () => {
  it('the added-load rows are recognised and the barbell rows are not', () => {
    const pullUp = byId.get('weighted_pull_up');
    const box = byId.get('box_squat');
    if (pullUp === undefined || box === undefined) throw new Error('seed is missing a lift');
    expect(usesAddedLoad(pullUp)).toBe(true);
    expect(usesAddedLoad(box)).toBe(false);
  });

  it('Epley runs on the added load alone, with the house 0.95 factor', () => {
    // 45 lb for 5 reps: 45 x (1 + 5/30) = 52.5, x 0.95 = 49.875, snapped to 50.
    const frozen = addedLoadFirstFreeze(
      'weighted_pull_up',
      { valueKg: lbToKg(45), reps: 5, enteredAt: '2026-09-05T00:00:00.000Z' },
      ruleset,
      '2026-09-07T03:00:00.000Z',
    );
    expect(Math.round(kgToLb(frozen.valueKg))).toBe(50);
    expect(frozen.source).toBe('epley');
    expect(frozen.confidence).toBe(0.95);
  });

  it('the display is "5 x BW + 45 lb", and bare bodyweight drops the tail', () => {
    expect(formatAddedLoadSet(5, 45)).toBe('5 × BW + 45 lb');
    expect(formatAddedLoadSet(8, 0)).toBe('8 × BW');
  });

  it('the prescribed row shows added load, never bodyweight plus added load', () => {
    const fixture = buildClimberFixture();
    const bodyweightLb = kgToLb(fixture.athlete.bodyweightKg ?? 0);
    let seen = 0;
    for (const week of fixture.weeks) {
      for (const session of week.sessions) {
        for (const row of rowsOf(session)) {
          if (row.exerciseId !== 'weighted_pull_up') continue;
          seen += 1;
          for (const set of row.sets) {
            if (set.loadKg === undefined) continue;
            expect(set.displayLoad).toMatch(/^\d+ × BW( \+ \d+ lb)?$/);
            expect(kgToLb(set.loadKg)).toBeLessThan(bodyweightLb / 2);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------ 8. R117 on the upper day */

describe('spec: R117, a power-intent session is at least half velocity or elastic', () => {
  it('speed climbing runs the Upper Strength day at upper_power', () => {
    expect(sportRequirementsFor('speed_climbing', ruleset).upperDayIntent).toBe('upper_power');
    for (const sport of ['basketball', 'football', 'soccer', 'track_field'] as const) {
      expect(sportRequirementsFor(sport, ruleset).upperDayIntent).toBe('strength');
    }
  });

  it('every upper-power session is at or above half velocity or elastic rows', () => {
    for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
      let checked = 0;
      for (const week of allWeeks(climberOnDays(weekdays))) {
        for (const session of week.sessions) {
          if (session.sessionIntent !== 'upper_power') continue;
          checked += 1;
          const rows = prescribedRows(session);
          const fast = rows.filter((row) => {
            const intent = byId.get(row.exerciseId)?.intent;
            return intent === 'velocity' || intent === 'elastic';
          });
          expect(fast.length * 2, `w${week.w} ${session.date}`).toBeGreaterThanOrEqual(rows.length);
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('the upper day never becomes a maximal CNS day, so R90 and R93 hold', () => {
    for (const week of allWeeks(climber())) {
      for (const session of week.sessions) {
        if (session.sessionIntent !== 'upper_power') continue;
        expect(session.isMaximalCns, `w${week.w}`).toBe(false);
      }
    }
  });

  it('holds the upper day under the cap in a deload too, with an entered pull-up max', () => {
    // `house.sc.upper_power_day`, R90 and R93: the day cap binds in every
    // week, reduced weeks included. A deload rebuilds the prior load week's
    // ladder and takes its TAIL, so the set count says nothing about the top
    // percent it reaches and only a load week may decide the cap is slack.
    // With an entered weighted pull-up 1RM (R72, a supported input) the deload
    // Tuesday used to run a 90 percent top set the day after Monday's box
    // squat; it now holds one step below the heavy mark.
    const maxes: WorkingMax[] = [
      {
        lift: 'box_squat',
        valueKg: lbToKg(320),
        source: 'entered',
        confidence: 1,
        frozenAt: '2026-09-07T03:00:00.000Z',
        lastRaiseAt: '2026-09-07T03:00:00.000Z',
        failStreak: 0,
      },
      {
        lift: 'weighted_pull_up',
        valueKg: lbToKg(60),
        source: 'entered',
        confidence: 1,
        frozenAt: '2026-09-07T03:00:00.000Z',
        lastRaiseAt: '2026-09-07T03:00:00.000Z',
        failStreak: 0,
      },
    ];
    const weeks = allWeeks(climber({ workingMaxes: maxes }));
    const deload = weeks.find((week) => week.kind === 'deload');
    if (deload === undefined) throw new Error('no deload week');
    const upper = deload.sessions.find((session) => session.sessionIntent === 'upper_power');
    const lower = deload.sessions.find((session) => session.dayType === 'lower_strength');
    if (upper === undefined || lower === undefined) throw new Error('no upper or lower day');
    expect(upper.isMaximalCns).toBe(false);
    expect(lower.isMaximalCns).toBe(true);
    expect(Math.abs(diffDays(lower.date, upper.date))).toBe(1);
    const main = rowsOf(upper).find((row) => row.role === 'main_lift');
    expect(main?.sets.at(-1)?.loadPercent).toBe(80);
    for (const week of weeks) {
      for (const session of week.sessions) {
        if (session.sessionIntent !== 'upper_power') continue;
        expect(session.isMaximalCns, `w${week.w} ${session.date}`).toBe(false);
      }
    }
  });
});

/* ------------------------- 9. acceleration sprints, no COD, no conditioning */

describe('spec: acceleration sprints, no change of direction, no conditioning block', () => {
  it('the sport asks for acceleration work, no cutting and no conditioning block', () => {
    // The owner's answer of 5 Sep 2026: "follow the rule book" on sprints. The
    // house ban is gone; R102 classifies the wall as an acceleration event and
    // R113 prioritizes it because the second goal is speed. R32's conditioning
    // block stays optional and unasked-for, and cutting is not part of the
    // sport, so neither is ever added.
    const requirements = sportRequirementsFor('speed_climbing', ruleset);
    expect(requirements.requiresCod).toBe(false);
    expect(requirements.sprintClass).toBe('acceleration');
    expect(requirements.allowsConditioningBlock).toBe(false);
  });

  it('every load week puts one 10 to 30 m sprint in the Power block, rested per R104', () => {
    for (const weekdays of WEEKDAY_SETS) {
      let seen = 0;
      for (const week of allWeeks(climberOnDays(weekdays))) {
        for (const session of week.sessions) {
          // An A-skip is a sprint pattern walked through as mobility, never a
          // sprint rep, and it has always been allowed as movement prep.
          const sprints = prescribedRows(session).filter((row) => {
            const exercise = byId.get(row.exerciseId);
            return exercise?.movementPattern === 'sprint' && exercise.loadType !== 'mobility';
          });
          if (week.kind === 'load' && POWER_DAYS.has(session.dayType)) {
            expect(sprints.length, `w${week.w} ${session.dayType}`).toBe(1);
          }
          for (const row of sprints) {
            seen += 1;
            expect(row.block, row.exerciseId).toBe('power');
            const meters = byId.get(row.exerciseId)?.sprintDistanceM ?? 0;
            expect(meters, row.exerciseId).toBeGreaterThanOrEqual(10);
            expect(meters, row.exerciseId).toBeLessThanOrEqual(30);
            for (const set of row.sets) expect(set.restS, row.exerciseId).toBeGreaterThanOrEqual(180);
          }
        }
      }
      expect(seen).toBeGreaterThan(0);
    }
  });

  it('no week prescribes a cut or a conditioning block', () => {
    for (const weekdays of WEEKDAY_SETS) {
      for (const week of allWeeks(climberOnDays(weekdays))) {
        for (const session of week.sessions) {
          for (const block of session.blocks) {
            expect(block.name, `w${week.w}`).not.toBe('cod');
            expect(block.name, `w${week.w}`).not.toBe('conditioning');
          }
          for (const row of prescribedRows(session)) {
            const exercise = byId.get(row.exerciseId);
            if (exercise === undefined) continue;
            expect(exercise.movementPattern, row.exerciseId).not.toBe('cod');
            expect(exercise.codCutsPerRep ?? 0, row.exerciseId).toBe(0);
          }
        }
      }
    }
  });

  it('the other sports keep their sprint and change-of-direction work', () => {
    expect(sportRequirementsFor('basketball', ruleset).requiresCod).toBe(true);
    expect(sportRequirementsFor('soccer', ruleset).requiresCod).toBe(true);
    expect(sportRequirementsFor('football', ruleset).sprintClass).toBe('acceleration');
    expect(sportRequirementsFor('track_field', ruleset).sprintClass).toBe('max_velocity');
  });
});

/* --------------------------------------------------------- 10. calf volume */

describe('spec: calf volume kept low', () => {
  it('the ruleset ships one day a week and two sets', () => {
    expect(climbing.calfDaysPerWeek).toBe(1);
    expect(climbing.calfSetsCap).toBe(2);
  });

  it('no week runs calf volume on more than one day or for more than two sets', () => {
    for (const weekdays of WEEKDAY_SETS) {
      for (const week of allWeeks(climberOnDays(weekdays))) {
        let days = 0;
        for (const session of week.sessions) {
          let sets = 0;
          for (const row of rowsOf(session)) {
            const exercise = byId.get(row.exerciseId);
            if (exercise !== undefined && isCalfVolume(exercise)) sets += row.sets.length;
          }
          if (sets > 0) days += 1;
          expect(sets, `${session.date} w${week.w}`).toBeLessThanOrEqual(climbing.calfSetsCap);
        }
        expect(days, `w${week.w}`).toBeLessThanOrEqual(climbing.calfDaysPerWeek);
      }
    }
  });
});

/* ------------------------------------------------ 11. sequence across blocks */

describe('spec: max strength, then RFD and ballistic, then reactive', () => {
  it('the concentric-biased jumps stay in the Strength block', () => {
    for (const week of allWeeks(climber())) {
      if (week.blockType === 'strength') continue;
      const ids = week.sessions.flatMap((session) => rowsOf(session).map((row) => row.exerciseId));
      expect(ids, `w${week.w}`).not.toContain('seated_jump');
      expect(ids, `w${week.w}`).not.toContain('depth_pause_jump');
    }
  });

  it('the approach jump stays in the Power block', () => {
    for (const week of allWeeks(climber())) {
      if (week.blockType !== 'strength') continue;
      const ids = week.sessions.flatMap((session) => rowsOf(session).map((row) => row.exerciseId));
      expect(ids, `w${week.w}`).not.toContain('approach_jump');
    }
  });

  it('runs the quick-contact hop in the Strength block, which the rule now says', () => {
    // The rule the Plan shows named the quick-contact jump as Power-block work
    // and it is not: `sequencePreference` ranks it as the low-amplitude
    // extensive drill it is, so the primer takes it in every Strength-block
    // week, because R84's weekly contact target has to be met there too. The
    // shipped text now carries that exception rather than over-promising.
    const strengthWeeks = allWeeks(climber()).filter((week) => week.blockType === 'strength');
    expect(strengthWeeks.length).toBeGreaterThan(0);
    const carrying = strengthWeeks.filter((week) =>
      week.sessions.some((session) =>
        rowsOf(session).some((row) => row.exerciseId === 'quick_contact_rsi_jump'),
      ),
    );
    expect(carrying.length).toBeGreaterThan(0);
    expect(
      findHouseRule(ruleset, 'house.sc.sequence_strength_rfd_reactive')?.text ?? '',
    ).toContain('run in both blocks');
  });

  it('OPEN: the loaded jumps the rule allows for are not reached at this inventory', () => {
    // OPEN QUESTION for the owner. Neither loaded jump is selected on either
    // day count in any of the twelve weeks: both score below the laddered
    // extensive drills and the approach jump every time. The rule text no
    // longer promises them outright ("where the bar and the room are there for
    // one"), and both rows are priced correctly if selection ever reaches
    // them, but nothing today does.
    for (const weekdays of [FOUR_DAY, FIVE_DAY]) {
      const ids = allWeeks(climberOnDays(weekdays)).flatMap((week) =>
        week.sessions.flatMap((session) => rowsOf(session).map((row) => row.exerciseId)),
      );
      expect(ids).not.toContain('jump_squat');
      expect(ids).not.toContain('barbell_jump');
    }
  });

  it('prices both loaded jumps at the ballistic ceiling, never on the squat ladder', () => {
    // Orchestrator decision 2: "seed jump_squat as loadType 'ballistic' with
    // the 30 percent ceiling on the squat working max (advanced), rounded
    // down; never RPE mode, never the power scheme." Both rows now run the
    // straight 3 x 3 at 30 percent of the entered 320 lb box squat, rounded
    // down onto the 5 lb grid.
    const athlete = climberAthlete();
    const jumpSquat = byId.get('jump_squat');
    const barbellJump = byId.get('barbell_jump');
    if (jumpSquat === undefined || barbellJump === undefined) {
      throw new Error('seed is missing a loaded jump');
    }
    expect(jumpSquat.loadType).toBe('ballistic');
    expect(barbellJump.loadType).toBe('ballistic');
    const context = weekContextFor(athlete, 6, 3);
    expect(
      getPerSetPrescription(barbellJump, athlete, context).map((set) => set.displayLoad),
    ).toEqual(['3 × 95 lb', '3 × 95 lb', '3 × 95 lb']);
    expect(getPerSetPrescription(jumpSquat, athlete, context).map((set) => set.displayLoad)).toEqual(
      ['3 × 95 lb', '3 × 95 lb', '3 × 95 lb'],
    );
  });
});

/* ------------------------------------ 12. the readiness gate, four states */
