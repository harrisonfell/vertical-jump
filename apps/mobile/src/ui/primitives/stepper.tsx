import { useEffect, useId, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View, type TextStyle } from 'react-native';
import { ariaState, describedBy, useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { fontFamily, space, type as typeScale, useTheme } from '../theme';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';
import { parseNumeric, stepDisabled, stepValue, type StepBounds } from './stepperMath';

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** 0.1 for a jump attempt, 5 for a barbell load. */
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  /**
   * The engine formatter for this quantity, passed in so notation is never
   * rebuilt here: formatHeightValueIn, formatLoadLb, and so on. When
   * `editable` is set, pass a formatter that returns the bare number and put
   * the unit in `suffix`, so what it prints is what can be typed back.
   */
  readonly format: (value: number) => string;
  /** Unit shown after the value: "in", "lb". */
  readonly suffix?: string;
  readonly disabled?: boolean;
  /** Lets the athlete type the number instead of tapping to it. */
  readonly editable?: boolean;
  /**
   * Shown in ink3 while `format` returns nothing, so an untyped field reads as
   * the shape of the number that goes in it and never as a logged value.
   */
  readonly placeholder?: string;
  readonly helper?: string;
  readonly error?: string;
  /** Enter or the return key runs this, the way the primary button would. */
  readonly onSubmit?: () => void;
  readonly testID?: string;
}

interface StepButtonProps {
  readonly direction: 1 | -1;
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly label: string;
}

function StepButton({ direction, onPress, disabled, label }: StepButtonProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      {...ariaState({ disabled })}
      disabled={disabled}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.ruleStrong,
        backgroundColor: pressed && !disabled ? colors.paper3 : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <FocusRing visible={focusVisible} />
      <Glyph name={direction === 1 ? 'plus' : 'minus'} color={colors.ink} />
    </Pressable>
  );
}

/**
 * Minus, a number, plus. Every value goes through the engine formatter, and
 * every step goes through integer arithmetic, so 0.1 in stays 0.1 in.
 *
 * The editable field keeps its own draft string while it holds focus. A fully
 * controlled formatted value cannot be typed into: "3" reformats to "3.0" under
 * the caret, the next digit lands after the decimal, and "32.5" is unreachable.
 * So the draft is what the athlete typed, `onChange` fires on every reading
 * that parses, and the formatter takes the field back on blur.
 */
export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  format,
  suffix,
  disabled = false,
  editable = false,
  placeholder,
  helper,
  error,
  onSubmit,
  testID,
}: StepperProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const id = useId();
  const bounds: StepBounds = { min, max };
  const message = error ?? helper;
  const invalid = error !== undefined;
  const shown = format(value);
  const spoken = suffix === undefined ? shown : `${shown} ${suffix}`;

  const [draft, setDraft] = useState<string | null>(null);
  const emitted = useRef<number>(value);

  // A value the screen moved underneath takes the field back; a value this
  // field itself just emitted leaves the draft alone, or "32." would reformat
  // to "32.0" under the caret and the next digit would land in the wrong place.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setDraft(null);
  }, [value]);

  const emit = (next: number): void => {
    emitted.current = next;
    onChange(next);
  };

  const move = (direction: 1 | -1) => () => {
    setDraft(null);
    emit(stepValue(value, step, direction, bounds));
  };

  const numberStyle: TextStyle = {
    flex: 1,
    textAlign: 'center',
    color: colors.ink,
    fontFamily: fontFamily.semibold,
    fontSize: typeScale.rowNumber.size,
    fontVariant: ['tabular-nums'],
  };
  if (Platform.OS === 'web') {
    (numberStyle as Record<string, unknown>)['fontVariantNumeric'] = 'tabular-nums';
  }

  // Tone, not a box: an input is the second neutral with a rule under it, the
  // same way a Field is, so the two input families read as one thing.
  const box = {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: space.xs,
    paddingHorizontal: space.sm,
    backgroundColor: colors.paper2,
    opacity: disabled ? 0.45 : 1,
  };

  return (
    <View testID={testID} style={{ gap: space.xs }}>
      <Text variant="label" color="ink2">
        {label}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <StepButton
          direction={-1}
          label={`Decrease ${label}`}
          disabled={disabled || stepDisabled(value, step, -1, bounds)}
          onPress={move(-1)}
        />

        <View style={{ flex: 1 }}>
          <View style={box}>
            <FocusRing visible={editable && focusVisible} />
            {editable ? (
              <TextInput
                value={draft ?? shown}
                editable={!disabled}
                accessibilityLabel={label}
                {...describedBy(invalid, message === undefined ? null : `${id}-message`)}
                keyboardType="decimal-pad"
                inputMode="decimal"
                returnKeyType="done"
                selectionColor={colors.green}
                {...(placeholder === undefined
                  ? null
                  : { placeholder, placeholderTextColor: colors.ink3 })}
                onFocus={focusProps.onFocus}
                onBlur={() => {
                  focusProps.onBlur();
                  setDraft(null);
                }}
                {...(onSubmit === undefined ? null : { onSubmitEditing: onSubmit })}
                onChangeText={(text) => {
                  setDraft(text);
                  const parsed = parseNumeric(text);
                  if (parsed !== null) emit(parsed);
                }}
                style={numberStyle}
              />
            ) : (
              <Text
                variant="rowNumber"
                numeric
                color={shown === '' && placeholder !== undefined ? 'ink3' : 'ink'}
                accessibilityLabel={`${label}, ${spoken}`}
              >
                {shown === '' && placeholder !== undefined ? placeholder : shown}
              </Text>
            )}
            {suffix === undefined ? null : (
              <Text variant="caption" color="ink3">
                {suffix}
              </Text>
            )}
          </View>
          <Hairline strong={invalid} />
        </View>

        <StepButton
          direction={1}
          label={`Increase ${label}`}
          disabled={disabled || stepDisabled(value, step, 1, bounds)}
          onPress={move(1)}
        />
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
