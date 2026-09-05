/**
 * The colour source of truth, written in OKLCH.
 *
 * scripts/gen-tokens.mjs converts this to sRGB hex in tokens.generated.ts and
 * asserts WCAG 2.1 contrast. Never hand-edit the generated file, and never read
 * these OKLCH strings at runtime: React Native has no OKLCH parser.
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

/** Ground, ink, and the single accent, per scheme. */
export const schemeOklch = {
  light: {
    paper: 'oklch(96.5% 0.006 155)',
    paper2: 'oklch(93.6% 0.009 155)',
    paper3: 'oklch(90.5% 0.011 155)',
    ink: 'oklch(22% 0.014 155)',
    ink2: 'oklch(45% 0.016 155)',
    ink3: 'oklch(52% 0.014 155)',
    green: 'oklch(42% 0.115 155)',
    greenSoft: 'oklch(90% 0.045 155)',
    onGreen: 'oklch(97% 0.012 155)',
  },
  dark: {
    paper: 'oklch(19.5% 0.008 70)',
    paper2: 'oklch(23.5% 0.009 70)',
    paper3: 'oklch(28% 0.01 70)',
    ink: 'oklch(92% 0.012 80)',
    ink2: 'oklch(72% 0.012 80)',
    ink3: 'oklch(63% 0.011 80)',
    green: 'oklch(72% 0.12 155)',
    greenSoft: 'oklch(30% 0.05 155)',
    onGreen: 'oklch(14% 0.02 155)',
  },
} as const;

/**
 * Charts, chips, and glyph fills only. Never chrome, never text, never alone:
 * every use carries a text label or a glyph beside it.
 *
 * These are sRGB hex on purpose. The four category colours were validated with
 * the dataviz palette validator (lightness band, chroma floor, CVD separation,
 * normal-vision floor, contrast) in both schemes on the real paper surfaces.
 * Fixed categorical order, never cycled: strength, plyometrics, technique,
 * mobility. The recovery bands are a status palette in Whoop's own vocabulary
 * (Low, Moderate, High); they are fills beside an ink label, never text and
 * never the only signal, so recovery.moderate may sit under 3:1 on light paper.
 */
export const dataColors = {
  light: {
    'category.strength': '#2a78d6',
    'category.plyometrics': '#d9662e',
    'category.technique': '#4a3aa7',
    'category.mobility': '#d4638f',
    'recovery.low': '#c9302d',
    'recovery.moderate': '#cf9c00',
    'recovery.high': '#009342',
  },
  dark: {
    'category.strength': '#3987e5',
    'category.plyometrics': '#d95926',
    'category.technique': '#9085e9',
    'category.mobility': '#d55181',
    'recovery.low': '#e0574c',
    'recovery.moderate': '#c98500',
    'recovery.high': '#27a05b',
  },
} as const;

export type SchemeName = keyof typeof schemeOklch;
export type DataTokenName = keyof (typeof dataColors)['light'];
