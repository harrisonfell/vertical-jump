import type { GlyphName } from '../glyphs';

export interface NavItem {
  /** Route inside the (tabs) group. */
  readonly href: '/' | '/plan' | '/progress';
  readonly label: string;
  readonly glyph: GlyphName;
}

/** Three destinations, in the order the athlete needs them. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Today', glyph: 'today' },
  { href: '/plan', label: 'Plan', glyph: 'plan' },
  { href: '/progress', label: 'Progress', glyph: 'progress' },
];

/** True when `pathname` is the screen `href` names. */
export function isActive(href: NavItem['href'], pathname: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname === href;
}
