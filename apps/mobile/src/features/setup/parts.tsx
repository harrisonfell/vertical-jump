import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { FocusRing, Glyph, Hairline, Text, opacity, space, useFocusVisible, useTheme } from '@/ui';

/**
 * The three pieces every setup step is made of: a labelled question, a
 * checkbox row (the kit's AnswerRow is a radio by law), and the step frame
 * that carries "Step 2 of 3".
 */

/**
 * Prose measure for a question: 68ch at the title size, so a screening
 * sentence wraps before it outruns the eye.
 */
const QUESTION_MEASURE = 560;

export interface QuestionProps {
  readonly label: string;
  /** One muted line under the label: the boundary, the reason, the rule. */
  readonly detail?: string;
  readonly children: ReactNode;
}

/**
 * A question is asked in sentence case at the title size. The label style is
 * reserved for eyebrows and units: a screening sentence set in 12px uppercase
 * with tracking is the slowest text in the app to read, and these are the
 * answers the rule book acts on.
 */
export function Question({ label, detail, children }: QuestionProps) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: space.xs }}>
        <Text variant="title" color="ink" style={{ maxWidth: QUESTION_MEASURE }}>
          {label}
        </Text>
        {detail === undefined ? null : (
          <Text variant="caption" color="ink3" style={{ maxWidth: QUESTION_MEASURE }}>
            {detail}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

export interface CheckRowProps {
  readonly label: string;
  readonly detail?: string;
  readonly checked: boolean;
  readonly onToggle: (next: boolean) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

/** A 56px checkbox row. Same measure as AnswerRow, different semantics. */
export function CheckRow({
  label,
  detail,
  checked,
  onToggle,
  disabled = false,
  testID,
}: CheckRowProps) {
  const { colors } = useTheme();
  const { focusVisible, focusProps } = useFocusVisible();

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="checkbox"
        accessibilityLabel={label}
        accessibilityState={{ checked, disabled }}
        // react-native-web drops `accessibilityState`, so the ARIA props are
        // set as well: without them the row announces as an unlabelled
        // checkbox with no state on the web build.
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={() => onToggle(!checked)}
        onFocus={focusProps.onFocus}
        onBlur={focusProps.onBlur}
        style={({ pressed }) => ({
          minHeight: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingVertical: space.sm,
          backgroundColor: pressed && !disabled ? colors.paper3 : 'transparent',
          opacity: disabled ? opacity.disabled : 1,
        })}
      >
        <FocusRing visible={focusVisible} inset={2} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" color="ink">
            {label}
          </Text>
          {detail === undefined ? null : (
            <Text variant="caption" color="ink3">
              {detail}
            </Text>
          )}
        </View>
        <View
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.rule,
            backgroundColor: checked ? colors.greenSoft : 'transparent',
          }}
        >
          {checked ? <Glyph name="check" color={colors.green} /> : null}
        </View>
      </Pressable>
      <Hairline />
    </View>
  );
}

export interface StepFrameProps {
  /** 1, 2 or 3. Gate 0 and Build pass none. */
  readonly step?: number;
  readonly title: string;
  readonly lead?: string;
  readonly children: ReactNode;
}

/** The heading block a setup step opens with. */
export function StepFrame({ step, title, lead, children }: StepFrameProps) {
  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.xs }}>
        {step === undefined ? null : (
          <Text variant="label" color="ink3">
            {`Step ${step} of 3`}
          </Text>
        )}
        <Text variant="headline" color="ink">
          {title}
        </Text>
        {lead === undefined ? null : (
          <Text variant="body" color="ink2" style={{ maxWidth: 560 }}>
            {lead}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
