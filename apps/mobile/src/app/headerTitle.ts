import { ROUTES } from './routes';

/**
 * The header's two routing decisions and its one typographic one, kept pure so
 * they can be tested without a renderer or a router.
 */

/** The three routes the tab bar can already reach. Everything else is pushed. */
const TAB_PATHS: readonly string[] = [ROUTES.today, ROUTES.plan, ROUTES.progress];

/**
 * True when the tab bar is already on screen and can bring the athlete home.
 *
 * Every other route (settings, settings/whoop, settings/import, clearance,
 * privacy, session/[id], pair, login) is pushed with the stack header hidden
 * and no tab bar under it, so without a control of its own it is a dead end.
 */
export function isTabRoute(pathname: string): boolean {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return TAB_PATHS.includes(trimmed === '' ? '/' : trimmed);
}

/**
 * Where a screen goes when there is no history to go back to: a deep link to a
 * session belongs to Plan, everything else to Today. Never a dead control.
 */
export function fallbackFor(pathname: string): string {
  return pathname.startsWith('/session') ? ROUTES.plan : ROUTES.today;
}

export interface SplitTitle {
  readonly head: string;
  readonly tail: string | undefined;
}

/**
 * Splits a four-part orientation sentence so the part naming the week and the
 * block reads at headline size and the day type and its suffixes drop to the
 * muted line under it.
 *
 * "Week 7 of 12 · Power block · Power + Speed · Test day" at 24px wraps to
 * three lines on a 390px phone, and the two-line cap cuts the suffix, which is
 * the part carrying the day's rule ("· Deload", "· Restricted").
 */
export function splitHeaderTitle(title: string, subtitle: string | undefined): SplitTitle {
  const parts = title.split(' · ');
  if (parts.length < 3) return { head: title, tail: subtitle };
  const rest = parts.slice(2).join(' · ');
  return {
    head: parts.slice(0, 2).join(' · '),
    tail: subtitle === undefined ? rest : `${rest} · ${subtitle}`,
  };
}
