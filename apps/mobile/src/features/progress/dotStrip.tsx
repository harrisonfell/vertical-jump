import { View } from 'react-native';
import { Circle, Line, Svg } from 'react-native-svg';
import { Text, space, useTheme } from '@/ui';
import type { RecoveryDotBand } from './types';

const STRIP_HEIGHT = 28;
const DOT_RADIUS = 3;
const RPE_MIN = 5;
const RPE_MAX = 10;

/** A stable vertical offset per dot: the same data always draws the same way. */
function jitter(index: number, height: number): number {
  const wave = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const fraction = wave - Math.floor(wave);
  const usable = height - DOT_RADIUS * 4;
  return DOT_RADIUS * 2 + fraction * usable;
}

export interface DotStripsProps {
  readonly bands: readonly RecoveryDotBand[];
  readonly width: number;
}

/**
 * Session RPE inside each recovery band, one dot a session.
 *
 * Dots overlap at whole RPE values, so they are jittered vertically: the
 * strip's job is to show how many sessions sat where, which a stack of
 * identical marks hides. The colour is Whoop's own band palette and always
 * rides beside the band word, never in place of it, and the table under it
 * carries the same numbers for anyone who cannot read a dot cloud.
 */
export function DotStrips({ bands, width }: DotStripsProps) {
  const { colors } = useTheme();
  const plotWidth = Math.max(80, width - 88);

  return (
    <View style={{ gap: space.xs }} testID="recovery-dot-strips">
      {bands.map((band) => (
        <View key={band.band} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text variant="caption" color="ink2" style={{ width: 72 }}>
            {band.label}
          </Text>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              band.values.length === 0
                ? `${band.label} recovery: no sessions with an RPE`
                : `${band.label} recovery: ${band.values.length} sessions, RPE ${Math.min(...band.values)} to ${Math.max(...band.values)}`
            }
          >
            <Svg width={plotWidth} height={STRIP_HEIGHT}>
              <Line
                x1={0}
                y1={STRIP_HEIGHT - 0.5}
                x2={plotWidth}
                y2={STRIP_HEIGHT - 0.5}
                stroke={colors.rule}
                strokeWidth={1}
              />
              {band.values.map((rpe, index) => {
                const clamped = Math.min(RPE_MAX, Math.max(RPE_MIN, rpe));
                const x =
                  DOT_RADIUS +
                  ((clamped - RPE_MIN) / (RPE_MAX - RPE_MIN)) * (plotWidth - DOT_RADIUS * 2);
                return (
                  <Circle
                    key={`${band.band}-${index}`}
                    cx={x}
                    cy={jitter(index, STRIP_HEIGHT)}
                    r={DOT_RADIUS}
                    fill={colors.data[`recovery.${band.band}`]}
                  />
                );
              })}
            </Svg>
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: space.md, paddingLeft: 84 }}>
        <Text variant="caption" color="ink3" numeric>
          {`RPE ${RPE_MIN}`}
        </Text>
        <Text variant="caption" color="ink3" numeric style={{ flex: 1 }} align="right">
          {`RPE ${RPE_MAX}`}
        </Text>
      </View>
    </View>
  );
}
