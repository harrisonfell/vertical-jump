import { describe, expect, it } from 'vitest';
import {
  GLYPHS,
  GLYPH_NAMES,
  GLYPH_STROKE,
  GLYPH_VIEW_BOX,
  glyphNames,
  glyphPaths,
  type GlyphName,
} from './registry';

/**
 * The names the screens and the design brief ask for. If a screen references a
 * glyph the registry has not drawn, the Glyph component would render nothing
 * and the failure would be silent, so it fails here instead.
 */
const REQUIRED: readonly GlyphName[] = [
  'check',
  'pencil',
  'play',
  'stop',
  'settings',
  'chevron',
  'plus',
  'minus',
  'close',
  'flag',
  'today',
  'plan',
  'progress',
  'test',
  'pr',
  'instrument-ovr',
  'instrument-vertec',
  'whoop-dot',
  'day-strength',
  'day-upper',
  'day-power',
  'day-recovery',
  'day-rest',
  'state-planned',
  'state-done',
  'state-notfinished',
  'state-missed',
  'state-repeat',
  'category-strength',
  'category-plyometrics',
  'category-mobility',
  'category-technique',
  'sync',
  'offline',
  'warning-free',
];

const PATH_START = /^M[\s\d.-]/;
const NUMBER = /-?\d+(\.\d+)?/g;

describe('glyph registry', () => {
  it('draws every required name', () => {
    for (const name of REQUIRED) {
      expect(GLYPH_NAMES, `${name} is missing from GLYPH_NAMES`).toContain(name);
    }
  });

  it('lists every name exactly once', () => {
    expect(new Set(GLYPH_NAMES).size).toBe(GLYPH_NAMES.length);
    expect(glyphNames()).toEqual(GLYPH_NAMES);
  });

  it('renders every name to at least one drawable path', () => {
    for (const name of GLYPH_NAMES) {
      const paths = glyphPaths(name);
      expect(paths.length, `${name} has no paths`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.d, `${name} path does not start with a move`).toMatch(PATH_START);
        expect(path.d.trim().length, `${name} has an empty path`).toBeGreaterThan(3);
      }
    }
  });

  it('keeps every coordinate on the 20px grid', () => {
    for (const name of GLYPH_NAMES) {
      for (const path of glyphPaths(name)) {
        const numbers = path.d.match(NUMBER) ?? [];
        for (const raw of numbers) {
          const value = Number(raw);
          expect(Number.isFinite(value), `${name} has a non-finite coordinate`).toBe(true);
          expect(Math.abs(value), `${name} leaves the 20px grid: ${raw}`).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('keeps one stroke weight and one viewBox', () => {
    expect(GLYPH_STROKE).toBe(1.5);
    expect(GLYPH_VIEW_BOX).toBe('0 0 20 20');
  });

  it('exposes the registry as an exhaustive record', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...GLYPH_NAMES].sort());
  });
});
