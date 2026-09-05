import { formatLoadedSet } from '@vert/engine/units';
import { describe, expect, it } from 'vitest';
import { colors, type SchemeName } from './tokens.generated';
import { dataColors, schemeOklch } from './tokens.oklch';

const SCHEMES: readonly SchemeName[] = ['light', 'dark'];
const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0(\.\d+)?\)$/;

describe('generated tokens', () => {
  it('covers both schemes with parseable colours', () => {
    for (const scheme of SCHEMES) {
      const c = colors[scheme];
      for (const key of ['paper', 'paper2', 'paper3', 'ink', 'ink2', 'ink3', 'green', 'greenSoft', 'onGreen'] as const) {
        expect(c[key], `${scheme}.${key}`).toMatch(HEX);
      }
      expect(c.rule, `${scheme}.rule`).toMatch(RGBA);
      expect(c.ruleStrong, `${scheme}.ruleStrong`).toMatch(RGBA);
    }
  });

  it('stays in step with the OKLCH source', () => {
    for (const scheme of SCHEMES) {
      expect(Object.keys(colors[scheme].data).sort()).toEqual(
        Object.keys(dataColors[scheme]).sort(),
      );
      for (const key of Object.keys(schemeOklch[scheme])) {
        expect(colors[scheme]).toHaveProperty(key);
      }
    }
  });

  it('never resolves to pure black or pure white', () => {
    for (const scheme of SCHEMES) {
      const values = [
        ...Object.values(colors[scheme]).filter((v): v is string => typeof v === 'string'),
        ...Object.values(colors[scheme].data),
      ];
      for (const value of values) {
        expect(value).not.toBe('#000000');
        expect(value).not.toBe('#ffffff');
      }
    }
  });
});

describe('engine reachability from apps/mobile', () => {
  it('resolves @vert/engine/units through the workspace', () => {
    expect(formatLoadedSet(5, 205)).toBe('5 \u00d7 205 lb');
  });
});
