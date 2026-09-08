import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, type SchemeColors, type SchemeName } from './tokens.generated';

/**
 * The 4pt spacing scale. Nothing outside this set.
 *
 * `xxs` is the one half step, and it exists because the label-over-value stack
 * (a set row, the header, the rest bar, every nav item) needs the two lines to
 * read as one object rather than as two. It was already in the kit as a bare
 * `2` in fourteen places, drifting to `6` in the skeleton that has to match a
 * set row exactly; naming it is what stops that.
 */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Corner radius. Flat by law: hierarchy comes from type, tone, and hairlines,
 * so the only radius the system owns is none. Sheets set their own.
 */
export const radius = {
  none: 0,
} as const;

/**
 * The three opacities the system uses as state, named so no component invents
 * a fourth. Colour cannot carry these: a disabled control that changed hue
 * would be claiming a meaning, and the meaning here is "not available", which
 * is the absence of one.
 *
 * `disabled` is deliberately deep enough that a control reads as out of play
 * at arm's length; the label beside it always says why, so the dimming is
 * never the only signal. `dim` is the softer step for a row that happened but
 * was not logged, which is history rather than a control.
 */
export const opacity = {
  disabled: 0.45,
  /** A primary action under the thumb: pressed, not off. */
  pressed: 0.86,
  /** A set that was prescribed and never logged. Past tense, not disabled. */
  dim: 0.7,
} as const;

/** Font families, one per generated static instance. */
export const fontFamily = {
  regular: 'Archivo-Regular',
  medium: 'Archivo-Medium',
  semibold: 'Archivo-SemiBold',
  bold: 'Archivo-Bold',
  display: 'ArchivoDisplay',
} as const;

/** Layout breakpoints. Structure changes here, type size does not. */
export const breakpoint = {
  tablet: 768,
  desktop: 1024,
} as const;

/** Fixed px type scale. No fluid sizing: the athlete reads at one DPI. */
export const type = {
  label: { size: 12, lineHeight: 16, family: fontFamily.medium, letterSpacing: 0.72 },
  caption: { size: 13, lineHeight: 16, family: fontFamily.regular, letterSpacing: 0 },
  // One value standing out inside a run of muted caption text: the Whoop
  // strip's numbers, a field's error line. Named here so no component
  // hand-picks a family and invents a face the scale does not have.
  captionStrong: { size: 13, lineHeight: 16, family: fontFamily.semibold, letterSpacing: 0 },
  body: { size: 16, lineHeight: 24, family: fontFamily.regular, letterSpacing: 0 },
  rowNumber: { size: 20, lineHeight: 24, family: fontFamily.semibold, letterSpacing: 0 },
  title: { size: 19, lineHeight: 24, family: fontFamily.medium, letterSpacing: 0 },
  headline: { size: 24, lineHeight: 28, family: fontFamily.semibold, letterSpacing: 0 },
  // The two readout sizes are tracked tighter than the rest of the scale, at
  // -0.024em rather than -0.02em: at 64 and 96 px the default fit leaves the
  // digits reading as four separate objects, and a readout has to read as one.
  // Tabular figures take negative tracking uniformly, so the columns hold.
  display: { size: 64, lineHeight: 64, family: fontFamily.display, letterSpacing: -1.54 },
  displayWide: { size: 96, lineHeight: 96, family: fontFamily.display, letterSpacing: -2.3 },
} as const;

/**
 * The left sidebearing of a digit on the display instance, measured off the
 * shipped face rather than guessed: 3 px of white at 96 and 2 px at 64. A
 * readout set flush to a column is therefore inset by that much and reads as
 * indented; every display number in the app hangs it back out again so the
 * first stem, not the glyph box, lands on the column.
 */
export const displayOptical = { display: 2, displayWide: 3 } as const;

export type TypeVariant = keyof typeof type;
export type ColorToken = keyof Omit<SchemeColors, 'data'>;

export interface Theme {
  readonly scheme: SchemeName;
  readonly colors: SchemeColors;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly type: typeof type;
}

/**
 * Resolves the active scheme. `override` is the persisted preference read from
 * the kv table once the data layer exists; undefined means follow the system.
 */
export function useScheme(override?: SchemeName): SchemeName {
  const system = useColorScheme();
  if (override !== undefined) return override;
  return system === 'dark' ? 'dark' : 'light';
}

const lightTheme: Theme = { scheme: 'light', colors: colors.light, space, radius, type };
const ThemeContext = createContext<Theme>(lightTheme);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Persisted scheme preference. Omit to follow the system setting. */
  readonly override?: SchemeName;
}

export function ThemeProvider({ children, override }: ThemeProviderProps) {
  const scheme = useScheme(override);
  const value = useMemo<Theme>(
    () => ({ scheme, colors: colors[scheme], space, radius, type }),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
