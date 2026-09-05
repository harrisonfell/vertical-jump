import {
  Platform,
  Text as RNText,
  useWindowDimensions,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { breakpoint, useTheme, type ColorToken, type TypeVariant } from './theme';

/** Variants that can carry digits, so they always get tabular figures. */
const NUMERIC_VARIANTS: ReadonlySet<TypeVariant> = new Set<TypeVariant>([
  'label',
  'caption',
  'captionStrong',
  'body',
  'rowNumber',
  'title',
  'headline',
  'display',
  'displayWide',
]);

/** The variants a screen may ask for. `displayWide` is chosen automatically. */
export type TextVariant = Exclude<TypeVariant, 'displayWide'>;

export interface TextProps extends Omit<RNTextProps, 'style'> {
  readonly variant?: TextVariant;
  /** A token name, not a hex value. Defaults to `ink`. */
  readonly color?: ColorToken;
  /** Force tabular figures on a variant that would not otherwise get them. */
  readonly numeric?: boolean;
  readonly align?: TextStyle['textAlign'];
  readonly style?: TextStyle | readonly TextStyle[];
}

/**
 * Every string on screen goes through here. The variant picks the family, so
 * fontWeight never selects a face: the static instances each register as their
 * own family and weight synthesis would ruin the figures.
 */
export function Text({
  variant = 'body',
  color = 'ink',
  numeric,
  align,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const resolved: TypeVariant =
    variant === 'display' && width >= breakpoint.desktop ? 'displayWide' : variant;
  const spec = theme.type[resolved];
  const tabular = numeric ?? NUMERIC_VARIANTS.has(resolved);

  const base: TextStyle = {
    fontFamily: spec.family,
    fontSize: spec.size,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
    color: theme.colors[color],
  };

  if (variant === 'label') {
    base.textTransform = 'uppercase';
  }
  if (align !== undefined) {
    base.textAlign = align;
  }
  if (tabular) {
    base.fontVariant = ['tabular-nums'];
    if (Platform.OS === 'web') {
      // react-native-web maps fontVariant onto the font-variant shorthand.
      // Set the longhand as well so a later shorthand cannot reset it.
      (base as Record<string, unknown>)['fontVariantNumeric'] = 'tabular-nums';
    }
  }

  return <RNText {...rest} style={[base, style]} />;
}
