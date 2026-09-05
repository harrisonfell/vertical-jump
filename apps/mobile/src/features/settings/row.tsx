import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { FocusRing, Glyph, Hairline, Text, space, useFocusVisible, useTheme } from '@/ui';
import { ariaState } from '@/ui/a11y';

/**
 * The two shapes every Settings list is built from.
 *
 * A settings screen is a long list of facts, so the row is deliberately plain:
 * a label, the value in the same weight, an optional caption under it, and a
 * chevron only when the row goes somewhere. No cards, no tone fills, one
 * hairline between rows. Interactive rows are 56px tall so the whole row is a
 * comfortable target even though Settings is off the daily path.
 */

export interface SettingRowProps {
  readonly label: string;
  /** The current answer, right-aligned. Tabular where it is a number. */
  readonly value?: string;
  /** "Changes your program", or a source line. */
  readonly caption?: string;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  /** A chevron marks a row that opens something. */
  readonly chevron?: boolean;
  readonly numeric?: boolean;
  /** Rendered under the caption: chips, a field, a nested list. */
  readonly children?: ReactNode;
  readonly testID?: string;
}

export function SettingRow({
  label,
  value,
  caption,
  onPress,
  disabled = false,
  chevron = false,
  numeric = false,
  children,
  testID,
}: SettingRowProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  const body = (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 24 }}>
        <Text variant="body" style={{ flex: 1 }} color={disabled ? 'ink3' : 'ink'}>
          {label}
        </Text>
        {value === undefined ? null : (
          <Text variant="body" color="ink2" numeric={numeric}>
            {value}
          </Text>
        )}
        {chevron ? <Glyph name="chevron" size={16} color={colors.ink3} /> : null}
      </View>
      {caption === undefined ? null : (
        <Text variant="caption" color="ink3">
          {caption}
        </Text>
      )}
      {children}
    </View>
  );

  if (onPress === undefined) {
    return (
      <View testID={testID} style={{ paddingVertical: space.md, minHeight: 56, justifyContent: 'center' }}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value === undefined ? label : `${label}, ${value}`}
      accessibilityState={{ disabled }}
      {...ariaState({ disabled })}
      disabled={disabled}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      testID={testID}
      style={({ pressed }) => ({
        paddingVertical: space.md,
        minHeight: 56,
        justifyContent: 'center',
        backgroundColor: pressed ? colors.paper3 : 'transparent',
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <FocusRing visible={focusVisible} />
      {body}
    </Pressable>
  );
}

export interface SettingSectionProps {
  readonly title: string;
  /** One sentence under the heading, when the section needs framing. */
  readonly note?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}

/** A headed group of rows, hairline-separated. */
export function SettingSection({ title, note, children, testID }: SettingSectionProps) {
  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <Text variant="label" color="ink3">
        {title}
      </Text>
      {note === undefined ? null : (
        <Text variant="caption" color="ink2">
          {note}
        </Text>
      )}
      <Hairline />
      <View>{children}</View>
    </View>
  );
}

/** A hairline between rows inside a section. */
export function RowDivider() {
  return <Hairline />;
}
