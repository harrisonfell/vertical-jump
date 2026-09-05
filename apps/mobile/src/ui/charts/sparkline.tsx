import { scaleLinear } from 'd3-scale';
import { View } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { useTheme } from '../theme';
import { MARK, polylinePath } from './scale';

export interface SparklineProps {
  /** The last six readings, oldest first. Values in display units. */
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
  /** Read aloud in place of the marks, e.g. "Six tests, 29.4 to 32.5 inches". */
  readonly label: string;
}

/**
 * Six points, no axes, no labels: the shape beside the one big number on
 * Progress. It is a texture on a number, not a chart, so it carries no legend
 * and no table twin. Every value it draws is in the test table below it.
 */
export function Sparkline({ values, width = 72, height = 20, label }: SparklineProps) {
  const { colors } = useTheme();
  if (values.length < 2) return null;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = MARK.dotRadius - 1;
  const x = scaleLinear().domain([0, values.length - 1]).range([pad, width - pad]);
  // A flat series still draws a line rather than collapsing onto an edge.
  const y = scaleLinear()
    .domain(hi > lo ? [lo, hi] : [lo - 1, hi + 1])
    .range([height - pad, pad]);

  const points = values.map((value, index): readonly [number, number] => [x(index), y(value)]);
  const last = points[points.length - 1];

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path
          d={polylinePath(points)}
          stroke={colors.ink2}
          strokeWidth={MARK.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {last !== undefined ? (
          <>
            <Circle cx={last[0]} cy={last[1]} r={MARK.dotRadius - 1 + MARK.gap} fill={colors.paper} />
            <Circle cx={last[0]} cy={last[1]} r={MARK.dotRadius - 1} fill={colors.ink} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}
