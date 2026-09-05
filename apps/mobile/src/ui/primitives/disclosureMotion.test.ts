import { describe, expect, it } from 'vitest';
import { duration } from '../motion';
import {
  CHEVRON_CLOSED,
  CHEVRON_OPEN,
  chevronRotation,
  chevronTransition,
} from './disclosureMotion';

describe('the disclosure chevron', () => {
  it('turns a quarter when the section is open', () => {
    expect(chevronRotation(true)).toBe(CHEVRON_OPEN);
    expect(chevronRotation(false)).toBe(CHEVRON_CLOSED);
  });

  it('is a real quarter turn, not a shrug', () => {
    expect(CHEVRON_OPEN).toBe('90deg');
    expect(CHEVRON_CLOSED).toBe('0deg');
  });

  it('animates the transform over the state-change duration on the web', () => {
    const transition = chevronTransition(false);
    expect(transition).not.toBeNull();
    expect(transition?.transitionProperty).toBe('transform');
    expect(transition?.transitionDuration).toBe(`${duration.base}ms`);
    expect(transition?.transitionTimingFunction).toBe('cubic-bezier(0.25, 1, 0.5, 1)');
  });

  it('snaps under reduced motion instead of animating something else', () => {
    expect(chevronTransition(true)).toBeNull();
  });
});
