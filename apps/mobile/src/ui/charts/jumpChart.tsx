import { scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Circle, Line, Path, Svg } from 'react-native-svg';
import { Text } from '../text';
import { useTheme } from '../theme';
import { ChartTable } from './chartTable';
import { HoverArea } from './hoverArea';
import { Marker, testState } from './jumpMarks';
import { jumpDirectLabels, type DirectLabel } from './jumpLabels';
import {
  AxisLabels,
  AxisMarks,
  ChartFrame,
  Crosshair,
  HitTarget,
  Legend,
  PlotText,
  Tooltip,
  type AxisTick,
  type LegendItem,
} from './parts';
import type { IsoDay, JumpChartData, ProbeControl, SeriesPoint } from './props';
import {
  MARK,
  PLOT_PAD,
  bandPath,
  fixedHeightDomain,
  formatDayLong,
  formatDayShort,
  nearestDay,
  parseDay,
  polylinePath,
  segmentByGap,
  toDay,
  wholeInchTicks,
} from './scale';

export interface JumpChartProps extends ProbeControl {
  readonly data: JumpChartData;
  readonly width: number;
  readonly height: number;
  /** Off when a panel below owns the shared x axis for the whole stack. */
  readonly showXAxis?: boolean;
  readonly showTable?: boolean;
  readonly title?: string;
}

/** One inch, one decimal: the athlete reads "32.5", never "32.50". */
function inches(value: number): string {
  return value.toFixed(1);
}

/**
 * One instrument stream's height chart.
 *
 * The frame is fixed at program start: the x domain runs start to target date
 * and the y domain is [min(baseline, tests) − 2, max(goal, tests) + 2] in whole
 * inches. Neither rescales as tests arrive, so a flat week looks flat and a
 * good week looks good against the same grid all program.
 *
 * There is no animation here at all, in either scheme, which is also the
 * reduced-motion rendering: a chart that redraws itself teaches nothing.
 */
export function JumpChart({
  data,
  width,
  height,
  showXAxis = true,
  showTable = true,
  title = 'Jump height',
  probeDay,
  onProbeChange,
}: JumpChartProps) {
  const { colors, space } = useTheme();
  const [ownProbe, setOwnProbe] = useState<IsoDay | null>(null);
  const probe = probeDay !== undefined ? probeDay : ownProbe;
  const setProbe = onProbeChange ?? setOwnProbe;

  const geometry = useMemo(() => {
    const left = PLOT_PAD.left;
    const right = Math.max(left + 1, width - PLOT_PAD.right);
    const top = PLOT_PAD.top;
    const bottom = Math.max(top + 1, height - PLOT_PAD.bottom);

    const domainY = fixedHeightDomain({
      baselineIn: data.baseline.heightIn,
      goalIn: data.goalIn,
      testsIn: data.tests.map((test) => test.heightIn),
    });
    const x = scaleLinear()
      .domain([parseDay(data.programStart), parseDay(data.targetDate)])
      .range([left, right]);
    const y = scaleLinear().domain([domainY[0], domainY[1]]).range([bottom, top]);

    const px = (day: IsoDay) => x(parseDay(day));
    const py = (value: number) => y(value);
    const project = (point: SeriesPoint): readonly [number, number] => [
      px(point.date),
      py(point.heightIn),
    ];

    return { left, right, top, bottom, domainY, px, py, project };
  }, [data, width, height]);

  const { right, top, bottom, domainY, px, py, project } = geometry;

  const canonical = useMemo(
    () => data.tests.filter((test) => test.canonical && test.flagged !== true),
    [data.tests],
  );
  const observedSegments = useMemo(
    () => segmentByGap(canonical, (test) => test.date),
    [canonical],
  );

  const latest = canonical.length > 0 ? canonical[canonical.length - 1] : undefined;
  const prTest = useMemo(() => data.tests.find((test) => test.pr === true), [data.tests]);

  const yTicks: readonly AxisTick[] = useMemo(
    () =>
      wholeInchTicks(domainY, height >= 240 ? 8 : 7).map((value) => ({
        value,
        position: py(value),
        text: `${value}`,
      })),
    [domainY, height, py],
  );

  const xTicks: readonly AxisTick[] = useMemo(() => {
    const startDay = parseDay(data.programStart);
    const endDay = parseDay(data.targetDate);
    const span = Math.max(1, endDay - startDay);
    const count = width >= 700 ? 5 : 3;
    const ticks: AxisTick[] = [];
    for (let i = 0; i <= count; i += 1) {
      const day = Math.round(startDay + (span * i) / count);
      const iso = toDay(day);
      ticks.push({ value: day, position: px(iso), text: formatDayShort(iso) });
    }
    return ticks;
  }, [data.programStart, data.targetDate, width, px]);

  const directLabels = useMemo<readonly DirectLabel[]>(
    () =>
      jumpDirectLabels({
        data,
        latest,
        prTest,
        observedSegments,
        px,
        py,
        project,
        right,
        bounds: [top + 8, bottom - 8],
      }),
    [data, latest, prTest, observedSegments, px, py, project, right, top, bottom],
  );

  const probed = useMemo(() => {
    if (probe === null) return null;
    const test = data.tests.find((item) => item.date === probe);
    if (test === undefined) return null;
    return { test, x: px(test.date), y: py(test.heightIn) };
  }, [probe, data.tests, px, py]);

  const testDays = useMemo(() => data.tests.map((test) => test.date), [data.tests]);
  const handleProbe = (x: number | null) => {
    if (x === null) {
      setProbe(null);
      return;
    }
    setProbe(nearestDay(x, px, testDays));
  };

  const legend: LegendItem[] = [
    { glyph: 'dot', label: 'Canonical test', color: colors.ink },
    { glyph: 'hollow', label: 'Flagged or baseline', color: colors.ink2 },
    { glyph: 'line', label: 'Trend', color: colors.ink },
    { glyph: 'line', label: 'Required pace', color: colors.ink3 },
  ];
  if (data.projection !== undefined) {
    legend.push({ glyph: 'dashed', label: 'Projection', color: colors.ink2 });
    legend.push({ glyph: 'band', label: 'Projection range', color: colors.ink });
  }
  legend.push({ glyph: 'line', label: 'Today', color: colors.green });

  const todayX = px(data.today);
  const showToday =
    parseDay(data.today) >= parseDay(data.programStart) &&
    parseDay(data.today) <= parseDay(data.targetDate);

  return (
    <ChartFrame title={title} caption={data.instrument}>
      <HoverArea width={width} height={height} onProbe={handleProbe}>
        <Svg width={width} height={height}>
          <AxisMarks width={width} height={height} xTicks={xTicks} yTicks={yTicks} />

          {data.projection !== undefined ? (
            <>
              <Path
                d={bandPath(
                  data.projection.upper.map(project),
                  data.projection.lower.map(project),
                )}
                fill={colors.ink}
                opacity={0.1}
              />
              <Path
                d={polylinePath(data.projection.line.map(project))}
                stroke={colors.ink2}
                strokeWidth={MARK.lineWidth}
                strokeDasharray="6 4"
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : null}

          {/* Required pace, fixed at program start: baseline to goal. */}
          <Line
            x1={px(data.baseline.date)}
            y1={py(data.baseline.heightIn)}
            x2={right}
            y2={py(data.goalIn)}
            stroke={colors.ink3}
            strokeWidth={1}
          />

          {showToday ? (
            <Line
              x1={todayX}
              y1={top}
              x2={todayX}
              y2={bottom}
              stroke={colors.green}
              strokeWidth={1}
            />
          ) : null}

          {(data.streamBreaks ?? []).map((brk) => (
            <Line
              key={`break-${brk.date}`}
              x1={px(brk.date)}
              y1={top}
              x2={px(brk.date)}
              y2={top + 10}
              stroke={colors.ruleStrong}
              strokeWidth={1}
            />
          ))}

          {/* The observed path, recessive, broken across gaps over 21 days. */}
          {observedSegments.map((segment) => (
            <Path
              key={`obs-${segment[0]?.date ?? 'x'}`}
              d={polylinePath(segment.map((test) => [px(test.date), py(test.heightIn)]))}
              stroke={colors.ink3}
              strokeWidth={1}
              fill="none"
            />
          ))}

          {/* Theil-Sen, over the observed range only. */}
          {data.trend !== undefined && data.trend.length >= 2 ? (
            <Path
              d={polylinePath(data.trend.map(project))}
              stroke={colors.ink}
              strokeWidth={MARK.lineWidth}
              strokeLinecap="round"
              fill="none"
            />
          ) : null}

          {/* The goal: a labelled point, never a dashed line. */}
          <Circle
            cx={right}
            cy={py(data.goalIn)}
            r={MARK.dotRadius}
            fill={colors.paper}
            stroke={colors.green}
            strokeWidth={2}
          />

          <Marker
            x={px(data.baseline.date)}
            y={py(data.baseline.heightIn)}
            filled={!data.baseline.remembered}
            surface={colors.paper}
            ink={colors.ink2}
          />

          {data.tests.map((test) => (
            <Marker
              key={`test-${test.date}-${test.heightIn}`}
              x={px(test.date)}
              y={py(test.heightIn)}
              filled={test.canonical && test.flagged !== true}
              surface={colors.paper}
              ink={test.canonical && test.flagged !== true ? colors.ink : colors.ink2}
            />
          ))}

          {probed !== null ? <Crosshair x={probed.x} top={top} bottom={bottom} /> : null}
        </Svg>

        <View style={{ position: 'absolute', top: 0, left: 0, width, height }} pointerEvents="box-none">
          {showXAxis ? (
            <AxisLabels width={width} height={height} xTicks={xTicks} yTicks={yTicks} />
          ) : (
            <AxisLabels width={width} height={height} xTicks={[]} yTicks={yTicks} />
          )}

          {(data.streamBreaks ?? []).map((brk) => (
            <PlotText key={`breaklab-${brk.date}`} x={px(brk.date) + 4} y={top + 2} vertical="top">
              {brk.label}
            </PlotText>
          ))}

          {directLabels.map((label) => (
            <PlotText
              key={label.key}
              x={label.x}
              y={label.y}
              anchor={label.anchor}
              color={label.color}
              width={label.width}
              backing
            >
              {label.text}
            </PlotText>
          ))}

          {data.tests.map((test) => (
            <HitTarget
              key={`hit-${test.date}-${test.heightIn}`}
              x={px(test.date)}
              y={py(test.heightIn)}
              label={`${formatDayLong(test.date)}, ${inches(test.heightIn)} inches, ${test.instrument}`}
              onFocus={() => setProbe(test.date)}
              onBlur={() => setProbe(null)}
            />
          ))}

          {probed !== null ? (
            <Tooltip
              x={probed.x}
              y={probed.y}
              width={width}
              value={`${inches(probed.test.heightIn)} in`}
              lines={[
                formatDayLong(probed.test.date),
                probed.test.instrument,
                ...(probed.test.flagged === true ? ['Flagged attempt'] : []),
                ...(probed.test.canonical ? [] : ['Not canonical']),
              ]}
            />
          ) : null}
        </View>
      </HoverArea>

      <View style={{ paddingTop: space.xs, gap: space.xs }}>
        <Legend items={legend} />
        {/* The empty note is a caption under the key, never a mark inside the
            plot: in the frame it lands on the required-pace line it explains. */}
        {canonical.length === 0 && data.emptyMessage !== undefined ? (
          <Text variant="caption" color="ink2">
            {data.emptyMessage}
          </Text>
        ) : null}
      </View>

      {showTable ? (
        <ChartTable
          label="the test table"
          columns={[
            { key: 'date', header: 'Date' },
            { key: 'height', header: 'Height', numeric: true },
            { key: 'instrument', header: 'Instrument' },
            { key: 'state', header: 'State' },
          ]}
          rows={[
            {
              date: formatDayLong(data.baseline.date),
              height: inches(data.baseline.heightIn),
              instrument: data.instrument,
              state: data.baseline.remembered ? 'Baseline, remembered' : 'Baseline',
            },
            ...data.tests.map((test) => ({
              date: formatDayLong(test.date),
              height: inches(test.heightIn),
              instrument: test.instrument,
              state: testState(test),
            })),
          ]}
        />
      ) : null}
    </ChartFrame>
  );
}
