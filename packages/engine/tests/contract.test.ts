/**
 * The shared contract's own tests: the ruleset loads and validates, the layout
 * table is well formed for every program length, level derivation matches the
 * brief, the calendar helpers agree with "the calendar week from day 0", and
 * the units formatters produce the notation the display load is built from.
 *
 * Everything an implementer builds against is asserted here, so a contract
 * change that breaks a downstream module fails in this file first.
 */
import { describe, expect, it } from 'vitest';

import {
  RULESET_V1,
  RulesetValidationError,
  findHouseRule,
  loadRuleset,
  validateRuleset,
} from '../src/ruleset/index.js';
import { blocksFor, layoutFor, layoutRowFor, layoutTextFor } from '../src/skeleton/layout.js';
import { deriveLevel, needsTendonRunway } from '../src/level.js';
import {
  addDays,
  diffDays,
  isLocalDate,
  nextWeekdayOnOrAfter,
  parseLocalDate,
  programWeeks,
  weekIndexOf,
  weekWindows,
  weekdayOf,
} from '../src/calendar.js';
import { CONTACT_CAPS, clamp, computeExtensiveTarget, depthJumpRepBudget, dropHeightCapIn } from '../src/budgets.js';
import { hashLabel, mulberry32 } from '../src/prng.js';
import {
  MINUS,
  TIMES,
  formatBodyweightSet,
  formatDistance,
  formatHold,
  formatLoadedSet,
  formatAddedLoadSet,
  formatRest,
  formatVelocitySet,
  roundLoadLb,
} from '../src/units.js';
import type { Level } from '../src/types/core.js';

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

describe('ruleset', () => {
  it('loads and validates the shipped file', () => {
    const ruleset = loadRuleset();
    expect(ruleset).toBe(RULESET_V1);
    expect(ruleset.version).toBe('1.0.0');
    expect(ruleset.houseRules.length).toBeGreaterThan(30);
  });

  it('ships every house rule with plain words and no rule number in the text', () => {
    for (const rule of RULESET_V1.houseRules) {
      expect(rule.id).toMatch(/^(house|override|read)\./);
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.text.length).toBeGreaterThan(0);
      expect(rule.text).not.toMatch(/\bR\d{1,3}\b/);
      expect(['house', 'override', 'reading']).toContain(rule.kind);
    }
  });

  it('ships the four safety overrides', () => {
    for (const id of [
      'override.ballistic_jump_squats',
      'override.olympic_lifts',
      'override.frozen_working_max',
      'override.hard_caps',
    ]) {
      const rule = findHouseRule(RULESET_V1, id);
      expect(rule, id).toBeDefined();
      expect(rule?.kind).toBe('override');
    }
  });

  it('ships the constants the caps are read from', () => {
    const c = RULESET_V1.constants;
    expect(c.levelTopSetCapPct).toEqual({ beginner: 80, intermediate: 87, advanced: 92 });
    expect(c.levelTopSetCapDisplayPct).toEqual({ beginner: 80, intermediate: 85, advanced: 90 });
    expect(c.rpeCap).toEqual({ beginner: 8, intermediate: 8.5, advanced: 9 });
    expect(c.heavyLiftsPerSession).toEqual({ beginner: 2, intermediate: 2, advanced: 3 });
    expect(c.extensiveRange.beginner).toEqual({ bottom: 40, top: 70 });
    expect(c.extensiveRange.intermediate).toEqual({ bottom: 60, top: 100 });
    expect(c.extensiveRange.advanced).toEqual({ bottom: 80, top: 120 });
    expect(c.loadedJumpCeilingPct).toEqual({ beginner: 0, intermediate: 20, advanced: 30 });
    expect(c.contactCaps.highIntensityPerSession).toBe(25);
    expect(c.contactCaps.highAmplitudePerSession).toBe(20);
    expect(c.contactCaps.depthJumpContactsPerRep).toBe(2);
    expect(c.contactCaps.depthJumpRepCap).toBe(10);
    expect(c.highIntensitySchedule.powerLoadWeekDepthJumpReps).toEqual([6, 8, 10, 10, 10]);
    expect(c.deload.volumeFactorMin).toBe(0.4);
    expect(c.deload.volumeFactorMax).toBe(0.5);
    expect(c.dropHeight).toEqual({ maxIn: 24, maxInWhenHeavyOrUnknownIn: 18, heavyBodyweightLb: 220 });
    expect(c.workingMax.epleyConfidence).toBe(0.95);
    expect(c.workingMax.week2GuardPct).toBe(80);
    expect(c.maximalSessionSpacingDays).toBe(2);
    expect(c.rampSetPct).toEqual([60, 70]);
  });

  it('ships a per-set scheme for every load type', () => {
    const { schemes } = RULESET_V1.constants;
    expect(schemes.heavy_strength.startPct).toBe(75);
    expect(schemes.heavy_strength.stepPct).toBe(5);
    expect(schemes.heavy_strength.repDescent).toEqual([5, 4, 3]);
    expect(schemes.heavy_strength.repDescentAdvanced).toEqual([5, 3, 1]);
    expect(schemes.power.startPct).toBe(70);
    expect(schemes.power.stepPct).toBe(10);
    expect(schemes.speed_strength.startPct).toBe(50);
    expect(schemes.strength_speed.startPct).toBe(60);
    expect(schemes.hypertrophy.startPct).toBe(60);
    expect(schemes.hypertrophy.repDescent).toEqual([12, 10, 8]);
    expect(schemes.endurance.mode).toBe('straight');
    expect(schemes.prehab.holdSecondsRange).toEqual({ bottom: 30, top: 45 });
    // The loaded half of prehab: the tempo a heavy slow resistance row is done at.
    expect(schemes.prehab.slowResistance).toEqual({ tempoUpS: 3, tempoDownS: 3 });
    expect(schemes.mobility.mode).toBe('none');
    expect(schemes.bodyweight.mode).toBe('none');
    expect(schemes.ballistic.mode).toBe('straight');
  });

  it('refuses a malformed ruleset', () => {
    expect(() => validateRuleset(null)).toThrow(RulesetValidationError);
    expect(() => validateRuleset({ version: '1', houseRules: [], constants: {} })).toThrow(
      RulesetValidationError,
    );
  });
});

describe('layout table', () => {
  it('covers every program length from 2 to 16 weeks', () => {
    for (let W = 2; W <= 16; W += 1) {
      expect(layoutRowFor(RULESET_V1, W), `W = ${W}`).toBeDefined();
    }
  });

  it('sums to W for W 2 to 16, at every level', () => {
    for (let W = 2; W <= 16; W += 1) {
      for (const level of LEVELS) {
        const weeks = layoutFor(RULESET_V1, W, level);
        expect(weeks.length, `W = ${W}, ${level}`).toBe(W);
        expect(weeks.map((week) => week.w)).toEqual(
          Array.from({ length: W }, (_unused, index) => index + 1),
        );
      }
    }
  });

  it('ends every program with a peak week and puts Strength before Power', () => {
    for (let W = 2; W <= 16; W += 1) {
      for (const level of LEVELS) {
        const weeks = layoutFor(RULESET_V1, W, level);
        expect(weeks[weeks.length - 1]?.kind, `W = ${W}, ${level}`).toBe('peak');
        const blocks = blocksFor(weeks);
        const strengthIndex = blocks.findIndex((block) => block.type === 'strength');
        const powerIndex = blocks.findIndex((block) => block.type === 'power');
        if (strengthIndex >= 0 && powerIndex >= 0) {
          expect(strengthIndex, `W = ${W}, ${level}`).toBeLessThan(powerIndex);
        }
        expect(blocks[blocks.length - 1]?.type).toBe('power');
      }
    }
  });

  it('gives beginners a Strength block first at W of 4', () => {
    const beginner = layoutFor(RULESET_V1, 4, 'beginner');
    expect(beginner[0]?.blockType).toBe('strength');
    expect(layoutTextFor(RULESET_V1, 4, 'beginner')).toContain('Strength 1-3');
    const advanced = layoutFor(RULESET_V1, 4, 'advanced');
    expect(advanced[0]?.blockType).toBe('power');
  });

  it('lays out the confirmed 12-week program as Strength 1-4, Deload 5, Power 6-10, Taper 11, Peak 12', () => {
    const weeks = layoutFor(RULESET_V1, 12, 'advanced');
    expect(weeks.map((week) => `${week.blockType}:${week.kind}`)).toEqual([
      'strength:load',
      'strength:load',
      'strength:load',
      'strength:load',
      'strength:deload',
      'power:load',
      'power:load',
      'power:load',
      'power:load',
      'power:load',
      'power:taper',
      'power:peak',
    ]);
  });

  it('refuses lengths outside the table', () => {
    expect(() => layoutFor(RULESET_V1, 1, 'advanced')).toThrow(/shortest program/);
    expect(() => layoutFor(RULESET_V1, 17, 'advanced')).toThrow(/chain 12-week programs/);
  });
});

describe('deriveLevel', () => {
  it('maps training age conservatively', () => {
    expect(deriveLevel('none')).toBe('beginner');
    expect(deriveLevel('lt1')).toBe('beginner');
    expect(deriveLevel('1to3')).toBe('intermediate');
    expect(deriveLevel('4plus')).toBe('advanced');
  });

  it('adds the tendon runway only for raw training age None', () => {
    expect(needsTendonRunway('none')).toBe(true);
    expect(needsTendonRunway('lt1')).toBe(false);
  });
});

describe('calendar', () => {
  it('parses and rejects', () => {
    expect(isLocalDate('2026-09-08')).toBe(true);
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-9-8')).toBe(false);
    expect(() => parseLocalDate('nope')).toThrow();
  });

  it('adds days across months, years and a leap day', () => {
    expect(addDays('2026-09-08', 1)).toBe('2026-09-09');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('reads weekdays with Sunday at 0', () => {
    expect(weekdayOf('2026-09-08')).toBe(2);
    expect(weekdayOf('2026-11-29')).toBe(0);
    expect(nextWeekdayOnOrAfter('2026-09-08', 1)).toBe('2026-09-14');
    expect(nextWeekdayOnOrAfter('2026-09-08', 2)).toBe('2026-09-08');
  });

  it('counts whole days in both directions', () => {
    expect(diffDays('2026-09-08', '2026-11-29')).toBe(82);
    expect(diffDays('2026-11-29', '2026-09-08')).toBe(-82);
  });

  it('builds calendar weeks from day 0', () => {
    const windows = weekWindows('2026-09-08', 12);
    expect(windows.length).toBe(12);
    expect(windows[0]).toEqual({ start: '2026-09-08', end: '2026-09-14' });
    expect(windows[11]).toEqual({ start: '2026-11-24', end: '2026-11-30' });
  });

  it('makes the peak week contain the target date', () => {
    const W = programWeeks('2026-09-08', '2026-11-29');
    expect(W).toBe(12);
    const windows = weekWindows('2026-09-08', W);
    const peak = windows[W - 1];
    expect(peak).toBeDefined();
    expect(weekIndexOf('2026-09-08', W, '2026-11-29')).toBe(12);
  });

  it('places dates outside the program at no week', () => {
    expect(weekIndexOf('2026-09-08', 12, '2026-09-07')).toBeNull();
    expect(weekIndexOf('2026-09-08', 12, '2026-12-01')).toBeNull();
  });
});

describe('budgets', () => {
  it('applies the R89 trade and clamps into the level range', () => {
    expect(computeExtensiveTarget(60, 100, 1, 5)).toBe(60);
    expect(computeExtensiveTarget(60, 100, 4, 10)).toBe(80);
    expect(computeExtensiveTarget(60, 100, 8, 0)).toBe(100);
    expect(computeExtensiveTarget(60, 100, 0, 40)).toBe(60);
    expect(clamp(5, 1, 3)).toBe(3);
  });

  it('keeps the hard caps as literals', () => {
    expect(CONTACT_CAPS.highIntensityPerSession).toBe(25);
    expect(CONTACT_CAPS.highAmplitudePerSession).toBe(20);
    expect(CONTACT_CAPS.depthJumpContactsPerRep).toBe(2);
    expect(CONTACT_CAPS.depthJumpRepCap).toBe(10);
  });

  it('leaves 10 depth-jump reps once the test has spent its 5 contacts', () => {
    expect(depthJumpRepBudget(5)).toBe(10);
    expect(depthJumpRepBudget(21)).toBe(2);
    expect(depthJumpRepBudget(25)).toBe(0);
  });

  it('caps the step-off height at 24 in, 18 in when heavy or unknown', () => {
    expect(dropHeightCapIn(180)).toBe(24);
    expect(dropHeightCapIn(221)).toBe(18);
    expect(dropHeightCapIn(null)).toBe(18);
  });
});

describe('prng', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('forks by label into independent, reproducible streams', () => {
    expect(mulberry32(7).fork('accessory').next()).toBe(mulberry32(7).fork('accessory').next());
    expect(mulberry32(7).fork('accessory').next()).not.toBe(mulberry32(7).fork('ladder').next());
    expect(hashLabel('accessory')).toBe(hashLabel('accessory'));
  });

  it('picks and shuffles without mutating the input', () => {
    const items = [1, 2, 3, 4, 5];
    const prng = mulberry32(1);
    expect(items).toContain(prng.pick(items));
    expect(prng.shuffle(items).slice().sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(() => prng.pick([])).toThrow();
  });
});

describe('units formatters behind displayLoad', () => {
  it('writes a loaded set with a real multiplication sign', () => {
    expect(formatLoadedSet(5, 205)).toBe(`5 ${TIMES} 205 lb`);
    expect(TIMES).toBe('×');
    expect(MINUS).toBe('−');
  });

  it('writes bodyweight, hold, distance and rest rows', () => {
    expect(formatBodyweightSet(8)).toBe(`8 ${TIMES} BW`);
    expect(formatBodyweightSet(8, 20)).toBe(`8 ${TIMES} BW + 20 lb vest`);
    expect(formatHold(30)).toBe('30 s hold');
    expect(formatDistance(15)).toBe('15 m');
    expect(formatRest(180)).toBe('3:00');
    expect(formatRest(240)).toBe('4:00');
  });

  it('writes a velocity-mode row with a real minus sign', () => {
    expect(formatVelocitySet(3, 3, 0.75, 1, 20)).toBe(
      `3 ${TIMES} 3 @ 0.75 to 1.00 m/s, stop at ${MINUS}20%`,
    );
  });

  it('snaps loads to the grid the brief worked out', () => {
    expect(roundLoadLb(206.25, 'barbell')).toBe(205);
    expect(roundLoadLb(220, 'barbell')).toBe(220);
    expect(roundLoadLb(233.75, 'barbell')).toBe(235);
    expect(roundLoadLb(178.75, 'barbell')).toBe(180);
    expect(roundLoadLb(192.5, 'barbell')).toBe(195);
    expect(roundLoadLb(42, 'dumbbell')).toBe(40);
    expect(roundLoadLb(45.5, 'dumbbell')).toBe(45);
    expect(roundLoadLb(49, 'dumbbell')).toBe(50);
    expect(roundLoadLb(82.5, 'ballistic')).toBe(80);
  });
});

describe('speed climbing house rules and constants', () => {
  const climbing = RULESET_V1.constants.climbing;

  const HOUSE_RULE_IDS = [
    'house.sc.sport_requirements',
    'house.sc.upper_power_day',
    'house.sc.open_hand_grip',
    'house.sc.hard_finger_spacing',
    'house.sc.finger_pain_ceiling',
    'house.sc.rnt_valgus_control',
    'house.sc.weaker_side_first',
    'house.sc.box_squat_main_lift',
    'house.sc.readiness_gate',
    'house.sc.asymmetry_tracking',
    'house.sc.sequence_strength_rfd_reactive',
    'house.sc.calf_volume_low',
  ];

  it('ships every one in plain words, with a finger pain template beside them', () => {
    for (const id of [...HOUSE_RULE_IDS, 'house.pain_finger']) {
      const rule = findHouseRule(RULESET_V1, id);
      expect(rule, id).toBeDefined();
      expect(rule?.kind, id).toBe('house');
      expect(rule?.text.length ?? 0, id).toBeGreaterThan(40);
    }
  });

  it('ships the constants the house rules read', () => {
    expect(climbing.fingerSpacingHours).toBe(48);
    expect(climbing.fingerPainCeiling).toBe(3);
    expect(climbing.rntSessionsPerWeek).toBe(2);
    expect(climbing.rntWallGapHours).toBe(6);
    expect(climbing.calfSetsCap).toBe(2);
    expect(climbing.calfDaysPerWeek).toBe(1);
    expect(climbing.jumpOrReactiveSessionsPerWeek).toBe(1);
    expect(climbing.upperPowerSessionsPerWeek).toBe(1);
    expect(climbing.readiness).toEqual({
      kind: 'seated_mb_throw',
      metric: 'distance_m',
      attempts: 3,
      baselineWindow: 7,
      lowThresholdPct: 5,
      whoopLowScore: 40,
    });
  });

  it('refuses a readiness adjustment that would raise anything', () => {
    for (const state of Object.keys(climbing.readinessAdjustments)) {
      const adjustment = climbing.readinessAdjustments[state as keyof typeof climbing.readinessAdjustments];
      expect(adjustment.jumpVolumeFactor, state).toBeLessThanOrEqual(1);
      expect(adjustment.loadFactor, state).toBeLessThanOrEqual(1);
      expect(adjustment.extraReps, state).toBeGreaterThanOrEqual(0);
    }
  });

  it('writes a weighted pull-up row as added load only', () => {
    expect(formatAddedLoadSet(5, 45)).toBe(`5 ${TIMES} BW + 45 lb`);
    expect(formatAddedLoadSet(8, 0)).toBe(`8 ${TIMES} BW`);
  });
});
