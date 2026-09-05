import { useId } from 'react';
import { Platform, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { describedBy, useFocusVisible } from '../a11y';
import { Text } from '../text';
import { fontFamily, space, type as typeScale, useTheme } from '../theme';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';

export interface FieldProps {
  /** Always visible, above the input. A placeholder is not a label. */
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  /** Neutral guidance, replaced by `error` when one is present. */
  readonly helper?: string;
  /** Names the cause and the fix. The typed value is never cleared. */
  readonly error?: string;
  /** Decimal keypad, tabular figures, right-aligned digits. */
  readonly numeric?: boolean;
  /** A unit rendered inside the field, after the value: "in", "lb". */
  readonly suffix?: string;
  readonly placeholder?: string;
  /** A passphrase: masked, and offered to the platform's password manager. */
  readonly secure?: boolean;
  readonly disabled?: boolean;
  /** Enter or the return key runs this, the way the primary button would. */
  readonly onSubmit?: () => void;
  readonly onBlur?: () => void;
  readonly autoFocus?: boolean;
  readonly maxLength?: number;
  readonly multiline?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * Label above, input on the second neutral with a hairline, helper or error
 * below in a live region. Validation lands on blur, never on every keystroke.
 *
 * An error is carried by weight and by the rule, never by a colour or an icon:
 * the message steps up to the SemiBold face in ink and the field's rule steps
 * up to `ruleStrong`, so the state survives both schemes and colour blindness,
 * and the wording still does the explaining. The input itself is a tone change
 * with one rule under it, never a box: the system separates with tone and
 * hairlines, and a boxed input would be the only outlined object on a screen.
 */
export function Field({
  label,
  value,
  onChangeText,
  helper,
  error,
  numeric = false,
  suffix,
  placeholder,
  secure = false,
  disabled = false,
  onSubmit,
  onBlur,
  autoFocus = false,
  maxLength,
  multiline = false,
  style,
  testID,
}: FieldProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const id = useId();

  const message = error ?? helper;
  const invalid = error !== undefined;

  const inputStyle: TextStyle = {
    flex: 1,
    paddingVertical: space.sm,
    color: colors.ink,
    fontFamily: numeric ? fontFamily.medium : fontFamily.regular,
    fontSize: typeScale.body.size,
    textAlignVertical: multiline ? 'top' : 'center',
  };
  if (multiline) inputStyle.lineHeight = typeScale.body.lineHeight;
  if (numeric) {
    inputStyle.fontVariant = ['tabular-nums'];
    if (Platform.OS === 'web') {
      (inputStyle as Record<string, unknown>)['fontVariantNumeric'] = 'tabular-nums';
    }
  }

  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text variant="label" color="ink2" nativeID={`${id}-label`}>
        {label}
      </Text>

      <View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.paper2,
            paddingHorizontal: space.md,
            minHeight: multiline ? 88 : 44,
            opacity: disabled ? 0.45 : 1,
          }}
        >
          <FocusRing visible={focusVisible} />
          <TextInput
            testID={testID}
            value={value}
            onChangeText={onChangeText}
            editable={!disabled}
            autoFocus={autoFocus}
            multiline={multiline}
            placeholder={placeholder}
            placeholderTextColor={colors.ink3}
            selectionColor={colors.green}
            accessibilityLabel={label}
            {...describedBy(invalid, message === undefined ? null : `${id}-message`)}
            {...(maxLength === undefined ? null : { maxLength })}
            {...(numeric
              ? { keyboardType: 'decimal-pad' as const, inputMode: 'decimal' as const }
              : null)}
            {...(secure
              ? {
                  secureTextEntry: true,
                  textContentType: 'password' as const,
                  autoComplete: 'current-password' as const,
                  autoCapitalize: 'none' as const,
                  autoCorrect: false,
                }
              : null)}
            {...(multiline || onSubmit === undefined
              ? null
              : { onSubmitEditing: onSubmit, returnKeyType: 'done' as const })}
            onFocus={focusProps.onFocus}
            onBlur={() => {
              focusProps.onBlur();
              onBlur?.();
            }}
            style={inputStyle}
          />
          {suffix === undefined ? null : (
            <Text variant="caption" color="ink3">
              {suffix}
            </Text>
          )}
        </View>
        <Hairline strong={invalid} />
      </View>

      {message === undefined ? null : (
        <Text
          nativeID={`${id}-message`}
          variant={invalid ? 'captionStrong' : 'caption'}
          color={invalid ? 'ink' : 'ink3'}
          accessibilityLiveRegion="polite"
          role={invalid ? 'alert' : undefined}
        >
          {message}
        </Text>
      )}
    </View>
  );
}
