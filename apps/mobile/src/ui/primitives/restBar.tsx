import { formatRest } from '@vert/engine/units';
import { useContext, useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../text';
import { space, useTheme } from '../theme';
import { Button } from './button';
import { Hairline } from './hairline';
import { gutterFor, ScreenMeasureContext } from './screen';

export interface RestBarProps {
  /** Seconds left. The bar renders the number, never a ring or a bar chart. */
  readonly remainingS: number;
  /** "next: set 3 · 3 × 235 lb (+15 lb)", built by the screen from the engine. */
  readonly nextLine?: string;
  readonly onStop: () => void;
  /** Adds the bottom safe-area inset. Off when the tab bar is under it. */
  readonly safeArea?: boolean;
  readonly testID?: string;
}

/** Off-screen but read aloud: the two moments a rest is worth announcing. */
const HIDDEN = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  overflow: 'hidden' as const,
  opacity: 0,
};

/**
 * The rest timer, sticky above the nav. One number and the next set's load, so
 * the bar is loaded before the rest ends. The text updates once a second and
 * nothing moves, which is also what reduced motion asks for.
 *
 * The number is a `timer`, not a live region. A polite live region on a node
 * that changes every second is ~180 queued announcements per rest, which
 * drowns out the rest of the screen; the two transitions that matter get their
 * own off-screen node instead.
 */
export function RestBar({
  remainingS,
  nextLine,
  onStop,
  safeArea = false,
  testID,
}: RestBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const measure = useContext(ScreenMeasureContext);

  const [announcement, setAnnouncement] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      setAnnouncement(`Rest started, ${formatRest(remainingS)}`);
      return;
    }
    if (remainingS <= 0) setAnnouncement('Rest is up');
  }, [remainingS]);

  return (
    <View testID={testID} style={{ backgroundColor: colors.paper2 }}>
      <Hairline />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          ...(measure === undefined ? {} : { width: '100%', maxWidth: measure, alignSelf: 'center' } as const),
          paddingHorizontal: measure === undefined ? space.lg : gutterFor(width),
          paddingVertical: space.sm,
          paddingBottom: safeArea ? Math.max(insets.bottom, space.sm) : space.sm,
          minHeight: 56,
        }}
      >
        <View style={{ flex: 1, gap: space.xxs }}>
          <Text
            variant="rowNumber"
            color="ink"
            accessibilityRole="timer"
            aria-live="off"
            numeric
          >
            {`Rest ${formatRest(remainingS)}`}
          </Text>
          {/* The load is the half of this bar the athlete acts on, and it is
              read at arm's length with a wet phone: it takes the one stronger
              face the caption size has rather than a larger size, which would
              put two numbers on the bar competing to be the big one. */}
          {nextLine === undefined ? null : (
            <Text variant="captionStrong" color="ink2" numeric numberOfLines={1}>
              {nextLine}
            </Text>
          )}
        </View>

        <Button label="Skip rest" variant="secondary" onPress={onStop} />
      </View>

      <View style={HIDDEN}>
        <Text variant="caption" accessibilityLiveRegion="polite" aria-live="polite">
          {announcement}
        </Text>
      </View>
    </View>
  );
}

export interface FooterLineProps {
  /** "Sets 2 of 22 · contacts 0 of 6". */
  readonly left: string;
  /** "Test Sat · in 5 days". */
  readonly right?: string;
  readonly testID?: string;
}

/** The two captions that close a session screen. */
export function FooterLine({ left, right, testID }: FooterLineProps) {
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: space.md,
        paddingTop: space.md,
      }}
    >
      <Text variant="caption" color="ink2" numeric>
        {left}
      </Text>
      {right === undefined ? null : (
        <Text variant="caption" color="ink2" numeric>
          {right}
        </Text>
      )}
    </View>
  );
}
