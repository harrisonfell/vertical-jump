import { View, useWindowDimensions } from 'react-native';
import { Text } from '../text';
import { space, useTheme, type ColorToken } from '../theme';
import { Hairline } from './hairline';
import { gutterFor } from './screen';

export interface ResultBlockProps {
  /** "Jump test · Sat 25 Oct". Carries the accent on an ordinary test day. */
  readonly eyebrow: string;
  /** The number alone, already formatted: "32.5". One per screen. */
  readonly value: string;
  /** "in". Sits beside the number, never inside it. */
  readonly unit: string;
  /** "New PR · +1.2 over 27 Sep · goal 36.0 by 29 Nov". */
  readonly line?: string;
  /** "OVR Jump · standing CMJ". Every jump number carries its instrument. */
  readonly instrument: string;
  /**
   * The PR Exception. True only for a same-instrument personal record at or
   * above that instrument's threshold, and for the goal-reached card. Never
   * during the first three calibration sessions on a new instrument.
   */
  readonly committed?: boolean;
  /**
   * Set on a block that should reach the screen edges: the horizontal margin
   * is cancelled by the screen's own gutter, which is 16 on a phone and 24
   * from the tablet up. A fixed 16 left an 8px paper stripe down both sides of
   * the committed green surface at tablet and desktop, which reads as a
   * rendering fault rather than the one loud moment the system has.
   */
  readonly bleed?: number;
  readonly footerLeft?: string;
  readonly footerRight?: string;
  readonly testID?: string;
}

/**
 * A test result. On paper by default, with the header line in green, because
 * twelve test days in twelve weeks cannot all be the loud moment. Once, for a
 * record at or above the threshold, the surface itself goes green. It is
 * static: no confetti, no motion, no share card.
 */
export function ResultBlock({
  eyebrow,
  value,
  unit,
  line,
  instrument,
  committed = false,
  bleed = 0,
  footerLeft,
  footerRight,
  testID,
}: ResultBlockProps) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const inset = bleed <= 0 ? 0 : Math.max(bleed, gutterFor(width));

  const onSurface: ColorToken = committed ? 'onGreen' : 'ink';
  const quiet: ColorToken = committed ? 'onGreen' : 'ink2';

  return (
    <View
      testID={testID}
      accessibilityLabel={`${eyebrow}. ${value} ${unit}. ${line ?? ''} ${instrument}`}
      style={{
        marginHorizontal: -inset,
        paddingHorizontal: inset,
        paddingVertical: space.lg,
        backgroundColor: committed ? colors.green : colors.paper,
        gap: space.sm,
      }}
    >
      <Text variant="label" color={committed ? 'onGreen' : 'green'}>
        {eyebrow}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
        <Text variant="display" color={onSurface}>
          {value}
        </Text>
        <Text variant="title" color={quiet}>
          {unit}
        </Text>
      </View>

      {line === undefined ? null : (
        <Text variant="caption" color={quiet} numeric>
          {line}
        </Text>
      )}

      <Text variant="label" color={quiet}>
        {instrument}
      </Text>

      {footerLeft === undefined && footerRight === undefined ? null : (
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          {committed ? null : <Hairline />}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space.md,
            }}
          >
            {footerLeft === undefined ? null : (
              <Text variant="caption" color={quiet} numeric>
                {footerLeft}
              </Text>
            )}
            {footerRight === undefined ? null : (
              <Text variant="caption" color={quiet} numeric>
                {footerRight}
              </Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
