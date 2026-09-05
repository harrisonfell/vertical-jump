/**
 * The glyph registry: pure path data on a 20px grid, drawn at 1.5px stroke in
 * currentColor. No fills except where a mark is a dot or a solid half.
 *
 * Every glyph in this system carries text beside it. None of them is a status
 * on its own, none is a brand mark, and none is decorative. They are quiet on
 * purpose: an athlete reading a row between sets should notice the number.
 *
 * This module holds no imports so the registry can be tested in node.
 */

export const GLYPH_NAMES = [
  // controls
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
  // destinations
  'today',
  'plan',
  'progress',
  // testing and instruments
  'test',
  'pr',
  'instrument-ovr',
  'instrument-vertec',
  'whoop-dot',
  // day types
  'day-strength',
  'day-upper',
  'day-power',
  'day-recovery',
  'day-rest',
  // cell states
  'state-planned',
  'state-done',
  'state-notfinished',
  'state-missed',
  'state-repeat',
  // training categories
  'category-strength',
  'category-plyometrics',
  'category-mobility',
  'category-technique',
  // sync
  'sync',
  'offline',
  'warning-free',
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];

export interface GlyphPath {
  /** SVG path data on the 20 by 20 grid. */
  readonly d: string;
  /** Fill with currentColor instead of stroking. Dots and solid halves only. */
  readonly fill?: boolean;
  /** Stroke dash pattern, for beams and goal lines. */
  readonly dash?: string;
}

/** The grid every glyph is drawn on. */
export const GLYPH_VIEW_BOX = '0 0 20 20';
/** The one stroke weight. */
export const GLYPH_STROKE = 1.5;

const CIRCLE_5 = 'M10 5a5 5 0 1 1 0 10 5 5 0 1 1 0-10';
const CIRCLE_6_5 = 'M10 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 1 1 0-13';

export const GLYPHS: Readonly<Record<GlyphName, readonly GlyphPath[]>> = {
  check: [{ d: 'M4.5 10.5 8.5 14.5 15.5 6' }],
  pencil: [{ d: 'M4 16l1-3.5 8-8 2.5 2.5-8 8z' }, { d: 'M12 5l3 3' }],
  play: [{ d: 'M7 4.5 15.5 10 7 15.5z' }],
  stop: [{ d: 'M5.5 5.5h9v9h-9z' }],
  settings: [
    { d: 'M3 6.5h8' },
    { d: 'M15 6.5h2' },
    { d: 'M3 13.5h2' },
    { d: 'M9 13.5h8' },
    { d: 'M13 4.5a2 2 0 1 1 0 4 2 2 0 1 1 0-4' },
    { d: 'M7 11.5a2 2 0 1 1 0 4 2 2 0 1 1 0-4' },
  ],
  chevron: [{ d: 'M8 5l5 5-5 5' }],
  plus: [{ d: 'M10 4.5v11' }, { d: 'M4.5 10h11' }],
  minus: [{ d: 'M4.5 10h11' }],
  close: [{ d: 'M5.5 5.5l9 9' }, { d: 'M14.5 5.5l-9 9' }],
  flag: [{ d: 'M5.5 3.5v13' }, { d: 'M5.5 4.5h9l-2 3 2 3h-9' }],

  today: [{ d: 'M3 17h14' }, { d: 'M10 14V4' }, { d: 'M6.2 7.8 10 4l3.8 3.8' }],
  plan: [{ d: 'M3 5.5h14' }, { d: 'M3 10h10' }, { d: 'M3 14.5h12' }],
  progress: [
    { d: 'M3 4.5h14', dash: '2 2.5' },
    { d: 'M3 16l4.5-4.5 3.5 2L17 7' },
  ],

  test: [
    { d: 'M3 6h14', dash: '1.5 2' },
    { d: 'M3 14h14', dash: '1.5 2' },
    { d: 'M10 16.5V3.5' },
  ],
  pr: [
    { d: 'M3 8.5h4.5' },
    { d: 'M12.5 8.5H17' },
    { d: 'M10 16.5V3.5' },
    { d: 'M6.8 6.7 10 3.5l3.2 3.2' },
  ],
  'instrument-ovr': [{ d: 'M6 3.5v13' }, { d: 'M14 3.5v13' }, { d: 'M6 16.5h8' }],
  'instrument-vertec': [
    { d: 'M5 3.5v13' },
    { d: 'M5 6h7' },
    { d: 'M5 9h7' },
    { d: 'M5 12h7' },
    { d: 'M5 15h7' },
  ],
  'whoop-dot': [{ d: 'M10 6a4 4 0 1 1 0 8 4 4 0 1 1 0-8', fill: true }],

  'day-strength': [
    { d: 'M3.5 10h13' },
    { d: 'M6 6.5v7' },
    { d: 'M14 6.5v7' },
    { d: 'M3.5 8.5v3' },
    { d: 'M16.5 8.5v3' },
  ],
  'day-upper': [{ d: 'M4 6h12' }, { d: 'M7 6v4.5' }, { d: 'M13 6v4.5' }, { d: 'M10 10.5v6' }],
  'day-power': [{ d: 'M10 16.5V4.5' }, { d: 'M5.5 9 10 4.5l4.5 4.5' }],
  'day-recovery': [{ d: 'M3 11c2.5-3.2 4.5-3.2 7 0s4.5 3.2 7 0' }],
  'day-rest': [{ d: 'M3.5 10h13' }],

  'state-planned': [{ d: CIRCLE_5 }],
  'state-done': [{ d: CIRCLE_6_5 }, { d: 'M6.8 10.2 9 12.4 13.2 7.6' }],
  'state-notfinished': [{ d: CIRCLE_6_5 }, { d: 'M10 3.5a6.5 6.5 0 0 1 0 13z', fill: true }],
  'state-missed': [{ d: CIRCLE_6_5 }, { d: 'M7.5 7.5l5 5' }, { d: 'M12.5 7.5l-5 5' }],
  'state-repeat': [
    { d: 'M4.5 10a5.5 5.5 0 1 1 1.9 4.2' },
    { d: 'M4.5 6.5v3.5h3.5' },
  ],

  'category-strength': [{ d: 'M4 10h12' }, { d: 'M6.5 7v6' }, { d: 'M13.5 7v6' }],
  'category-plyometrics': [{ d: 'M3.5 14.5C6 6.5 14 6.5 16.5 14.5' }, { d: 'M3 16.5h14' }],
  'category-mobility': [{ d: 'M4 10h12' }, { d: 'M4 6.5v7' }, { d: 'M16 6.5v7' }],
  'category-technique': [
    { d: 'M10 6a4 4 0 1 1 0 8 4 4 0 1 1 0-8' },
    { d: 'M10 2.5v2.5' },
    { d: 'M10 15v2.5' },
    { d: 'M2.5 10H5' },
    { d: 'M15 10h2.5' },
  ],

  sync: [
    { d: 'M4 8.5a6 6 0 0 1 10-2.6' },
    { d: 'M14.5 3.5v3h-3' },
    { d: 'M16 11.5a6 6 0 0 1-10 2.6' },
    { d: 'M5.5 16.5v-3h3' },
  ],
  offline: [
    { d: 'M5 11.5a7 7 0 0 1 10 0' },
    { d: 'M8 14.5a3.5 3.5 0 0 1 4 0' },
    { d: 'M4 4.5l12 12' },
  ],
  'warning-free': [
    { d: 'M10 4.5 17 16.5H3z' },
    { d: 'M10 9v3.2' },
    { d: 'M10 14.3v0.4' },
  ],
};

/** Every name in the registry, for gallery and test iteration. */
export function glyphNames(): readonly GlyphName[] {
  return GLYPH_NAMES;
}

/** The paths for a name. Never undefined: the record is exhaustive by type. */
export function glyphPaths(name: GlyphName): readonly GlyphPath[] {
  return GLYPHS[name];
}
