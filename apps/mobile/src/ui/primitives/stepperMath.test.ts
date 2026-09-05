import { describe, expect, it } from 'vitest';
import {
  clampToBounds,
  decimalsForStep,
  parseNumeric,
  roundTo,
  stepDisabled,
  stepValue,
} from './stepperMath';

describe('decimalsForStep', () => {
  it('reads the precision off the step', () => {
    expect(decimalsForStep(5)).toBe(0);
    expect(decimalsForStep(1)).toBe(0);
    expect(decimalsForStep(0.1)).toBe(1);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(0.01)).toBe(2);
  });

  it('survives a step written in exponent form', () => {
    expect(decimalsForStep(1e-2)).toBe(2);
    expect(decimalsForStep(1e2)).toBe(0);
  });
});

describe('stepValue at 0.1', () => {
  it('never drifts across a long climb', () => {
    let value = 28;
    for (let i = 0; i < 50; i += 1) value = stepValue(value, 0.1, 1);
    expect(value).toBe(33);
    expect(value.toFixed(1)).toBe('33.0');
  });

  it('produces the exact decimal at each of the classic drift points', () => {
    expect(stepValue(32.5, 0.1, 1)).toBe(32.6);
    expect(stepValue(0.1, 0.1, 1)).toBe(0.2);
    expect(stepValue(0.3, 0.1, -1)).toBe(0.2);
    expect(stepValue(1.005, 0.1, 1)).toBe(1.1);
  });

  it('climbs and descends back to where it started', () => {
    let value = 31.8;
    for (let i = 0; i < 12; i += 1) value = stepValue(value, 0.1, 1);
    for (let i = 0; i < 12; i += 1) value = stepValue(value, 0.1, -1);
    expect(value).toBe(31.8);
  });
});

describe('stepValue bounds', () => {
  it('stops at the device floor and ceiling', () => {
    expect(stepValue(6, 0.1, -1, { min: 6, max: 60 })).toBe(6);
    expect(stepValue(60, 0.1, 1, { min: 6, max: 60 })).toBe(60);
    expect(stepValue(6.05, 0.1, -1, { min: 6 })).toBe(6);
  });

  it('leaves an unset bound open', () => {
    expect(stepValue(-3, 1, -1)).toBe(-4);
    expect(stepValue(0, 5, 1, { max: 3 })).toBe(3);
  });

  it('recovers from a non-finite value', () => {
    expect(stepValue(Number.NaN, 0.1, 1, { min: 6, max: 60 })).toBe(6);
    expect(stepValue(Number.NaN, 5, 1)).toBe(0);
  });

  it('steps a barbell load on its 5 lb grid', () => {
    expect(stepValue(205, 5, 1)).toBe(210);
    expect(stepValue(205, 5, -1, { min: 45 })).toBe(200);
  });
});

describe('stepDisabled', () => {
  it('is true only when the press would change nothing', () => {
    expect(stepDisabled(6, 0.1, -1, { min: 6 })).toBe(true);
    expect(stepDisabled(6, 0.1, 1, { min: 6 })).toBe(false);
    expect(stepDisabled(60, 0.1, 1, { max: 60 })).toBe(true);
    expect(stepDisabled(32.5, 0.1, 1)).toBe(false);
  });
});

describe('clampToBounds and roundTo', () => {
  it('clamps on both sides', () => {
    expect(clampToBounds(3, { min: 6, max: 60 })).toBe(6);
    expect(clampToBounds(90, { min: 6, max: 60 })).toBe(60);
    expect(clampToBounds(30, { min: 6, max: 60 })).toBe(30);
  });

  it('rounds half up without binary surprises', () => {
    expect(roundTo(32.55, 1)).toBe(32.6);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-2.5, 0)).toBe(-3);
  });
});

describe('parseNumeric', () => {
  it('reads what the athlete typed', () => {
    expect(parseNumeric('32.5')).toBe(32.5);
    expect(parseNumeric(' 205 ')).toBe(205);
    expect(parseNumeric('32,5')).toBe(32.5);
    expect(parseNumeric('-1.5')).toBe(-1.5);
  });

  it('returns null for a half-typed or invalid field', () => {
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('.')).toBeNull();
    expect(parseNumeric('-')).toBeNull();
    expect(parseNumeric('32.5.1')).toBeNull();
    expect(parseNumeric('abc')).toBeNull();
  });
});
