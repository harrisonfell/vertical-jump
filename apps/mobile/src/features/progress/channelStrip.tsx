import { View } from 'react-native';
import { Circle, Line, Svg } from 'react-native-svg';
import { Glyph, RECOVERY_BANDS, RECOVERY_LABEL, Text, space, useTheme } from '@/ui';
import { MARK } from '@/ui/charts';
import type { ReadinessGateDay } from './types';

/**
 * The two readiness channels, one row of dots each, aligned by date.
 *
 * They are never averaged and never stacked into one score, so they are never
 * drawn as one series: the autonomic row carries Whoop's own band palette
 * beside the band word, exactly as the recovery panel does, and the
 * neuromuscular row is a plain ink strip because an output test has no band
 * vocabulary of its own. A low reading on either row is a hollow dot, so the
 * two rows are readable without colour and in both themes.
 *
 * A day where the rows disagree carries a tick under the axis and the word
 * "Divergence" in the list below, because divergence is the reading the gate
 * is built on and a mark nobody can name is not a reading.
 */

const ROW_HEIGHT = 22;
const LABEL_WIDTH = 88;
const MIN_STEP = 8;

export interface ChannelStripProps {
  readonly days: readonly ReadinessGateDay[];
  readonly width: number;
  /** "throw", "jump", "RSI": what the second row is measuring. */
  readonly testNoun: string;
}

/** One dot's x, evenly spaced: the axis is the days the gate scored, in order. */
function xFor(index: number, count: number, plotWidth: number): number {
  if (count <= 1) return plotWidth / 2;
  const step = Math.max(MIN_STEP, (plotWidth - MARK.dotRadius * 2) / (count - 1));
  return MARK.dotRadius + Math.min(index * step, plotWidth - MARK.dotRadius * 2);
}

export function ChannelStrip({ days, width, testNoun }: ChannelStripProps) {
  const { colors } = useTheme();
  const plotWidth = Math.max(120, width - LABEL_WIDTH - space.md);
  const count = days.length;

  const rows: readonly {
    readonly key: 'autonomic' | 'neuromuscular';
    readonly label: string;
    readonly reading: (day: ReadinessGateDay) => 'high' | 'low' | 'unknown';
    readonly fill: (day: ReadinessGateDay) => string;
  }[] = [
    {
      key: 'autonomic',
      label: 'Autonomic',
      reading: (day) => day.autonomic,
      fill: (day) =>
        day.recoveryBand === null ? colors.ink3 : colors.data[`recovery.${day.recoveryBand}`],
    },
    {
      key: 'neuromuscular',
      label: 'Neuromuscular',
      reading: (day) => day.neuromuscular,
      fill: () => colors.ink,
    },
  ];

  return (
    <View style={{ gap: space.xs }} testID="readiness-channel-strip">
      {rows.map((row) => (
        <View
          key={row.key}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
        >
          <Text variant="caption" color="ink2" style={{ width: LABEL_WIDTH }} numberOfLines={1}>
            {row.label}
          </Text>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={
              row.key === 'autonomic'
                ? `${rowLabel(row.label, days, row.reading)} ${bandLabel(days)}`
                : rowLabel(row.label, days, row.reading)
            }
          >
            <Svg width={plotWidth} height={ROW_HEIGHT}>
              <Line
                x1={0}
                y1={ROW_HEIGHT - 0.5}
                x2={plotWidth}
                y2={ROW_HEIGHT - 0.5}
                stroke={colors.rule}
                strokeWidth={1}
              />
              {days.map((day, index) => {
                const reading = row.reading(day);
                const cx = xFor(index, count, plotWidth);
                const cy = ROW_HEIGHT / 2 - 1;
                if (reading === 'unknown') {
                  return (
                    <Line
                      key={`${row.key}-${day.date}`}
                      x1={cx - MARK.dotRadius}
                      y1={cy}
                      x2={cx + MARK.dotRadius}
                      y2={cy}
                      stroke={colors.ink3}
                      strokeWidth={1}
                    />
                  );
                }
                return (
                  <Circle
                    key={`${row.key}-${day.date}`}
                    cx={cx}
                    cy={cy}
                    r={MARK.dotRadius}
                    fill={reading === 'high' ? row.fill(day) : colors.paper}
                    stroke={row.fill(day)}
                    strokeWidth={MARK.lineWidth}
                  />
                );
              })}
            </Svg>
          </View>
        </View>
      ))}

      {/* The divergence ticks sit on their own line under both rows, so the
          mark belongs to the pair of readings rather than to either one. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Text variant="caption" color="ink3" style={{ width: LABEL_WIDTH }} numberOfLines={1}>
          Divergence
        </Text>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={divergenceLabel(days)}
        >
          <Svg width={plotWidth} height={10}>
            {days.map((day, index) =>
              day.diverged ? (
                <Line
                  key={`div-${day.date}`}
                  x1={xFor(index, count, plotWidth)}
                  y1={1}
                  x2={xFor(index, count, plotWidth)}
                  y2={9}
                  stroke={colors.ink}
                  strokeWidth={MARK.lineWidth}
                />
              ) : null,
            )}
          </Svg>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: space.md, paddingLeft: LABEL_WIDTH + space.md }}>
        <Text variant="caption" color="ink3" numeric>
          {days[0]?.dateLabel ?? ''}
        </Text>
        <Text variant="caption" color="ink3" numeric style={{ flex: 1 }} align="right">
          {days[days.length - 1]?.dateLabel ?? ''}
        </Text>
      </View>

      {/* The autonomic dots are tinted by Whoop's band, so the bands are named
          here with the same marks. Without this key the band would be carried
          by hue alone, which is the one thing the data palette may never do. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: space.md,
          rowGap: space.xs,
          paddingLeft: LABEL_WIDTH + space.md,
        }}
      >
        {RECOVERY_BANDS.map((band) => (
          <View
            key={band}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: MARK.dotRadius * 2,
                height: MARK.dotRadius * 2,
                borderRadius: MARK.dotRadius,
                backgroundColor: colors.data[`recovery.${band}`],
              }}
            />
            <Text variant="caption" color="ink2">
              {`${RECOVERY_LABEL[band]} recovery`}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Glyph name="flag" color={colors.ink2} size={16} />
        <Text variant="caption" color="ink2" style={{ flex: 1 }}>
          {`Filled dot: high. Hollow dot: low. Dash: no reading. Tick: the recovery score and the ${testNoun} disagreed.`}
        </Text>
      </View>
    </View>
  );
}

/** How many days sat in each band, so the tint is never the only way to know. */
function bandLabel(days: readonly ReadinessGateDay[]): string {
  const counted = RECOVERY_BANDS.map(
    (band) =>
      `${days.filter((day) => day.recoveryBand === band).length} ${RECOVERY_LABEL[band].toLowerCase()}`,
  ).join(', ');
  return `Recovery bands: ${counted}.`;
}

/** What a screen reader hears in place of one row of dots. */
function rowLabel(
  name: string,
  days: readonly ReadinessGateDay[],
  reading: (day: ReadinessGateDay) => 'high' | 'low' | 'unknown',
): string {
  const high = days.filter((day) => reading(day) === 'high').length;
  const low = days.filter((day) => reading(day) === 'low').length;
  const none = days.length - high - low;
  return `${name}: ${high} high, ${low} low, ${none} without a reading, across ${days.length} days.`;
}

function divergenceLabel(days: readonly ReadinessGateDay[]): string {
  const marked = days.filter((day) => day.diverged);
  if (marked.length === 0) return 'No divergence days.';
  return `Divergence on ${marked.map((day) => day.dateLabel).join(', ')}.`;
}
