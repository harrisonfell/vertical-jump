import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import { useDbOrNull, useDbState } from '@/data';
import { kvStore } from '@/data/store';
import { ThemeProvider, type SchemeName } from '@/ui';
import {
  THEME_OVERRIDE_KEY,
  choiceOf,
  persistedChoice,
  startingOverride,
  toScheme,
  type SchemeChoice,
} from './themeChoice';

/**
 * The scheme follows the system. This wrapper adds the one override the owner
 * and a screenshot pass need: `?theme=dark` on the web, read once and kept, and
 * the same value on native from the kv table. `?theme=system` clears it.
 *
 * The decision itself lives in `themeChoice.ts`, which is pure and tested.
 */

export {
  SCHEME_CHOICES,
  SCHEME_CHOICE_LABEL,
  THEME_OVERRIDE_KEY,
  readSchemeParam,
  toggleLabel,
  toggledChoice,
  type SchemeChoice,
} from './themeChoice';

/**
 * The query string this load carries, or none off the web.
 *
 * Read once and kept. expo-router normalises the address bar as soon as it has
 * matched a route, so `?theme=light` is already gone by the time an effect that
 * waited for the database looks for it: the first frame came up light and the
 * screen then flipped to the system's dark. The read happens on the first
 * render (never at module scope, which the static export pass has no window
 * for) and every later reader gets the same answer.
 */
let capturedSearch: string | null | undefined;

function currentSearch(): string | null {
  if (capturedSearch === undefined) {
    capturedSearch =
      Platform.OS !== 'web' || typeof window === 'undefined' ? null : window.location.search;
  }
  return capturedSearch;
}

/**
 * The scheme asked for in the URL, read at the first render rather than in an
 * effect that waits for the database.
 *
 * `?theme=light` on a machine whose system scheme is dark used to paint the
 * whole first frame dark and only correct itself once kv had been read, which
 * on a screenshot pass is the only frame there is. A query the browser already
 * handed us needs no round trip.
 */
function initialOverride(): SchemeName | undefined {
  const search = currentSearch();
  return search === null ? undefined : startingOverride(search, null);
}

interface ThemeOverrideControl {
  readonly override: SchemeName | undefined;
  /** The stored preference as the athlete answered it: system, light, or dark. */
  readonly choice: SchemeChoice;
  /**
   * True once the stored preference has been read (or once it is known there
   * is nothing to read). The splash is held until then, so a phone whose
   * system is dark and whose stored answer is light never paints one frame of
   * charcoal before it corrects itself.
   */
  readonly resolved: boolean;
  /** Settings and the Progress header call this; it writes kv and re-renders. */
  setOverride(choice: SchemeChoice): void;
}

const ThemeOverrideContext = createContext<ThemeOverrideControl>({
  override: undefined,
  choice: 'system',
  resolved: true,
  setOverride: () => undefined,
});

export function AppThemeProvider({ children }: { readonly children: ReactNode }) {
  const db = useDbOrNull();
  const { status } = useDbState();
  const [override, setOverrideState] = useState<SchemeName | undefined>(initialOverride);
  const [read, setRead] = useState(false);

  useEffect(() => {
    if (db === null) return;
    let cancelled = false;

    const load = async (): Promise<void> => {
      const stored = await kvStore.kvGet(db, THEME_OVERRIDE_KEY);
      const search = currentSearch();

      // The URL wins on every load, not only when kv happens to be empty, and
      // then persists, so a reload without the query keeps the same scheme.
      if (search !== null) {
        const asked = persistedChoice(search);
        if (asked === null) await kvStore.kvDelete(db, THEME_OVERRIDE_KEY);
        else if (asked !== undefined) await kvStore.kvSet(db, THEME_OVERRIDE_KEY, asked);
      }

      if (!cancelled) {
        setOverrideState(search === null ? toScheme(stored) : startingOverride(search, stored));
        setRead(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const setOverride = useCallback(
    (choice: SchemeChoice) => {
      setOverrideState(choice === 'system' ? undefined : choice);
      if (db === null) return;
      void (choice === 'system'
        ? kvStore.kvDelete(db, THEME_OVERRIDE_KEY)
        : kvStore.kvSet(db, THEME_OVERRIDE_KEY, choice));
    },
    [db],
  );

  // A database that failed to open has no preference to wait for, and neither
  // does the static export pass, which never runs an effect at all. Both are
  // resolved by definition: holding the splash on them would hold it forever.
  const resolved = read || status === 'error' || typeof window === 'undefined';

  const control = useMemo<ThemeOverrideControl>(
    () => ({ override, choice: choiceOf(override), resolved, setOverride }),
    [override, resolved, setOverride],
  );

  return (
    <ThemeOverrideContext.Provider value={control}>
      <ThemeProvider override={override}>{children}</ThemeProvider>
    </ThemeOverrideContext.Provider>
  );
}

/** The current override and the setter Settings uses. */
export function useThemeOverride(): ThemeOverrideControl {
  return useContext(ThemeOverrideContext);
}
