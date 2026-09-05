import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { msUntilNextRollover, todayLocal } from '../lib/localDay';
import { openExecutor, type SqlExecutor } from './executor';
import { fixtureMode, seedIfEmpty } from './fixtures/seed';
import { migrate } from './migrate';
import { getAthlete } from './store/athlete';

/**
 * Opens the database, migrates it, and seeds a fixture when asked to.
 *
 * Children render immediately: every screen has a cached or skeleton path, and
 * blocking the tree on a disk open would put a blank frame in front of the
 * athlete on every cold start. `useDbReady` is what a screen waits on.
 */

export interface DbState {
  readonly status: 'opening' | 'ready' | 'error';
  readonly executor: SqlExecutor | null;
  readonly error: Error | null;
  /** The athlete's own today, from their timezone and rollover hour. */
  readonly today: string;
  readonly timezone: string;
}

const FALLBACK_TIMEZONE = 'UTC';

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * The athlete's today, kept current for as long as the app is open.
 *
 * Computing it once at boot freezes it: an iOS app stays resident for days, so
 * the athlete finishes Monday's session, the phone sleeps, and Tuesday morning
 * in the gym still shows Monday. Tuesday's workout is unreachable, Monday never
 * becomes missed, and a set logged after the rollover hour is stamped on the
 * wrong training day. Every rollover consumer reads this one string.
 *
 * It is refreshed by a timer armed for the next rollover boundary, by a minute
 * heartbeat that covers a device that slept through it, and on the web by the
 * tab becoming visible again. State is only set when the day actually changes,
 * so the query cache is never churned by a tick that landed on the same day.
 *
 * No `AppState`: this module is the data layer's entry point and every store
 * test imports through it, so it stays free of react-native. React Native's
 * timers fire on resume, which is the case that matters.
 */
function useLocalToday(timezone: string, rolloverHour: number): string {
  const [today, setToday] = useState(() => todayLocal(timezone, rolloverHour));

  const refresh = useCallback(() => {
    const day = todayLocal(timezone, rolloverHour);
    setToday((current) => (current === day ? current : day));
  }, [rolloverHour, timezone]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    // Two timers, both cheap. The boundary timer is the one that matters and
    // fires on resume if the device slept through it; the minute heartbeat is
    // the belt and braces for a clock the app cannot observe changing (a
    // manual clock change, a flight, a timer the platform coalesced away).
    // Neither sets state unless the day string actually moved, so the query
    // cache is never churned by a tick.
    const boundary = setTimeout(refresh, msUntilNextRollover(timezone, rolloverHour));
    const heartbeat = setInterval(refresh, 60_000);

    const canListen =
      typeof document !== 'undefined' && typeof document.addEventListener === 'function';
    if (canListen) {
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('focus', refresh);
    }

    return () => {
      clearTimeout(boundary);
      clearInterval(heartbeat);
      if (canListen) {
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('focus', refresh);
      }
    };
  }, [refresh, rolloverHour, timezone]);

  return today;
}

const DbContext = createContext<DbState | null>(null);

export interface DbProviderProps {
  readonly children: ReactNode;
  /** Overrides the platform executor. Tests and Storybook pass their own. */
  readonly executor?: SqlExecutor;
}

export function DbProvider({ children, executor: provided }: DbProviderProps): React.JSX.Element {
  const [executor, setExecutor] = useState<SqlExecutor | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [timezone, setTimezone] = useState<string>(deviceTimezone);
  const [rolloverHour, setRolloverHour] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const open = async (): Promise<void> => {
      try {
        const db = provided ?? (await openExecutor());
        await migrate(db);

        const zone = deviceTimezone();
        const stored = await getAthlete(db);
        const athleteZone = stored?.timezone ?? zone;
        const hour = stored?.rolloverHour ?? 0;

        await seedIfEmpty(db, todayLocal(athleteZone, hour), athleteZone, fixtureMode());

        // Seeding can set the zone, so read it back before anyone derives a day.
        const seeded = await getAthlete(db);
        if (cancelled) return;
        setTimezone(seeded?.timezone ?? athleteZone);
        setRolloverHour(seeded?.rolloverHour ?? hour);
        setExecutor(db);
      } catch (caught) {
        if (!cancelled) setError(toError(caught));
      }
    };

    void open();
    return () => {
      cancelled = true;
    };
  }, [provided]);

  const today = useLocalToday(timezone, rolloverHour);

  const value = useMemo<DbState>(() => {
    const status: DbState['status'] =
      error !== null ? 'error' : executor !== null ? 'ready' : 'opening';
    return { status, executor, error, timezone, today };
  }, [executor, error, timezone, today]);

  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDbState(): DbState {
  const state = useContext(DbContext);
  if (state === null) throw new Error('useDbState must be used inside a DbProvider.');
  return state;
}

/** True once migrations have run, plus the error to show if they did not. */
export function useDbReady(): { readonly ready: boolean; readonly error: Error | null } {
  const { status, error } = useDbState();
  return { ready: status === 'ready', error };
}

/** The executor, or null while it is still opening. Hooks gate on this. */
export function useDbOrNull(): SqlExecutor | null {
  return useDbState().executor;
}

/** The executor, for code that already knows the database is ready. */
export function useDb(): SqlExecutor {
  const { executor } = useDbState();
  if (executor === null) throw new Error('useDb was called before the database was ready.');
  return executor;
}

/**
 * The athlete's today. It moves on its own: at the rollover boundary, when the
 * app comes back to the foreground, and when the web tab is looked at again.
 */
export function useToday(): string {
  return useDbState().today;
}

export function useTimezone(): string {
  return useDbState().timezone;
}
