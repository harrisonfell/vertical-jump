import { describe, expect, it } from 'vitest';
import { fallbackFor, isTabRoute, splitHeaderTitle } from './headerTitle';

describe('isTabRoute', () => {
  it('knows the three routes the tab bar already reaches', () => {
    expect(isTabRoute('/')).toBe(true);
    expect(isTabRoute('/plan')).toBe(true);
    expect(isTabRoute('/progress')).toBe(true);
  });

  it('treats every pushed route as needing its own way back', () => {
    for (const path of [
      '/settings',
      '/settings/whoop',
      '/settings/import',
      '/clearance',
      '/privacy',
      '/session/abc',
      '/pair',
      '/login',
      '/setup/two',
    ]) {
      expect(isTabRoute(path)).toBe(false);
    }
  });

  it('ignores a trailing slash, which the web build adds', () => {
    expect(isTabRoute('/plan/')).toBe(true);
    expect(isTabRoute('')).toBe(true);
  });
});

describe('fallbackFor', () => {
  it('sends a deep-linked session back to Plan and everything else to Today', () => {
    expect(fallbackFor('/session/abc')).toBe('/plan');
    expect(fallbackFor('/settings/import')).toBe('/');
  });
});

describe('splitHeaderTitle', () => {
  it('keeps a short title whole', () => {
    expect(splitHeaderTitle('Progress', undefined)).toEqual({ head: 'Progress', tail: undefined });
    expect(splitHeaderTitle('Week 7 of 12 · Power block', undefined)).toEqual({
      head: 'Week 7 of 12 · Power block',
      tail: undefined,
    });
  });

  it('drops the day type and its suffixes to the second line', () => {
    expect(
      splitHeaderTitle('Week 7 of 12 · Power block · Power + Speed · Test day', undefined),
    ).toEqual({ head: 'Week 7 of 12 · Power block', tail: 'Power + Speed · Test day' });
  });

  it('keeps an existing subtitle after the part it moved down', () => {
    expect(
      splitHeaderTitle('Week 7 of 12 · Power block · Power + Speed · Deload', 'about 100 min'),
    ).toEqual({
      head: 'Week 7 of 12 · Power block',
      tail: 'Power + Speed · Deload · about 100 min',
    });
  });
});
