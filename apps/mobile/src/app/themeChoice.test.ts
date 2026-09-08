import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  SCHEME_CHOICES,
  SCHEME_CHOICE_LABEL,
  choiceOf,
  persistedChoice,
  readSchemeParam,
  startingOverride,
  toScheme,
  toggleLabel,
  toggledChoice,
} from './themeChoice';

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

describe('the stored preference', () => {
  it('offers three answers, system first', () => {
    expect(SCHEME_CHOICES).toEqual(['system', 'light', 'dark']);
    expect(SCHEME_CHOICES.map((choice) => SCHEME_CHOICE_LABEL[choice])).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
  });

  it('reads a stored row back as the answer it was written from', () => {
    expect(choiceOf('dark')).toBe('dark');
    expect(choiceOf('light')).toBe('light');
    // Nothing stored, and anything unreadable, means follow the phone.
    expect(choiceOf(null)).toBe('system');
    expect(choiceOf(undefined)).toBe('system');
    expect(choiceOf('sepia')).toBe('system');
  });

  it('round-trips: what the control writes is what the next launch reads', () => {
    for (const choice of ['light', 'dark'] as const) {
      // setOverride writes the choice verbatim; the launch read narrows it.
      expect(choiceOf(choice)).toBe(choice);
      expect(toScheme(choice)).toBe(choice);
    }
    // "system" is stored as the absence of a row, which reads back as system.
    expect(choiceOf(null)).toBe('system');
    expect(toScheme(null)).toBeUndefined();
  });
});

describe('the one-tap header control', () => {
  it('pins the opposite of what is on screen', () => {
    expect(toggledChoice('light')).toBe('dark');
    expect(toggledChoice('dark')).toBe('light');
  });

  it('is named for what the tap will do', () => {
    expect(toggleLabel('light')).toBe('Switch to dark theme');
    expect(toggleLabel('dark')).toBe('Switch to light theme');
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

/**
 * The preference is a kv row, which lands one tick after the database opens.
 * Painting the boot skeleton in the system scheme and correcting it afterwards
 * is the flash this guards against: the splash is held until the row has been
 * read, and the read is what marks the provider resolved.
 */
describe('the stored preference is written and waited for', () => {
  const theme = readFileSync(fileURLToPath(new URL('./theme.tsx', import.meta.url)), 'utf8');
  const providers = readFileSync(
    fileURLToPath(new URL('./providers.tsx', import.meta.url)),
    'utf8',
  );

  it('persists through the kv store the rest of the app already uses', () => {
    expect(theme).toContain('kvStore.kvSet(db, THEME_OVERRIDE_KEY, choice)');
    expect(theme).toContain('kvStore.kvDelete(db, THEME_OVERRIDE_KEY)');
    expect(theme).toContain('kvStore.kvGet(db, THEME_OVERRIDE_KEY)');
  });

  it('reports the preference resolved only once it has been read', () => {
    expect(theme).toContain('setRead(true)');
    expect(theme).toContain('const resolved = read ||');
    // A database that never opens, and the static export pass, resolve anyway.
    expect(theme).toContain("status === 'error'");
    expect(theme).toContain("typeof window === 'undefined'");
  });

  it('holds the splash until then, so no frame paints in the wrong scheme', () => {
    expect(providers).toContain('useSplashUntil(resolved)');
    expect(providers).toContain('SPLASH_MAX_MS');
    // The fonts hook must no longer hide the splash on its own.
    const hook = providers.slice(
      providers.indexOf('export function useAppFonts'),
      providers.indexOf('const SPLASH_MAX_MS'),
    );
    expect(hook).not.toContain('hideAsync');
  });
});
