import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Circle, Line, Svg } from 'react-native-svg';
import { formatVelocity } from '@vert/engine/units';
import { useTheme } from '../theme';
import { ChartTable } from './chartTable';
import { AxisLabels, AxisMarks, ChartFrame, HitTarget, PlotText, Tooltip, type AxisTick } from './parts';
import type { LoadVelocityFit, LoadVelocityPoint } from './props';
import { MARK, PLOT_PAD } from './scale';

export interface LoadVelocityChartProps {
  readonly points: readonly LoadVelocityPoint[];
  /** The caller fits the line; this draws it and reports n and r squared. */
  readonly fit?: LoadVelocityFit;
  readonly width: number;
  readonly height?: number;
  readonly lift: string;
  readonly showTable?: boolean;
}

/**
 * Load against mean velocity for one lift, with the fit's own quality stated
 * under it. It stays deliberately small: it earns its place only once a lift
 * has three velocity sessions across three loads spanning 0.30 m/s, and until
 * then the numbers alone are the honest reading.
 *
 * All pairs of marks can sit side by side here, so this is a single-series
 * chart on purpose: identity never rests on colour.
 */
export function LoadVelocityChart({
  points,
  fit,
  width,
  height = 160,
  lift,
  showTable = true,
}: LoadVelocityChartProps) {
  const { colors } = useTheme();
  const [probeIndex, setProbeIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const left = PLOT_PAD.left + 6;
    const right = Math.max(left + 1, width - PLOT_PAD.right / 2);
    const top = PLOT_PAD.top;
    const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);

    const loads = points.map((point) => point.loadLb);
    const speeds = points.map((point) => point.velocityMs);
    const loadLo = loads.length > 0 ? Math.min(...loads) : 0;
    const loadHi = loads.length > 0 ? Math.max(...loads) : 1;
    const speedLo = speeds.length > 0 ? Math.min(...speeds) : 0;
    const speedHi = speeds.length > 0 ? Math.max(...speeds) : 1;

    const x = scaleLinear()
      .domain([Math.floor((loadLo - 10) / 5) * 5, Math.ceil((loadHi + 10) / 5) * 5])
      .range([left, right]);
    const y = scaleLinear()
      .domain([Math.max(0, speedLo - 0.1), speedHi + 0.1])
      .range([bottom, top]);
    return { left, right, top, bottom, x, y };
  }, [points, width, height]);

  const { top, bottom, x, y } = geometry;

  const xTicks: readonly AxisTick[] = useMemo(
    () =>
      x.ticks(4).map((value) => ({ value, position: x(value), text: `${Math.round(value)}` })),
    [x],
  );
  const yTicks: readonly AxisTick[] = useMemo(
    () => y.ticks(3).map((value) => ({ value, position: y(value), text: value.toFixed(2) })),
    [y],
  );

  const probed = probeIndex === null ? undefined : points[probeIndex];

  return (
    <ChartFrame
      title={`${lift} load and velocity`}
      caption={
        fit === undefined
          ? 'Not enough velocity sessions to fit a line yet.'
          : `n = ${fit.n} · r² = ${fit.rSquared.toFixed(2)}`
      }
    >
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          <AxisMarks width={width} height={height} xTicks={xTicks} yTicks={yTicks} />
          {fit !== undefined ? (
            <Line
              x1={x(fit.from.loadLb)}
              y1={y(fit.from.velocityMs)}
              x2={x(fit.to.loadLb)}
              y2={y(fit.to.velocityMs)}
              stroke={colors.ink2}
              strokeWidth={MARK.lineWidth}
              strokeLinecap="round"
            />
          ) : null}
          {points.map((point, index) => (
            <Circle
              key={`ring-${point.loadLb}-${point.velocityMs}-${index}`}
              cx={x(point.loadLb)}
              cy={y(point.velocityMs)}
              r={MARK.dotRadius + MARK.gap}
              fill={colors.paper}
            />
          ))}
          {points.map((point, index) => (
            <Circle
              key={`dot-${point.loadLb}-${point.velocityMs}-${index}`}
              cx={x(point.loadLb)}
              cy={y(point.velocityMs)}
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
          <PlotText x={width - 4} y={top - 2} anchor="end" vertical="top" width={80}>
            lb and m/s
          </PlotText>

          {points.map((point, index) => (
            <HitTarget
              key={`hit-${point.loadLb}-${point.velocityMs}-${index}`}
              x={x(point.loadLb)}
              y={y(point.velocityMs)}
              label={`${Math.round(point.loadLb)} lb at ${formatVelocity(point.velocityMs)}`}
              onFocus={() => setProbeIndex(index)}
              onBlur={() => setProbeIndex(null)}
            />
          ))}

          {probed !== undefined ? (
            <Tooltip
              x={x(probed.loadLb)}
              y={Math.min(y(probed.velocityMs), bottom - 40)}
              width={width}
              value={formatVelocity(probed.velocityMs)}
              lines={[`${Math.round(probed.loadLb)} lb`, lift]}
            />
          ) : null}
        </View>
      </View>

      {showTable ? (
        <ChartTable
          label="the velocity table"
          columns={[
            { key: 'load', header: 'Load', numeric: true },
            { key: 'velocity', header: 'Mean velocity', numeric: true, width: 110 },
          ]}
          rows={points.map((point) => ({
            load: `${Math.round(point.loadLb)} lb`,
            velocity: formatVelocity(point.velocityMs),
          }))}
        />
      ) : null}
    </ChartFrame>
  );
}
