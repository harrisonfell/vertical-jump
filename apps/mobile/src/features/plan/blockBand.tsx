import { View } from 'react-native';
import { Text, space, useTheme } from '@/ui';
import type { BlockSegment } from './blocks';

/**
 * The block band: one hairline-divided strip across the whole program, with
 * the current week outlined in green.
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
        accessibilityLabel={`Program blocks: ${caption}`}
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
                    backgroundColor: segment.reduced ? colors.paper2 : colors.paper3,
                    ...(current
                      ? { borderWidth: 2, borderColor: colors.green }
                      : null),
                  }}
                />
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
