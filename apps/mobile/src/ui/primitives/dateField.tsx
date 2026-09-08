import { useId, useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { ariaState, describedBy, useFocusVisible } from '../a11y';
import { Glyph } from '../glyphs';
import { Sheet } from '../sheet';
import { Text } from '../text';
import { opacity, space, useTheme } from '../theme';
import { Button } from './button';
import { Field } from './field';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';
import {
  dateFieldText,
  dateToLocalDate,
  localDateToDate,
  pickerStart,
  todayFromClock,
} from './dateFieldModel';

export interface DateFieldProps {
  /** Always visible, above the control. */
  readonly label: string;
  /** `YYYY-MM-DD`, or empty. Kept exactly as it is: this never rewrites it. */
  readonly value: string;
  /** Hands back a `YYYY-MM-DD` day, the same shape the field was given. */
  readonly onChangeText: (value: string) => void;
  /** Neutral guidance, replaced by `error` when one is present. */
  readonly helper?: string;
  /** Names the cause and the fix. The chosen day is never cleared. */
  readonly error?: string;
  /** The earliest day the picker offers. Refusals still live with the caller. */
  readonly minimumDate?: string;
  /** The latest day the picker offers: a set you have done is today or earlier. */
  readonly maximumDate?: string;
  /** Where the picker opens when the field is empty. Defaults to the device's day. */
  readonly defaultDate?: string;
  /** What the control reads with nothing chosen yet. */
  readonly emptyLabel?: string;
  /** Web only: the typed field keeps its shape hint. */
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Runs when the athlete leaves the control, which is where validation lands. */
  readonly onBlur?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/**
 * A day, chosen the way the platform chooses days.
 *
 * On a phone a date is picked, not typed: iOS gets its inline spinner inside
 * one of our own sheets, so the wheels arrive on the surface everything else
 * arrives on and a real action commits them; Android gets the dialog it has
 * always had, because a Material date dialog is what an Android athlete
 * already knows. Either way the value stored is the plain `YYYY-MM-DD` the
 * rest of the app reads, and the control reads back "Sun 29 Nov 2026".
 *
 * On the web there is no such picker worth having, so the field stays the
 * typed one it was, with the same validation and the same refusals. Nothing
 * about the stored value changes between the two, which is the point.
 */
export function DateField({
  label,
  value,
  onChangeText,
  helper,
  error,
  minimumDate,
  maximumDate,
  defaultDate,
  emptyLabel = 'Not set',
  placeholder = 'YYYY-MM-DD',
  disabled = false,
  onBlur,
  style,
  testID,
}: DateFieldProps) {
  const { colors, scheme } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  if (Platform.OS === 'web') {
    return (
      <Field
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={10}
        disabled={disabled}
        {...(helper === undefined ? null : { helper })}
        {...(error === undefined ? null : { error })}
        {...(onBlur === undefined ? null : { onBlur })}
        {...(style === undefined ? null : { style })}
        {...(testID === undefined ? null : { testID })}
      />
    );
  }

  const message = error ?? helper;
  const invalid = error !== undefined;
  const display = dateFieldText(value, emptyLabel);
  const start = pickerStart({
    value: draft ?? value,
    fallback: defaultDate ?? todayFromClock(new Date()),
    ...(minimumDate === undefined ? null : { minimumDate }),
    ...(maximumDate === undefined ? null : { maximumDate }),
  });

  const bounds = {
    ...(minimumDate === undefined ? null : { minimumDate: localDateToDate(minimumDate) }),
    ...(maximumDate === undefined ? null : { maximumDate: localDateToDate(maximumDate) }),
  };

  const close = (): void => {
    setOpen(false);
    setDraft(null);
    onBlur?.();
  };

  const commit = (day: string): void => {
    onChangeText(day);
    setOpen(false);
    setDraft(null);
    onBlur?.();
  };

  // Android's dialog is its own commit: it closes on the athlete's answer and
  // reports whether that answer was a day or a dismissal.
  const onAndroidChange = (event: DateTimePickerEvent, picked?: Date): void => {
    if (event.type === 'set' && picked !== undefined) {
      commit(dateToLocalDate(picked));
      return;
    }
    close();
  };

  return (
    <View style={[{ gap: space.xs }, style]}>
      <Text variant="label" color="ink2" nativeID={`${id}-label`}>
        {label}
      </Text>

      <View>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${display}`}
          accessibilityHint="Opens a date picker"
          accessibilityState={{ disabled }}
          {...ariaState({ disabled })}
          disabled={disabled}
          onPress={() => setOpen(true)}
          onFocus={focusProps.onFocus}
          onBlur={focusProps.onBlur}
          {...describedBy(invalid, message === undefined ? null : `${id}-message`)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: pressed ? colors.paper3 : colors.paper2,
            paddingHorizontal: space.md,
            minHeight: 44,
            opacity: disabled ? opacity.disabled : 1,
          })}
        >
          <FocusRing visible={focusVisible} />
          <Text
            variant="body"
            color={value.trim() === '' ? 'ink3' : 'ink'}
            numeric
            style={{ flex: 1 }}
          >
            {display}
          </Text>
          <Glyph name="chevron" color={colors.ink3} size={16} />
        </Pressable>
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

      {Platform.OS === 'android' && open ? (
        <DateTimePicker
          value={localDateToDate(start)}
          mode="date"
          display="default"
          onChange={onAndroidChange}
          {...bounds}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Sheet
          visible={open}
          onClose={close}
          title={label}
          closeLabel="Cancel"
          testID={testID === undefined ? undefined : `${testID}-sheet`}
          actions={
            <Button
              label="Use this date"
              variant="primary"
              fullWidth
              onPress={() => commit(start)}
              testID={testID === undefined ? undefined : `${testID}-done`}
            />
          }
        >
          <View style={{ alignItems: 'center' }}>
            <DateTimePicker
              value={localDateToDate(start)}
              mode="date"
              display="spinner"
              themeVariant={scheme}
              onChange={(_event, picked) => {
                if (picked !== undefined) setDraft(dateToLocalDate(picked));
              }}
              {...bounds}
            />
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}
