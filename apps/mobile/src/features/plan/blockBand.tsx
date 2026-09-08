import { View } from 'react-native';
import { Text, space, useTheme } from '@/ui';
import type { BlockSegment } from './blocks';

/**
 * The block band: one hairline-divided strip across the whole program, with
 * the current week marked in green.
 *
 * The mark is a 2px green bar along the bottom of the week, which is the same
 * mark the week strip puts under today. "Where you are" is one idea, so it gets
 * one shape in both places rather than a bar here and an outline there. The
 * caption names the week as well, because a green bar nobody can read is not a
 * position.
 *
 * Load weeks sit a tone darker than reduced ones, so the shape of the program
 * reads before any word does: four heavy weeks, one light, five heavy, two
 * light. The legend under it names every segment and its weeks, so nothing
 * depends on reading a width or a tone.
 */

export interface BlockBandProps {
  readonly segments: readonly BlockSegment[];
  /** 1-based week today sits in, or null when today is outside the program. */
  readonly currentWeek: number | null;
  readonly testID?: string;
}

const BAND_HEIGHT = 24;
const SWATCH = 10;

export function BlockBand({ segments, currentWeek, testID }: BlockBandProps) {
  const { colors } = useTheme();
  if (segments.length === 0) return null;

  const caption = segments.map((segment) => segment.span).join(' · ');

  return (
    <View testID={testID} style={{ gap: space.sm }}>
      <View
        accessibilityRole="image"
        accessibilityLabel={
          currentWeek === null
            ? `Program blocks: ${caption}`
            : `Program blocks: ${caption}. Today is in week ${currentWeek}.`
        }
        style={{ flexDirection: 'row', height: BAND_HEIGHT }}
      >
        {segments.map((segment, index) => (
          <View
            key={segment.key}
            style={{ flex: segment.weeks, flexDirection: 'row' }}
          >
            {index === 0 ? null : <View style={{ width: 1, backgroundColor: colors.rule }} />}
            {Array.from({ length: segment.weeks }, (_unused, offset) => {
              const w = segment.weekFrom + offset;
              const current = w === currentWeek;
              return (
                <View
                  key={w}
                  style={{
                    flex: 1,
                    justifyContent: 'flex-end',
                    backgroundColor: segment.reduced ? colors.paper2 : colors.paper3,
                  }}
                >
                  {current ? (
                    <View style={{ height: 2, backgroundColor: colors.green }} />
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
          >
            <View
              style={{
                width: SWATCH,
                height: SWATCH,
                backgroundColor: segment.reduced ? colors.paper2 : colors.paper3,
              }}
            />
            <Text variant="caption" color="ink2" numeric>
              {segment.span}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
