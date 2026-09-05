import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { formatInteger } from '@vert/engine/units';
import { Text, useTheme } from '@/ui';
import {
  AxisLabels,
  AxisMarks,
  ChartFrame,
  ChartTable,
  HitTarget,
  MARK,
  PLOT_PAD,
  Tooltip,
  polylinePath,
  type AxisTick,
} from '@/ui/charts';
import type { PullUpPoint } from './types';

/**
 * The weighted pull-up's added-load max, one point a program week.
 *
 * Deliberately small and single-series: a working max is one number over time,
 * so identity never rests on colour and the chart carries no legend. The
 * bodyweight half of the lift is not in it, because bodyweight is not on the
 * bar and a line that mixed the two would move when the athlete ate.
 *
 * A week with no logged set is a gap in the x axis rather than a repeated
 * point: the line joins the weeks that were measured and says how many they
 * were in its caption.
 */

export interface PullUpChartProps {
  readonly points: readonly PullUpPoint[];
  readonly width: number;
  readonly height?: number;
  readonly caption: string;
}

export function PullUpChart({ points, width, height = 140, caption }: PullUpChartProps) {
  const { colors } = useTheme();
  const [probeIndex, setProbeIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const left = PLOT_PAD.left + 6;
    const right = Math.max(left + 1, width - PLOT_PAD.right / 2);
    const top = PLOT_PAD.top;
    const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);

    const weeks = points.map((point) => point.w);
    const loads = points.map((point) => point.addedLb);
    const wLo = weeks.length > 0 ? Math.min(...weeks) : 1;
    const wHi = weeks.length > 0 ? Math.max(...weeks) : 2;
    const loadLo = loads.length > 0 ? Math.min(...loads) : 0;
    const loadHi = loads.length > 0 ? Math.max(...loads) : 5;

    const x = scaleLinear()
      .domain(wHi > wLo ? [wLo, wHi] : [wLo - 1, wHi + 1])
      .range([left, right]);
    // A flat trend keeps a readable band rather than collapsing onto an edge.
    const y = scaleLinear()
      .domain(loadHi > loadLo ? [loadLo - 5, loadHi + 5] : [loadLo - 5, loadHi + 5])
      .range([bottom, top]);
    return { left, right, top, bottom, x, y };
  }, [points, width, height]);

  const { bottom, x, y } = geometry;

  const xTicks: readonly AxisTick[] = useMemo(
    () =>
      x
        .ticks(Math.min(4, Math.max(2, points.length)))
        .map((value) => ({ value, position: x(value), text: `${Math.round(value)}` })),
    [x, points.length],
  );
  const yTicks: readonly AxisTick[] = useMemo(
    () => y.ticks(3).map((value) => ({ value, position: y(value), text: `${Math.round(value)}` })),
    [y],
  );

  const line = points.map((point): readonly [number, number] => [x(point.w), y(point.addedLb)]);
  const probed = probeIndex === null ? undefined : points[probeIndex];

  if (points.length < 2) {
    return (
      <ChartFrame title="Added-load max by week" caption={caption}>
        <Text variant="caption" color="ink3" style={{ maxWidth: 560 }}>
          A line needs two weeks with a logged weighted pull-up set.
        </Text>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title="Added-load max by week" caption={caption}>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          <AxisMarks width={width} height={height} xTicks={xTicks} yTicks={yTicks} />
          <Path
            d={polylinePath(line)}
            stroke={colors.ink}
            strokeWidth={MARK.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {points.map((point) => (
            <Circle
              key={`ring-${point.w}`}
              cx={x(point.w)}
              cy={y(point.addedLb)}
              r={MARK.dotRadius + MARK.gap}
              fill={colors.paper}
            />
          ))}
          {points.map((point) => (
            <Circle
              key={`dot-${point.w}`}
              cx={x(point.w)}
              cy={y(point.addedLb)}
              r={MARK.dotRadius}
              fill={colors.ink}
            />
          ))}
        </Svg>

        <View
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          pointerEvents="box-none"
        >
          <AxisLabels width={width} height={height} xTicks={xTicks} yTicks={yTicks} />
          {points.map((point, index) => (
            <HitTarget
              key={`hit-${point.w}`}
              x={x(point.w)}
              y={y(point.addedLb)}
              label={`${point.weekLabel}, ${point.label} added, from ${point.fromLabel} on ${point.dateLabel}`}
              onFocus={() => setProbeIndex(index)}
              onBlur={() => setProbeIndex(null)}
            />
          ))}
          {probed !== undefined ? (
            <Tooltip
              x={x(probed.w)}
              y={Math.min(y(probed.addedLb), bottom - 40)}
              width={width}
              value={probed.label}
              lines={[probed.weekLabel, probed.fromLabel]}
            />
          ) : null}
        </View>
      </View>

      <Text variant="caption" color="ink3">
        {`Week · added pounds · ${formatInteger(points.length)} weeks measured`}
      </Text>

      <ChartTable
        label="the pull-up table"
        columns={[
          { key: 'week', header: 'Week', width: 64 },
          { key: 'max', header: 'Added max', numeric: true, width: 96 },
          { key: 'from', header: 'Top set' },
        ]}
        rows={points.map((point) => ({
          week: point.weekLabel,
          max: point.label,
          from: point.fromLabel,
        }))}
      />
    </ChartFrame>
  );
}
