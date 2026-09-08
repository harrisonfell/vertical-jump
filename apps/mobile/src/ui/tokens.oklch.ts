/**
 * The colour source of truth, written in OKLCH.
 *
 * scripts/gen-tokens.mjs converts this to sRGB hex in tokens.generated.ts and
 * asserts WCAG 2.1 contrast, colour-vision separation, and distance from the
 * accent. Never hand-edit the generated file, and never read these OKLCH
 * strings at runtime: React Native has no OKLCH parser.
 *
 * Light is the default because the primary scene is a bright gym. Dark follows
 * the system setting and is a warm charcoal with no blue in it.
 */

/** Alpha applied to `ink` to make the hairline rule, per scheme. */
export const ruleAlpha = {
  light: 0.16,
  dark: 0.16,
} as const;

/** Alpha applied to `ink` to make the strong rule, per scheme. */
export const ruleStrongAlpha = {
  light: 0.42,
  dark: 0.4,
} as const;

/**
 * Ground, ink, the single accent, and the two state tones, per scheme.
 *
 * Every ink level clears 4.5:1 on all three grounds, `paper3` included: it is
 * the pressed background of half the rows in the app, and a caption that dims
 * below AA the moment a thumb lands on it is a caption that fails in the one
 * scene the app was built for. That constraint is what sets the gap between
 * `ink2` and `ink3`; widening either level closes the hierarchy, so both moved
 * together rather than one being squeezed toward the other.
 *
 * `warn` and `danger` are the two tones the accent cannot carry. Green means
 * "this is the live one"; it cannot also mean "this is not what you think it
 * is". They are the same tonal weight as the accent, tinted the same way, and
 * they never appear without words: a warn line always names what is stale, and
 * a danger line always names the cause and the fix.
 */
export const schemeOklch = {
  light: {
    paper: 'oklch(96.5% 0.006 155)',
    paper2: 'oklch(93.6% 0.009 155)',
    paper3: 'oklch(90.5% 0.01 155)',
    ink: 'oklch(22% 0.01 155)',
    ink2: 'oklch(42% 0.01 155)',
    ink3: 'oklch(49% 0.01 155)',
    green: 'oklch(42% 0.115 155)',
    greenSoft: 'oklch(90% 0.045 155)',
    onGreen: 'oklch(97% 0.012 155)',
    warn: 'oklch(46% 0.105 72)',
    danger: 'oklch(43% 0.155 25)',
  },
  dark: {
    paper: 'oklch(19.5% 0.008 70)',
    paper2: 'oklch(23.5% 0.009 70)',
    paper3: 'oklch(28% 0.01 70)',
    ink: 'oklch(92% 0.01 80)',
    ink2: 'oklch(75% 0.01 80)',
    ink3: 'oklch(66% 0.01 80)',
    green: 'oklch(72% 0.12 155)',
    greenSoft: 'oklch(30% 0.05 155)',
    onGreen: 'oklch(14% 0.02 155)',
    warn: 'oklch(79% 0.11 78)',
    danger: 'oklch(73% 0.13 27)',
  },
} as const;

/**
 * Charts, chips, and glyph fills only. Never chrome, never text, never alone:
 * every use carries a label or a glyph beside it.
 *
 * Fixed categorical order, never cycled: strength, plyometrics, technique,
 * mobility. The recovery bands keep Whoop's own vocabulary and its traffic
 * light, because that is the reading the athlete already has.
 *
 * Two rules shape these values beyond contrast. Each colour sits at least 22
 * CIEDE2000 from the accent green, so a recovery dot can never be read as
 * "selected"; that is what moved `recovery.high` off grass and onto a deeper
 * sea green. And each pair inside a group stays separable under protanopia,
 * deuteranopia, and tritanopia as well as normal vision, which is why the four
 * categories are spread across lightness rather than hue alone: four hues
 * cannot stay four hues once red and green collapse.
 */
export const dataColors = {
  light: {
    'category.strength': 'oklch(58% 0.17 254)',
    'category.plyometrics': 'oklch(64% 0.19 38)',
    'category.technique': 'oklch(42% 0.15 294)',
    'category.mobility': 'oklch(64% 0.09 350)',
    'recovery.low': 'oklch(52% 0.15 28)',
    'recovery.moderate': 'oklch(64% 0.13 80)',
    'recovery.high': 'oklch(58% 0.19 174)',
  },
  dark: {
    'category.strength': 'oklch(58% 0.13 254)',
    'category.plyometrics': 'oklch(64% 0.19 38)',
    'category.technique': 'oklch(76% 0.15 294)',
    'category.mobility': 'oklch(58% 0.11 356)',
    'recovery.low': 'oklch(58% 0.17 28)',
    'recovery.moderate': 'oklch(70% 0.19 80)',
    'recovery.high': 'oklch(54% 0.09 182)',
  },
} as const;

export type SchemeName = keyof typeof schemeOklch;
export type DataTokenName = keyof (typeof dataColors)['light'];
