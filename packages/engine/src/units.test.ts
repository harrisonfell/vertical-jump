import { describe, expect, it } from 'vitest';
import {
  MINUS,
  TIMES,
  displayLoadLb,
  floorToStep,
  formatBodyweightSet,
  formatContactMs,
  formatCuts,
  formatDistance,
  formatHeightDeltaIn,
  formatHeightIn,
  formatHeightValueIn,
  formatHold,
  formatLastTime,
  formatLoadedSet,
  formatPercentDelta,
  formatRepsOnly,
  formatRest,
  formatSetsByReps,
  formatVelocity,
  formatVelocitySet,
  formatVelocityZone,
  inToMm,
  kgToLb,
  lbToKg,
  mmToIn,
  roundHalfUp,
  roundLoadLb,
  roundToStep,
  roundToStepTiesDown,
} from './units.js';

describe('conversions', () => {
  it('round-trips inches and millimetres', () => {
    expect(mmToIn(inToMm(32.5))).toBeCloseTo(32.5, 10);
    expect(mmToIn(25.4)).toBeCloseTo(1, 10);
  });

  it('round-trips pounds and kilograms', () => {
    expect(kgToLb(lbToKg(205))).toBeCloseTo(205, 10);
    expect(kgToLb(1)).toBeCloseTo(2.2046226218, 8);
  });
});

describe('rounding', () => {
  it('rounds half up, symmetric about zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(0.15, 1)).toBe(0.2);
  });

  it('snaps to a step', () => {
    expect(roundToStep(206.25, 5)).toBe(205);
    expect(roundToStep(207.5, 5)).toBe(210);
    expect(roundToStepTiesDown(207.5, 5)).toBe(205);
    expect(roundToStepTiesDown(208, 5)).toBe(210);
    expect(floorToStep(82.5, 5)).toBe(80);
  });

  it('applies the equipment grid per load type', () => {
    // Brief section 09: 75% of 275 is 206.25, prescribed as 205.
    expect(roundLoadLb(206.25, 'barbell')).toBe(205);
    // 85% of 275 is 233.75, prescribed as 235.
    expect(roundLoadLb(233.75, 'barbell')).toBe(235);
    // Dumbbell hypertrophy: 65% of 70 is 45.5, prescribed as 45.
    expect(roundLoadLb(45.5, 'dumbbell')).toBe(45);
    // Loaded jump squat, advanced: 30% of 275 is 82.5, always down.
    expect(roundLoadLb(82.5, 'ballistic')).toBe(80);
  });

  it('converts a stored kilogram load to a display grid', () => {
    expect(displayLoadLb(lbToKg(206.25), 'barbell')).toBe(205);
    expect(displayLoadLb(lbToKg(82.5), 'ballistic')).toBe(80);
  });
});

describe('notation', () => {
  it('uses the real multiplication and minus signs', () => {
    expect(TIMES).toBe('\u00d7');
    expect(MINUS).toBe('\u2212');
    expect(formatLoadedSet(5, 205)).not.toContain('x');
    expect(formatPercentDelta(-20)).not.toContain('-');
  });

  it('formats every notation example in the contract', () => {
    expect(formatLoadedSet(5, 205)).toBe('5 \u00d7 205 lb');
    expect(formatBodyweightSet(8)).toBe('8 \u00d7 BW');
    expect(formatBodyweightSet(8, 20)).toBe('8 \u00d7 BW + 20 lb vest');
    expect(formatHold(30)).toBe('30 s hold');
    expect(formatDistance(15)).toBe('15 m');
    expect(formatVelocitySet(3, 3, 0.75, 1, 20)).toBe(
      '3 \u00d7 3 @ 0.75 to 1.00 m/s, stop at \u221220%',
    );
    expect(formatHeightIn(inToMm(32.5))).toBe('32.5 in');
    expect(formatContactMs(0.212)).toBe('212 ms');
    expect(formatVelocity(0.82)).toBe('0.82 m/s');
    expect(formatRest(180)).toBe('3:00');
  });

  it('formats the remaining set shapes', () => {
    expect(formatSetsByReps(4, 220)).toBe('4 \u00d7 220');
    expect(formatVelocityZone(0.5, 0.75)).toBe('0.50 to 0.75 m/s');
    expect(formatRest(90)).toBe('1:30');
    expect(formatRest(0)).toBe('0:00');
    expect(formatRest(605)).toBe('10:05');
  });

  it('formats signed deltas with a real minus sign', () => {
    expect(formatPercentDelta(-20)).toBe('\u221220%');
    expect(formatPercentDelta(5)).toBe('+5%');
    expect(formatPercentDelta(0)).toBe('0%');
    expect(formatHeightDeltaIn(inToMm(0.4))).toBe('+0.4');
    expect(formatHeightDeltaIn(inToMm(-0.4))).toBe('\u22120.4');
    expect(formatHeightDeltaIn(0)).toBe('0.0');
  });

  it('shows heights at one decimal and contact times whole', () => {
    expect(formatHeightIn(inToMm(29.44))).toBe('29.4 in');
    expect(formatHeightIn(inToMm(30))).toBe('30.0 in');
    expect(formatHeightValueIn(inToMm(32.5))).toBe('32.5');
    expect(formatContactMs(0.2124)).toBe('212 ms');
    expect(formatContactMs(0.2126)).toBe('213 ms');
  });

  it('counts a change-of-direction row in runs and cuts, never in bodyweight', () => {
    // D-19: a shuttle is a run. "1 x BW" borrows notation it does not own.
    expect(formatRepsOnly(1)).toBe('1 rep');
    expect(formatRepsOnly(4)).toBe('4 reps');
    expect(formatCuts(1)).toBe('1 cut');
    expect(formatCuts(2)).toBe('2 cuts');
    expect(formatRepsOnly(1)).not.toContain('BW');
  });

  it('writes the last-time line the way brief section 13 sets it', () => {
    // D-20: reps only for a bodyweight row, the pair for a loadable one.
    expect(formatLastTime([{ reps: 5 }, { reps: 5 }])).toBe('last 5 / 5');
    expect(
      formatLastTime([
        { reps: 5, loadLb: 205 },
        { reps: 4, loadLb: 220 },
        { reps: 3, loadLb: 235 },
      ]),
    ).toBe('last 5 × 205 / 4 × 220 / 3 × 235');
    expect(formatLastTime([])).toBeUndefined();
  });

  it('collapses more than four identical sets instead of repeating them', () => {
    const bodyweight = Array.from({ length: 6 }, () => ({ reps: 8 }));
    expect(formatLastTime(bodyweight)).toBe('last 8 × 6 sets');
    const four = Array.from({ length: 4 }, () => ({ reps: 8 }));
    expect(formatLastTime(four)).toBe('last 8 / 8 / 8 / 8');
    const loaded = Array.from({ length: 6 }, () => ({ reps: 5, loadLb: 205 }));
    expect(formatLastTime(loaded)).toBe('last 5 × 205 × 6 sets');
    const mixed = [{ reps: 8 }, { reps: 8 }, { reps: 8 }, { reps: 8 }, { reps: 7 }];
    expect(formatLastTime(mixed)).toBe('last 8 / 8 / 8 / 8 / 7');
  });
});
