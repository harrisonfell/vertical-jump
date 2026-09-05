import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { persistedChoice, readSchemeParam, startingOverride, toScheme } from './themeChoice';

/**
 * `useColorScheme` on the web is a subscription to
 * `matchMedia('(prefers-color-scheme: dark)')`, so the machine this suite
 * describes is one whose system scheme is dark. The check that closed D-04 ran
 * on a browser with no dark preference, which proved nothing: here the
 * preference is dark on purpose.
 */
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  useColorScheme: (): 'light' | 'dark' =>
    globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
}));

function systemPrefersDark(dark: boolean): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: dark && query.includes('dark') }),
  });
}

describe('readSchemeParam', () => {
  it('reads the three answers and refuses everything else', () => {
    expect(readSchemeParam('?theme=light')).toBe('light');
    expect(readSchemeParam('?theme=DARK')).toBe('dark');
    expect(readSchemeParam('?fixture=1&theme=system')).toBe('system');
    expect(readSchemeParam('?theme=sepia')).toBeNull();
    expect(readSchemeParam('?theme=')).toBeNull();
    expect(readSchemeParam('')).toBeNull();
  });
});

describe('toScheme', () => {
  it('follows the system for anything unreadable', () => {
    expect(toScheme('dark')).toBe('dark');
    expect(toScheme(null)).toBeUndefined();
    expect(toScheme('sepia')).toBeUndefined();
  });
});

describe('startingOverride', () => {
  it('lets the URL win over what was stored, not only over an empty kv', () => {
    expect(startingOverride('?theme=light', 'dark')).toBe('light');
    expect(startingOverride('?theme=dark', 'light')).toBe('dark');
  });

  it('keeps the stored choice when the URL says nothing', () => {
    expect(startingOverride('', 'dark')).toBe('dark');
    expect(startingOverride('?fixture=1', 'light')).toBe('light');
    expect(startingOverride('', null)).toBeUndefined();
  });

  it('treats ?theme=system as an instruction to follow the system again', () => {
    expect(startingOverride('?theme=system', 'dark')).toBeUndefined();
  });
});

describe('persistedChoice', () => {
  it('writes what was asked, clears on system, and leaves kv alone otherwise', () => {
    expect(persistedChoice('?theme=light')).toBe('light');
    expect(persistedChoice('?theme=system')).toBeNull();
    expect(persistedChoice('?fixture=1')).toBeUndefined();
  });
});

describe('a dark machine asked for ?theme=light', () => {
  it('paints light on the first frame, before kv has answered', async () => {
    systemPrefersDark(true);
    const { useScheme } = await import('@/ui/theme');

    // Nothing read from the database yet: this is the first render.
    const override = startingOverride('?theme=light', null);
    expect(override).toBe('light');
    expect(useScheme(override)).toBe('light');

    // And the same machine with no query still follows the system.
    expect(useScheme(startingOverride('', null))).toBe('dark');
  });

  it('follows a light system when the URL asks for dark', async () => {
    systemPrefersDark(false);
    const { useScheme } = await import('@/ui/theme');

    expect(useScheme(startingOverride('?theme=dark', null))).toBe('dark');
    expect(useScheme(startingOverride('', null))).toBe('light');
  });
});

/**
 * The provider itself needs a renderer and a database to exercise, and the
 * regression it guards against is a timing one: expo-router rewrites the
 * address bar to the matched route as soon as it mounts, so an effect that
 * waits for kv finds no query at all and falls back to the system scheme. The
 * first frame came up light and then flipped to dark on its own. Reading the
 * source is enough for the thing that actually regresses, which is someone
 * putting `window.location.search` back inside the effect.
 */
describe('AppThemeProvider reads the query once', () => {
  const source = readFileSync(fileURLToPath(new URL('./theme.tsx', import.meta.url)), 'utf8');

  it('caches the search string instead of re-reading it after the router runs', () => {
    expect(source).toContain('let capturedSearch');
    // One read of the address bar in the whole file, inside that cache.
    expect(source.match(/window\.location\.search/g)).toHaveLength(1);
    expect(source.indexOf('let capturedSearch')).toBeLessThan(
      source.indexOf('export function AppThemeProvider'),
    );
  });

  it('keeps the read off module scope, so the static export pass has no window', () => {
    expect(source).toContain("typeof window === 'undefined'");
  });
});
