import { View } from 'react-native';
import { Text } from '../text';
import { space, useTheme } from '../theme';

/** The same 4px track the determinate progress bar uses. One rule, one height. */
export const SEGMENT_HEIGHT = 4;
/** The paper gap between two segments. A surface gap, never a stroke. */
export const SEGMENT_GAP = 2;

export interface SegmentBarProps {
  /** One entry per training day this week, in the week's own order. */
  readonly segments: readonly { readonly key: string; readonly filled: boolean }[];
  /** "3 of 4 sessions done this week". Counted from the plan, never a slogan. */
  readonly line: string;
  /** Names the whole bar for a screen reader. */
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/**
 * The week, as one segment per training day, filled when the day is done.
 *
 * It is the compact week summary: no ring, no percentage, no gauge. The count
 * of segments is the count of training days the program actually schedules, so
 * a four-day week is four segments and reads as four sessions rather than as a
 * fraction the athlete has to convert.
 *
 * The line above it says the same thing in words, which is what keeps the
 * accent from being the only carrier of the fact.
 */
export function SegmentBar({ segments, line, accessibilityLabel, testID }: SegmentBarProps) {
  const { colors } = useTheme();
  const done = segments.filter((segment) => segment.filled).length;

  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: segments.length, now: done, text: line }}
      // react-native-web drops accessibilityValue, so the ARIA pair is set too.
      aria-valuemin={0}
      aria-valuemax={segments.length}
      aria-valuenow={done}
      aria-valuetext={line}
      style={{ gap: space.xs }}
    >
      <Text variant="label" color="ink2" numeric>
        {line}
      </Text>
      <View style={{ flexDirection: 'row', gap: SEGMENT_GAP }}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{
              flex: 1,
              height: SEGMENT_HEIGHT,
              backgroundColor: segment.filled ? colors.green : colors.paper3,
            }}
          />
        ))}
      </View>
    </View>
  );
}
