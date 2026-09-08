import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from '../a11y';
import { EASE_OUT_QUART, duration } from '../motion';
import { Text } from '../text';
import { space, useTheme, type ColorToken } from '../theme';
import { DisplayReadout } from './displayReadout';
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
 * record at or above the threshold and once per goal for the goal-reached
 * card, the surface itself goes green.
 *
 * The committed surface is a composed page rather than a coloured box, and the
 * composition is the whole of the effect: three bands separated by rules the
 * surface can carry, a full stop of silence above and below the number, and
 * every supporting fact set small and exact so that nothing on the page
 * competes with the reading. There is no ornament on it at all. No confetti,
 * no badge, no share card, no second colour: what makes it loud is that it is
 * the only surface in the app allowed this much air and this much green.
 *
 * The paper mode is the daily one and keeps the daily rhythm, at 16 px of
 * padding and an 8 px stack. Only the readout's optical hang is shared.
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

  const quiet: ColorToken = committed ? 'onGreen' : 'ink2';
  const arrival = useArrival(committed);

  const label = `${eyebrow}. ${value} ${unit}. ${line ?? ''} ${instrument}`;
  const frame = {
    marginHorizontal: -inset,
    paddingHorizontal: inset,
    backgroundColor: committed ? colors.green : colors.paper,
  } as const;

  if (!committed) {
    return (
      <View
        testID={testID}
        accessibilityLabel={label}
        style={{ ...frame, paddingVertical: space.lg, gap: space.sm }}
      >
        <Text variant="label" color="green">
          {eyebrow}
        </Text>
        <DisplayReadout value={value} unit={unit} color="ink" unitColor="ink2" />
        {line === undefined ? null : (
          <Text variant="caption" color={quiet} numeric>
            {line}
          </Text>
        )}
        <Text variant="label" color={quiet}>
          {instrument}
        </Text>
        <Footer left={footerLeft} right={footerRight} tone={quiet} rule />
      </View>
    );
  }

  return (
    <Animated.View
      testID={testID}
      accessibilityLabel={label}
      style={{
        ...frame,
        paddingTop: space.xl,
        paddingBottom: space.xl,
        opacity: arrival.opacity,
        transform: [{ translateY: arrival.translateY }],
      }}
    >
      {/* Band one: what happened, and a rule the green surface can carry. */}
      <Text variant="label" color="onGreen">
        {eyebrow}
      </Text>
      <View style={{ paddingTop: space.sm }}>
        <Hairline tone="onGreen" />
      </View>

      {/* Band two: the reading, alone, with a full stop of silence over it. */}
      <View style={{ paddingTop: space.xxl, paddingBottom: space.md }}>
        <DisplayReadout value={value} unit={unit} color="onGreen" unitColor="onGreen" />
      </View>
      {line === undefined ? null : (
        <Text variant="caption" color="onGreen" numeric>
          {line}
        </Text>
      )}

      {/* Band three: the instrument this number belongs to, and the two facts
          that qualify it. Small, exact, and never competing with the reading. */}
      <View style={{ paddingTop: space.xxl, gap: space.sm }}>
        <Hairline tone="onGreen" />
        <Text variant="label" color="onGreen">
          {instrument}
        </Text>
        <Footer left={footerLeft} right={footerRight} tone="onGreen" />
      </View>
    </Animated.View>
  );
}

interface FooterProps {
  readonly left?: string;
  readonly right?: string;
  readonly tone: ColorToken;
  /** The paper block rules its footer off; the committed one is already ruled. */
  readonly rule?: boolean;
}

/** The two qualifying facts, set on the block's own left and right edges. */
function Footer({ left, right, tone, rule = false }: FooterProps) {
  if (left === undefined && right === undefined) return null;
  return (
    <View style={{ gap: space.sm, paddingTop: rule ? space.sm : 0 }}>
      {rule ? <Hairline /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        {left === undefined ? null : (
          <Text variant="caption" color={tone} numeric>
            {left}
          </Text>
        )}
        {right === undefined ? null : (
          <Text variant="caption" color={tone} numeric>
            {right}
          </Text>
        )}
      </View>
    </View>
  );
}

interface Arrival {
  readonly opacity: Animated.Value;
  readonly translateY: Animated.Value;
}

/**
 * The one transition the system has: the committed surface arriving.
 *
 * It fades in and settles 6 px, once, over 320 ms of ease-out, and it conveys
 * a state rather than celebrating one: this surface was not on the screen a
 * moment ago because the record was not on file a moment ago. Under reduced
 * motion the surface is simply there, at rest, which is the same page.
 */
function useArrival(active: boolean): Arrival {
  const reduced = useReducedMotion();
  const settled = active && !reduced ? 0 : 1;
  const opacity = useRef(new Animated.Value(settled)).current;
  const translateY = useRef(new Animated.Value(settled === 1 ? 0 : 6)).current;

  useEffect(() => {
    if (!active || reduced) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    const easing = Easing.bezier(...EASE_OUT_QUART);
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: duration.arrive,
        easing,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: duration.arrive,
        easing,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [active, reduced, opacity, translateY]);

  return { opacity, translateY };
}
