import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { ariaState, useFocusVisible } from '../a11y';
import { Glyph, type GlyphName } from '../glyphs';
import { Text } from '../text';
import { opacity, space, useTheme, type ColorToken } from '../theme';
import { FocusRing } from './focusRing';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
/** Two heights only: the daily minimum and the full-width commitment. */
export type ButtonSize = 44 | 56;

export interface ButtonProps {
  /** Verb plus object. Never OK, Submit, or Yes. */
  readonly label: string;
  readonly onPress?: () => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly disabled?: boolean;
  /** Swaps the label for a static ellipsis. No spinner over content, ever. */
  readonly loading?: boolean;
  readonly glyph?: GlyphName;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
  readonly style?: ViewStyle;
}

interface Skin {
  readonly background: string;
  readonly pressed: string;
  readonly border: string | null;
  readonly text: ColorToken;
}

/**
 * A rectangle with a word in it. Four variants, no radius, no shadow, and no
 * red: a destructive action is ink on a hairline, because the copy is what
 * makes it dangerous, not the colour.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 44,
  fullWidth = false,
  disabled = false,
  loading = false,
  glyph,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  const skins: Readonly<Record<ButtonVariant, Skin>> = {
    primary: {
      background: colors.green,
      pressed: colors.green,
      border: null,
      text: 'onGreen',
    },
    secondary: {
      background: 'transparent',
      pressed: colors.paper3,
      border: colors.ruleStrong,
      text: 'ink',
    },
    quiet: {
      background: 'transparent',
      pressed: colors.paper3,
      border: null,
      text: 'green',
    },
    destructive: {
      background: 'transparent',
      pressed: colors.paper3,
      border: colors.ruleStrong,
      text: 'ink',
    },
  };

  const skin = skins[variant];
  const inert = disabled || loading;
  const shown = loading ? '…' : label;
  const tint = colors[skin.text];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      {...ariaState({ disabled: inert, busy: loading })}
      disabled={inert}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => [
        {
          minHeight: size,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          backgroundColor: pressed && !inert ? skin.pressed : skin.background,
          borderWidth: skin.border === null ? 0 : 1,
          borderColor: skin.border ?? 'transparent',
          opacity: disabled ? opacity.disabled : pressed && variant === 'primary' ? opacity.pressed : 1,
        },
        style,
      ]}
    >
      <FocusRing visible={focusVisible} />
      {glyph === undefined || loading ? null : <Glyph name={glyph} color={tint} size={18} />}
      <Text variant="body" color={skin.text} numberOfLines={1}>
        {shown}
      </Text>
    </Pressable>
  );
}

export interface ButtonRowProps {
  readonly children: ReactNode;
  /** Right-aligns the row, the way a sheet's action row sits. */
  readonly align?: 'start' | 'end' | 'between';
}

/**
 * A row of buttons with the system's gap. Never a toolbar, never a segment.
 *
 * It wraps, with the same 8px gap down as across, because a phone is 390px
 * wide and a fourth 44px button has to go somewhere: a row that cannot wrap
 * clips its last label ("Edit in S…") and the athlete never learns what the
 * control was. Screens should still prefer one primary and one secondary.
 */
export function ButtonRow({ children, align = 'start' }: ButtonRowProps) {
  const justify: ViewStyle['justifyContent'] =
    align === 'end' ? 'flex-end' : align === 'between' ? 'space-between' : 'flex-start';
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space.sm,
        alignItems: 'center',
        justifyContent: justify,
      }}
    >
      {children}
    </View>
  );
}
