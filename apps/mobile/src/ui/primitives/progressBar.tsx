import { useEffect, useRef } from 'react';
import { Animated, Platform, View } from 'react-native';
import { useReducedMotion } from '../a11y';
import { duration, easeOutQuart } from '../motion';
import { Text } from '../text';
import { space, useTheme } from '../theme';

/** A rule, not a bar chart: thick enough to read at arm's length, no more. */
export const PROGRESS_TRACK_HEIGHT = 4;

export interface ProgressBarProps {
  /** 0 to 1. Clamped. */
  readonly value: number;
  /** "Writing week 4 of 12". Computed from the work, never a slogan. */
  readonly line: string;
  /** What the whole bar stands for: "Building your program". */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * A determinate progress bar: one caption in tabular figures over a 4px track
 * that fills with the accent from the left. It exists for work whose step
 * count is known, so the fill is a fact; indeterminate waits use Skeleton.
 *
 * The fill moves by scaling, never by animating width, and each step eases
 * out inside 150 ms. Under reduced motion it jumps.
 */
export function ProgressBar({ value, line, accessibilityLabel, testID }: ProgressBarProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const clamped = clamp01(value);
  const scale = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(clamped);
      return;
    }
    const step = Animated.timing(scale, {
      toValue: clamped,
      duration: duration.fast,
      easing: easeOutQuart,
      useNativeDriver: Platform.OS !== 'web',
    });
    step.start();
    return () => step.stop();
  }, [clamped, reduced, scale]);

  const percent = Math.round(clamped * 100);

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent, text: line }}
      // react-native-web drops `accessibilityValue`, so the ARIA values are
      // set as well: without them the bar announces with no position.
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={line}
      style={{ gap: space.sm }}
    >
      <Text variant="caption" color="ink2" numeric>
        {line}
      </Text>
      <View
        style={{
          height: PROGRESS_TRACK_HEIGHT,
          backgroundColor: colors.paper3,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: colors.green,
            transformOrigin: 'left',
            transform: [{ scaleX: scale }],
          }}
        />
      </View>
    </View>
  );
}
