import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { Line } from 'react-native-svg';
import { Text } from '../text';
import { useTheme, type ColorToken } from '../theme';
import { MARK, PLOT_PAD, STROKE } from './scale';

/**
 * Chart text is real `<Text>` in an absolutely positioned overlay, never SVG
 * text. That keeps every tick and every direct label on the Archivo static
 * instances with tabular figures, which SVG text on web would not inherit.
 */
export interface PlotTextProps {
  readonly x: number;
  readonly y: number;
  /** Where `x` sits relative to the text. */
  readonly anchor?: 'start' | 'middle' | 'end';
  /** Where `y` sits relative to the text. */
  readonly vertical?: 'top' | 'middle' | 'bottom';
  readonly variant?: 'label' | 'caption';
  readonly color?: ColorToken;
  readonly width?: number;
  /**
   * Sit the text on the surface colour. A direct label lands over gridlines and
   * over the series itself; the backing is what keeps it readable there without
   * moving it off the mark it names.
   */
  readonly backing?: boolean;
  readonly children: ReactNode;
}

export function PlotText({
  x,
  y,
  anchor = 'start',
  vertical = 'middle',
  variant = 'caption',
  color = 'ink3',
  width = 72,
  backing = false,
  children,
}: PlotTextProps) {
  const { colors } = useTheme();
  const lineHeight = 16;
  const top = vertical === 'middle' ? y - lineHeight / 2 : vertical === 'top' ? y : y - lineHeight;
  const style: ViewStyle = {
    position: 'absolute',
    top,
    width,
    left: anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width,
    alignItems: anchor === 'start' ? 'flex-start' : anchor === 'middle' ? 'center' : 'flex-end',
  };
  return (
    <View pointerEvents="none" style={style}>
      <View style={backing ? { backgroundColor: colors.paper, paddingHorizontal: 3 } : undefined}>
        <Text variant={variant} color={color} numberOfLines={1}>
          {children}
        </Text>
      </View>
    </View>
  );
}

export interface AxisTick {
  readonly value: number;
  readonly position: number;
  readonly text: string;
}

export interface AxisProps {
  readonly width: number;
  readonly height: number;
  readonly xTicks: readonly AxisTick[];
  readonly yTicks?: readonly AxisTick[];
  /** Draw the y gridlines. Off where the marks already carry the reading. */
  readonly gridlines?: boolean;
}

/**
 * Gridlines and axis rules: solid hairlines one step off the surface, drawn
 * behind everything. Dashing is reserved for the projection, so nothing in the
 * chrome is ever dashed.
 */
export function AxisMarks({ width, height, xTicks, yTicks = [], gridlines = true }: AxisProps) {
  const { colors } = useTheme();
  const left = PLOT_PAD.left;
  const right = width - PLOT_PAD.right;
  const bottom = height - PLOT_PAD.bottom;
  return (
    <>
      {gridlines
        ? yTicks.map((tick) => (
            <Line
              key={`grid-${tick.value}`}
              x1={left}
              x2={right}
              y1={tick.position}
              y2={tick.position}
              stroke={colors.rule}
              strokeWidth={STROKE.grid}
            />
          ))
        : null}
      <Line
        x1={left}
        x2={right}
        y1={bottom}
        y2={bottom}
        stroke={colors.ruleStrong}
        strokeWidth={STROKE.reference}
      />
      {/* Ticks are drawn whether or not the graticule is: a panel that turns
          gridlines off still has to say what its axis labels point at, and
          both axes carry the same 3 px tick so the stack reads as one figure
          rather than three charts that happen to be stacked. */}
      {yTicks.map((tick) => (
        <Line
          key={`ytick-${tick.value}`}
          x1={left - MARK.tickLength}
          x2={left}
          y1={tick.position}
          y2={tick.position}
          stroke={colors.ruleStrong}
          strokeWidth={STROKE.reference}
        />
      ))}
      {xTicks.map((tick) => (
        <Line
          key={`xtick-${tick.value}`}
          x1={tick.position}
          x2={tick.position}
          y1={bottom}
          y2={bottom + MARK.tickLength}
          stroke={colors.ruleStrong}
          strokeWidth={STROKE.reference}
        />
      ))}
    </>
  );
}

/** The axis tick text, in the overlay so it keeps tabular figures. */
export function AxisLabels({ height, xTicks, yTicks = [] }: AxisProps) {
  const bottom = height - PLOT_PAD.bottom;
  // The y label's own column: everything left of the tick, less 2 px of air.
  const yWidth = PLOT_PAD.left - MARK.tickLength - 2;
  const last = xTicks.length - 1;
  return (
    <>
      {yTicks.map((tick) => (
        <PlotText
          key={`ylab-${tick.value}`}
          x={yWidth}
          y={tick.position}
          anchor="end"
          width={yWidth}
        >
          {tick.text}
        </PlotText>
      ))}
      {/* Every label sits on its own tick's true position. The end labels turn
          their anchor rather than sliding inwards: a date label nudged 6 px to
          keep it on the canvas points at the wrong day, which is the one thing
          an axis may not do. */}
      {xTicks.map((tick, index) => (
        <PlotText
          key={`xlab-${tick.value}`}
          x={tick.position}
          y={bottom + MARK.tickLength + 2}
          anchor={index === 0 ? 'start' : index === last ? 'end' : 'middle'}
          vertical="top"
          width={56}
        >
          {tick.text}
        </PlotText>
      ))}
    </>
  );
}

/** The crosshair rule. It snaps to a day, so the reader aims at a date. */
export function Crosshair({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  const { colors } = useTheme();
  return (
    <Line
      x1={x}
      x2={x}
      y1={top}
      y2={bottom}
      stroke={colors.ruleStrong}
      strokeWidth={STROKE.reference}
    />
  );
}

export type LegendGlyph =
  | 'line'
  | 'dashed'
  | 'dot'
  | 'hollow'
  | 'ring'
  | 'column'
  | 'tick'
  | 'band';

export interface LegendItem {
  readonly glyph: LegendGlyph;
  readonly label: string;
  /** A token hex from `colors.data`, or an ink token. Defaults to ink. */
  readonly color?: string;
}

export interface LegendProps {
  readonly items: readonly LegendItem[];
  /** A trailing note, e.g. "Data by WHOOP". */
  readonly note?: string;
}

/**
 * Always present from two series up: identity never rests on colour alone. The
 * glyph mirrors the mark, so a line series keys with a stroke and a dot series
 * with a dot.
 */
export function Legend({ items, note }: LegendProps) {
  const { colors, space } = useTheme();
  if (items.length === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: space.md,
        rowGap: space.xs,
        paddingTop: space.sm,
      }}
    >
      {items.map((item) => (
        <View
          key={item.label}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}
        >
          <LegendGlyphMark glyph={item.glyph} color={item.color ?? colors.ink} />
          <Text variant="caption" color="ink2">
            {item.label}
          </Text>
        </View>
      ))}
      {note !== undefined ? (
        <Text variant="caption" color="ink3">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The dot keys are real circles, which is the one carve-out from the flat
 * radius law. This is not a corner softened on a box: it is the same 8px mark
 * the plot draws, in a View instead of an `<Svg>`, and a key that does not
 * mirror its mark is not a key. Size and radius both come from `MARK.dotRadius`
 * so the legend and the plot can never drift apart, and nothing else in the kit
 * may read this as licence for a rounded rectangle.
 */
const DOT_SIZE = MARK.dotRadius * 2;
/** The PR key: the same dot inside the same ring, at the plot's own two radii. */
const RING_SIZE = (MARK.dotRadius + MARK.prRing) * 2;

function LegendGlyphMark({ glyph, color }: { glyph: LegendGlyph; color: string }) {
  const { colors } = useTheme();
  const box: ViewStyle = { width: 16, alignItems: 'center', justifyContent: 'center', height: 15 };
  if (glyph === 'dot') {
    return (
      <View style={box}>
        <View
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: MARK.dotRadius,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }
  if (glyph === 'hollow') {
    return (
      <View style={box}>
        <View
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: MARK.dotRadius,
            borderWidth: 1.5,
            borderColor: color,
            backgroundColor: colors.paper,
          }}
        />
      </View>
    );
  }
  if (glyph === 'ring') {
    return (
      <View style={box}>
        <View
          style={{
            width: RING_SIZE,
            height: RING_SIZE,
            borderRadius: RING_SIZE / 2,
            borderWidth: STROKE.reference,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: MARK.dotRadius,
              height: MARK.dotRadius,
              borderRadius: MARK.dotRadius / 2,
              backgroundColor: color,
            }}
          />
        </View>
      </View>
    );
  }
  if (glyph === 'column') {
    return (
      <View style={box}>
        <View style={{ width: 6, height: 11, backgroundColor: color }} />
      </View>
    );
  }
  if (glyph === 'tick') {
    return (
      <View style={box}>
        <View style={{ width: 2, height: 10, backgroundColor: color }} />
      </View>
    );
  }
  if (glyph === 'band') {
    return (
      <View style={box}>
        <View style={{ width: 14, height: 9, backgroundColor: color, opacity: 0.16 }} />
      </View>
    );
  }
  if (glyph === 'dashed') {
    return (
      <View style={[box, { flexDirection: 'row', gap: 2 }]}>
        <View style={{ width: 5, height: 2, backgroundColor: color }} />
        <View style={{ width: 5, height: 2, backgroundColor: color }} />
      </View>
    );
  }
  return (
    <View style={box}>
      <View style={{ width: 14, height: MARK.lineWidth, backgroundColor: color }} />
    </View>
  );
}

export interface TooltipProps {
  /** The mark's x. The panel is clamped so it never leaves the plot. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly lines: readonly string[];
  /** The first line, set stronger: the reader has the series and wants the number. */
  readonly value: string;
}

/**
 * A paper2 panel behind a hairline. Values lead, labels follow. It enhances and
 * never gates: every number in here is also in the table twin.
 */
export function Tooltip({ x, y, width, lines, value }: TooltipProps) {
  const { colors, space } = useTheme();
  const panelWidth = 148;
  const left = Math.min(Math.max(x + 10, 4), Math.max(4, width - panelWidth - 4));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        top: Math.max(2, y - 12),
        width: panelWidth,
        backgroundColor: colors.paper2,
        borderWidth: 1,
        borderColor: colors.rule,
        paddingVertical: space.xs,
        paddingHorizontal: space.sm,
        gap: space.xxs,
      }}
    >
      <Text variant="caption" color="ink">
        {value}
      </Text>
      {lines.map((line) => (
        <Text key={line} variant="caption" color="ink2">
          {line}
        </Text>
      ))}
    </View>
  );
}

export interface HitTargetProps {
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  readonly label: string;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
}

/**
 * A mark's real target: transparent, at least 24px, and focusable, so the same
 * readout the pointer gets is one Tab key away on web and one VoiceOver stop
 * away on native. The painted dot is 8px and nobody could hit that.
 */
export function HitTarget({ x, y, size = MARK.hitSize, label, onFocus, onBlur }: HitTargetProps) {
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onFocus}
      onHoverIn={onFocus}
      onHoverOut={onBlur}
      style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }}
    />
  );
}

export interface ChartFrameProps {
  readonly title: string;
  readonly caption?: string;
  readonly children: ReactNode;
}

/** Title, caption, and the plot. The table twin mounts beneath it. */
export function ChartFrame({ title, caption, children }: ChartFrameProps) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" color="ink3">
        {title}
      </Text>
      {caption !== undefined ? (
        <Text variant="caption" color="ink2">
          {caption}
        </Text>
      ) : null}
      <View style={{ paddingTop: space.xs }}>{children}</View>
    </View>
  );
}
