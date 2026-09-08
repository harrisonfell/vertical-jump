import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ariaState, keyToIndex, rovingTabIndex, selectionState, useFocusVisible } from '../a11y';
import { Glyph, type GlyphName } from '../glyphs';
import { Text } from '../text';
import { opacity, space, useTheme } from '../theme';
import { FocusRing } from './focusRing';

interface KeyEventLike {
  readonly key: string;
  preventDefault: () => void;
}

interface KeyHandlerProps {
  readonly onKeyDown?: (event: KeyEventLike) => void;
}

export interface ChipProps {
  readonly label: string;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly glyph?: GlyphName;
  readonly disabled?: boolean;
  /** Radio inside a single-select group, checkbox when it stands alone. */
  readonly role?: 'radio' | 'checkbox' | 'button';
  readonly accessibilityLabel?: string;
  readonly tabIndex?: 0 | -1;
  readonly onKeyDown?: (event: KeyEventLike) => void;
  readonly innerRef?: (node: View | null) => void;
  readonly testID?: string;
}

/**
 * A selectable rectangle. Selected is a green hairline over a soft green
 * ground with ink text on it: the label still says everything if the colour
 * is lost, and the ground never turns into a status pill.
 */
export function Chip({
  label,
  selected = false,
  onPress,
  glyph,
  disabled = false,
  role = 'radio',
  accessibilityLabel,
  tabIndex,
  onKeyDown,
  innerRef,
  testID,
}: ChipProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  // Both group roles are described by aria-checked; aria-selected is dropped on
  // them, which is how a radio group ends up reporting no state at all.
  const state = selectionState(role, selected, disabled);
  const aria = ariaState(state);
  const keyProps: KeyHandlerProps = onKeyDown === undefined ? {} : { onKeyDown };

  return (
    <Pressable
      ref={innerRef}
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={state}
      {...aria}
      disabled={disabled}
      onPress={onPress}
      onFocus={focusProps.onFocus}
      onBlur={focusProps.onBlur}
      {...(tabIndex === undefined ? null : { tabIndex })}
      {...keyProps}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: space.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        borderWidth: 1,
        borderColor: selected ? colors.green : colors.rule,
        backgroundColor: selected
          ? colors.greenSoft
          : pressed && !disabled
            ? colors.paper3
            : 'transparent',
        opacity: disabled ? opacity.disabled : 1,
      })}
    >
      <FocusRing visible={focusVisible} />
      {glyph === undefined ? null : <Glyph name={glyph} color={colors.ink2} size={16} />}
      <Text variant="body" color="ink">
        {label}
      </Text>
    </Pressable>
  );
}

export interface ChipOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly glyph?: GlyphName;
  readonly disabled?: boolean;
  /** Overrides the chip's own label for a screen reader: "RPE 8". */
  readonly accessibilityLabel?: string;
}

export interface ChipRowProps<T extends string | number> {
  readonly options: readonly ChipOption<T>[];
  readonly value?: T | null;
  readonly onChange: (value: T) => void;
  /**
   * Break onto a second line after this many chips. Soreness uses 6, so the
   * row reads 0 to 5 and 6 to 10 the way the question is asked.
   */
  readonly splitAfter?: number;
  /** Names the group for a screen reader: "Soreness today". */
  readonly groupLabel?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * A wrapping row of chips as a single-select group. Two lines when splitAfter
 * is given, so a 0 to 10 scale never runs a ragged single line.
 *
 * Focus roves, exactly as it does in AnswerGroup: one chip is in the tab order
 * and the arrow keys move between the rest. Without that, the soreness scale
 * costs a keyboard user eleven tab stops to get past a question they may not
 * want to answer, and the arrow keys an ARIA radiogroup promises do nothing.
 */
export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
  splitAfter,
  groupLabel,
  disabled = false,
  testID,
}: ChipRowProps<T>) {
  const nodes = useRef<(View | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex < 0 ? 0 : selectedIndex);
  const active = selectedIndex < 0 ? activeIndex : selectedIndex;

  const handleKey = useCallback(
    (index: number) => (event: KeyEventLike) => {
      const next = keyToIndex(event.key, index, options.length);
      if (next === null || next === index) return;
      event.preventDefault();
      setActiveIndex(next);
      const option = options[next];
      if (option !== undefined && option.disabled !== true && !disabled) onChange(option.value);
      nodes.current[next]?.focus();
    },
    [disabled, onChange, options],
  );

  const lines: (readonly ChipOption<T>[])[] =
    splitAfter === undefined || splitAfter >= options.length
      ? [options]
      : [options.slice(0, splitAfter), options.slice(splitAfter)];

  let cursor = 0;

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
      style={{ gap: space.sm }}
    >
      {lines.map((line, lineIndex) => {
        const offset = cursor;
        cursor += line.length;
        return (
          <View
            key={`line-${lineIndex}`}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
          >
            {line.map((option, withinLine) => {
              const index = offset + withinLine;
              return (
                <Chip
                  key={String(option.value)}
                  label={option.label}
                  {...(option.glyph === undefined ? null : { glyph: option.glyph })}
                  {...(option.accessibilityLabel === undefined
                    ? null
                    : { accessibilityLabel: option.accessibilityLabel })}
                  selected={value === option.value}
                  disabled={disabled || option.disabled === true}
                  tabIndex={rovingTabIndex(index === active)}
                  onKeyDown={handleKey(index)}
                  innerRef={(node) => {
                    nodes.current[index] = node;
                  }}
                  onPress={() => {
                    setActiveIndex(index);
                    onChange(option.value);
                  }}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
