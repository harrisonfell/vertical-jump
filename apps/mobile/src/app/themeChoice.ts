import type { SchemeName } from '@/ui';

/**
 * The scheme override, decided as a table.
 *
 * Kept free of react-native and of the data layer so the one case that keeps
 * being got wrong (a machine whose system scheme is dark, asked for
 * `?theme=light`) can be tested without a browser or a database.
 */

export const THEME_OVERRIDE_KEY = 'settings.themeOverride';

export type SchemeChoice = SchemeName | 'system';

/** The three answers, in the order the segmented control lays them down. */
export const SCHEME_CHOICES: readonly SchemeChoice[] = ['system', 'light', 'dark'];

/** What each answer is called. The words are the control; the colour is not. */
export const SCHEME_CHOICE_LABEL: Readonly<Record<SchemeChoice, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** The stored kv string as a choice. Anything unreadable follows the system. */
export function choiceOf(stored: string | null | undefined): SchemeChoice {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * What one tap on the header control does: pin the opposite of what is on
 * screen right now.
 *
 * The evening review is where the athlete notices the room has gone dark, and
 * a control that had to be tapped twice to get past "system" would be a
 * puzzle. Settings keeps the three-way answer, including the way back to
 * following the phone.
 */
export function toggledChoice(active: SchemeName): SchemeName {
  return active === 'dark' ? 'light' : 'dark';
}

/** "Switch to dark theme": what the control will do, never what it is. */
export function toggleLabel(active: SchemeName): string {
  return `Switch to ${toggledChoice(active)} theme`;
}

/** Reads `?theme=` out of a query string. Anything else is not an answer. */
export function readSchemeParam(search: string): SchemeChoice | null {
  const match = /[?&]theme=([^&#]*)/.exec(search);
  const value = match?.[1];
  if (value === undefined) return null;
  const decoded = decodeURIComponent(value).toLowerCase();
  if (decoded === 'light' || decoded === 'dark' || decoded === 'system') return decoded;
  return null;
}

/** Narrows a stored kv string to a scheme; anything unreadable follows the system. */
export function toScheme(value: string | null): SchemeName | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

/**
 * The override a load starts with.
 *
 * The URL wins on every load, not only when kv happens to be empty: a query
 * the browser already handed us is the most recent instruction there is, and
 * reading it only as a fallback is what left `?theme=light` painting dark on a
 * dark machine. `?theme=system` is an instruction too, and clears the stored
 * choice rather than being ignored.
 */
export function startingOverride(search: string, stored: string | null): SchemeName | undefined {
  const asked = readSchemeParam(search);
  if (asked === 'system') return undefined;
  if (asked !== null) return asked;
  return toScheme(stored);
}

/** What the URL asks be written to kv: a scheme, `null` to clear, or no change. */
export function persistedChoice(search: string): SchemeName | null | undefined {
  const asked = readSchemeParam(search);
  if (asked === null) return undefined;
  return asked === 'system' ? null : asked;
}
