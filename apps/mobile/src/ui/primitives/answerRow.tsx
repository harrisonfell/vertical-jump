import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  ariaState,
  keyToIndex,
  rovingTabIndex,
  selectionState,
  useFocusVisible,
} from '../a11y';
import { Glyph } from '../glyphs';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { FocusRing } from './focusRing';
import { Hairline } from './hairline';

interface KeyEventLike {
  readonly key: string;
  preventDefault: () => void;
}

interface KeyHandlerProps {
  readonly onKeyDown?: (event: KeyEventLike) => void;
}

export interface AnswerRowProps {
  readonly label: string;
  /** One muted line under the answer: "12 weeks is the boundary". */
  readonly detail?: string;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly tabIndex?: 0 | -1;
  readonly onKeyDown?: (event: KeyEventLike) => void;
  readonly innerRef?: (node: View | null) => void;
  readonly testID?: string;
}

/**
 * A setup answer: the whole 56px row is the target, the check sits right, and
 * there is no glyph on the left. Setup radios stay plain by law.
 */
export function AnswerRow({
  label,
  detail,
  selected = false,
  onPress,
  disabled = false,
  tabIndex,
  onKeyDown,
  innerRef,
  testID,
}: AnswerRowProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  const keyProps: KeyHandlerProps = onKeyDown === undefined ? {} : { onKeyDown };
  // role="radio" is described by aria-checked; aria-selected is dropped on it.
  const state = selectionState('radio', selected, disabled);

  return (
    <View>
      <Pressable
        ref={innerRef}
        testID={testID}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={state}
        {...ariaState(state)}
        disabled={disabled}
        onPress={onPress}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        {...(tabIndex === undefined ? null : { tabIndex })}
        {...keyProps}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingVertical: space.sm,
          backgroundColor: pressed && !disabled ? colors.paper3 : 'transparent',
          opacity: disabled ? 0.45 : 1,
        })}
      >
        <FocusRing visible={focusVisible} />
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text variant="body" color="ink">
            {label}
          </Text>
          {detail === undefined ? null : (
            <Text variant="caption" color="ink3">
              {detail}
            </Text>
          )}
        </View>
        <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <Glyph name="check" color={colors.green} /> : null}
        </View>
      </Pressable>
      <Hairline />
    </View>
  );
}

export interface AnswerOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
}

export interface AnswerGroupProps<T extends string | number> {
  readonly options: readonly AnswerOption<T>[];
  readonly value?: T | null;
  readonly onChange: (value: T) => void;
  readonly groupLabel?: string;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/**
 * A single-select list with roving focus: one row is in the tab order and the
 * arrow keys move between the rest, which is what a keyboard user expects from
 * a radio group and what setup needs on the web build.
 */
export function AnswerGroup<T extends string | number>({
  options,
  value,
  onChange,
  groupLabel,
  disabled = false,
  testID,
}: AnswerGroupProps<T>) {
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

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={groupLabel}
    >
      {options.map((option, index) => (
        <AnswerRow
          key={String(option.value)}
          label={option.label}
          {...(option.detail === undefined ? null : { detail: option.detail })}
          selected={option.value === value}
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
      ))}
    </View>
  );
}
